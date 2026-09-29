import { parseHebrewNumeral } from '@rebbehub/hebrew';
import { PAGE_ID_PATTERN, tidyInline, type Language, type PageInline, type PageMark, type PageSegment, type PageVersion } from '@rebbehub/model';

/**
 * The HTML texts Sichos-Kodesh publishes, and the Sefaria texts RebbeHub
 * keeps in the same form, read into a page's structured words
 * (@rebbehub/model's pageText.ts). The form is a fixed handful of tags
 * (Sichos-Kodesh's packages/app-core textObject.ts):
 *
 *   <article dir lang data-...>   <h1> the title   <h2>-<h6>   <p>   <p class="end">
 *   <b> <i> <u> <small> <sup> <sub> <br>
 *   <span class="mark">             a page or daily-study marker
 *   <sup class="fn"><a href="#nN">marker</a></sup>   a footnote's marker
 *   <aside class="notes"><p id="nN"><a href="#rN">marker</a> ...</p></aside>
 *   <footer class="source">...</footer>              the credit line
 *
 * Any other tag is dropped and its words kept; nothing is kept as HTML.
 * The title is the page's own name and the footer its source record
 * (`sourceFooter`), so neither is part of the words.
 *
 * A Sefaria text keeps Sefaria's structure: its sub-headings become
 * sections, and its paragraphs numbered segments, each with an id from
 * its place (`3.14`: section 3, segment 14), the same in the Hebrew and
 * the English, so the two stand side by side.
 */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') return String.fromCodePoint(name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1)));
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

export interface SourceFooter {
  version?: string;
  licence?: string;
  url?: string;
}

/** What the text's footer says of where it is from: its version, licence and page. */
export function sourceFooter(html: string): SourceFooter {
  const footer = /<footer[^>]*>([\s\S]*?)<\/footer>/i.exec(html)?.[1];
  if (!footer) return {};
  const out: SourceFooter = {};
  for (const m of footer.matchAll(/<span class="([^"]*)">([\s\S]*?)<\/span>/g)) {
    if (m[1] === 'version') out.version = decode(m[2]!.trim());
    if (m[1] === 'licence') out.licence = decode(m[2]!.trim());
  }
  const href = /<a [^>]*href="([^"]+)"/i.exec(footer)?.[1];
  if (href) out.url = decode(href);
  return out;
}

/** What an article says of itself: its language and whether it is one of Sefaria's texts. */
export function articleOf(html: string): { language?: Language; source?: string; version?: string } {
  const tag = /<article\b([^>]*)>/i.exec(html)?.[1] ?? '';
  const attr = (name: string) => new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(tag)?.[1];
  const lang = attr('lang');
  return {
    ...(lang === 'he' || lang === 'en' || lang === 'yi' ? { language: lang } : {}),
    ...(attr('data-source') ? { source: attr('data-source') } : {}),
    ...(attr('data-version') ? { version: decode(attr('data-version')!) } : {}),
  };
}

const PAGE_ID = new RegExp(PAGE_ID_PATTERN);
const MARKS: Record<string, PageMark> = { b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u', small: 'small', sup: 'sup', sub: 'sub' };
const BLOCKS = new Set(['p', 'div', 'li', 'blockquote', 'section', 'article', 'aside', 'ul', 'ol']);

/** A section's number from its heading (`פרק ג`, `Chapter 3`), when it ends with one. */
function headingNumber(text: string): number | null {
  const last = text.trim().split(/\s+/).pop() ?? '';
  if (/^\d+$/.test(last)) return Number(last);
  const hebrew = parseHebrewNumeral(last.replace(/[׳״'"]/g, ''));
  return hebrew && hebrew > 0 ? hebrew : null;
}

export interface HtmlToPageOptions {
  /** The version's id: `he`, `en`. */
  id: string;
  language: Language;
  /** Sefaria's rules: sub-headings as sections, paragraphs as numbered segments. */
  numbered?: boolean;
  title?: string;
  credit?: string;
  licence?: string;
  url?: string;
}

/** One article as a version of a page's words. */
export function htmlToPageVersion(html: string, options: HtmlToPageOptions): PageVersion {
  const main = html
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<h1[^>]*>[\s\S]*?<\/h1>/gi, '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');

  const segments: PageSegment[] = [];
  const notes: PageSegment[] = [];
  // The open sections (Sefaria), outermost first, with the level of the heading that opened each.
  const sections: Array<{ segment: PageSegment; level: number; count: number }> = [];
  let topCount = 0;
  let paragraphs = 0;
  let headings = 0;

  let runs: PageInline[] = [];
  let marks: PageMark[] = [];
  let end = false;
  let inNotes = false;
  let note: { id: string; label?: string } | null = null;
  let heading: number | null = null;
  // Inside a footnote's marker or a note's back-link: its words are the marker, not text.
  let skipping: { tag: string; depth: number; words: string } | null = null;
  let pendingNote: string | null = null;
  let inMark = false;
  let markWords = '';

  const container = () => (sections.length ? sections[sections.length - 1]!.segment.children! : segments);

  const flush = () => {
    const text = tidyInline(runs);
    runs = [];
    marks = [];
    if (heading !== null) {
      const level = heading;
      heading = null;
      if (!text.length) return;
      if (options.numbered) {
        while (sections.length && sections[sections.length - 1]!.level >= level) sections.pop();
        const parent = sections[sections.length - 1];
        const place = parent ? ++parent.count : ++topCount;
        const n = headingNumber(text.map((r) => ('text' in r ? r.text : '')).join('')) ?? place;
        const id = parent ? `${parent.segment.id}.${n}` : String(n);
        const section: PageSegment = { id, kind: 'section', n, text, children: [] };
        (parent ? parent.segment.children! : segments).push(section);
        sections.push({ segment: section, level, count: 0 });
        paragraphs = 0;
      } else {
        headings++;
        segments.push({ id: `h${headings}`, kind: 'heading', level: Math.min(4, Math.max(1, level - 1)) as 1 | 2 | 3 | 4, text });
      }
      return;
    }
    if (inNotes) {
      if (note && text.length) notes.push({ id: note.id, kind: 'note', ...(note.label ? (/^\d+$/.test(note.label) ? { n: Number(note.label) } : { label: note.label }) : {}), text });
      else if (!note && text.length) notes.push({ id: `n${notes.length + 1}`, kind: 'note', text });
      note = null;
      return;
    }
    const wasEnd = end;
    end = false;
    if (!text.length) return;
    if (options.numbered) {
      const parent = sections[sections.length - 1];
      const n = ++paragraphs;
      container().push({ id: parent ? `${parent.segment.id}.${n}` : String(n), kind: 'verse', n, text, ...(wasEnd ? { end: true } : {}) });
    } else {
      container().push({ id: `p${++paragraphs}`, kind: 'paragraph', text, ...(wasEnd ? { end: true } : {}) });
    }
  };

  for (const token of main.split(/(<[^>]+>)/)) {
    if (!token) continue;
    if (token[0] !== '<') {
      const words = decode(token).replace(/\s+/g, ' ');
      if (skipping) skipping.words += words;
      else if (inMark) markWords += words;
      else runs.push({ text: words, ...(marks.length ? { marks: [...marks] } : {}) });
      continue;
    }
    const tag = /^<\s*(\/?)\s*([a-z0-9]+)([^>]*)>/i.exec(token);
    if (!tag) continue;
    const close = Boolean(tag[1]);
    const name = tag[2]!.toLowerCase();
    const attrs = tag[3] ?? '';
    const cls = /\bclass="([^"]*)"/i.exec(attrs)?.[1]?.split(/\s+/) ?? [];

    if (skipping) {
      if (name === 'a' && !close && pendingNote === '') pendingNote = /\bhref="#([^"]+)"/i.exec(attrs)?.[1] ?? '';
      if (name === skipping.tag) skipping.depth += close ? -1 : 1;
      if (skipping.depth === 0) {
        const words = skipping.words.trim();
        if (pendingNote !== null) {
          if (PAGE_ID.test(pendingNote)) runs.push({ note: pendingNote });
        } else if (note && words) note.label = words;
        pendingNote = null;
        skipping = null;
      }
      continue;
    }
    if (name === 'sup' && !close && cls.includes('fn')) {
      // A footnote's marker: `<sup class="fn"><a href="#n3">3</a></sup>`, pointing at the note by its id.
      skipping = { tag: 'sup', depth: 1, words: '' };
      pendingNote = '';
      continue;
    }
    if (name === 'a' && !close && pendingNote === null && inNotes && note && runs.length === 0) {
      // A note's own back-link to its marker, at its start: its words are the note's label.
      skipping = { tag: 'a', depth: 1, words: '' };
      continue;
    }
    if (name === 'span' && cls.includes('mark')) {
      if (!close) {
        inMark = true;
        markWords = '';
      }
      continue;
    }
    if (name === 'span' && close && inMark) {
      inMark = false;
      if (markWords.trim()) runs.push({ marker: markWords.trim() });
      continue;
    }
    if (inMark && name === 'span') continue;

    if (name === 'aside') {
      flush();
      inNotes = !close && cls.includes('notes') ? true : close ? false : inNotes;
      continue;
    }
    if (/^h[2-6]$/.test(name)) {
      flush();
      if (!close) heading = Number(name[1]);
      continue;
    }
    if (BLOCKS.has(name)) {
      flush();
      if (!close && name === 'p') {
        end = cls.includes('end');
        if (inNotes) {
          // A note keeps its own id (`n3`, what its marker points at); one without gets the next free one.
          const id = /\bid="([^"]*)"/i.exec(attrs)?.[1];
          const taken = (x: string) => notes.some((n) => n.id === x);
          let fresh = notes.length + 1;
          while (taken(`n${fresh}`)) fresh++;
          note = { id: id && PAGE_ID.test(id) && !taken(id) ? id : `n${fresh}` };
        }
      }
      continue;
    }
    if (name === 'br') {
      runs.push({ br: true });
      continue;
    }
    const mark = MARKS[name];
    if (mark) {
      if (!close) marks.push(mark);
      else {
        const at = marks.lastIndexOf(mark);
        if (at >= 0) marks.splice(at, 1);
      }
    }
    // Any other tag (span, a, div, big) is dropped: its words stay.
  }
  flush();

  return {
    id: options.id,
    language: options.language,
    ...(options.title ? { title: options.title } : {}),
    ...(options.credit ? { credit: options.credit } : {}),
    ...(options.licence ? { licence: options.licence } : {}),
    ...(options.url ? { url: options.url } : {}),
    segments,
    ...(notes.length ? { notes } : {}),
  };
}
