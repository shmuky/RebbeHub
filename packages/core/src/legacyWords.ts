import { tidyInline, type Language, type PageInline, type PageMark, type PageSegment, type PageText, type PageVersion, type TextProfile } from '@rebbehub/model';

/**
 * Reading page bodies kept before words had structure (built-in schemas
 * before version 5), when a page's body was a string of wiki markup. It is
 * read once, into the structure every page now has (pageText.ts), and
 * never written again: `convertLegacyBodies` turns the catalog's bodies
 * over, and anything older still met (a revision in the history, a
 * suggestion sent before the change) is read the same way on its way in
 * and out. Nothing here is ever drawn as markup.
 *
 * What the importers wrote is recognised by where it came from: an
 * outline from the Mafteiach, the texts of Sefaria and Sichos-Kodesh, and
 * a second version that stood under a heading of its own (its English).
 * Re-running those importers brings their words in again from the source,
 * with the footnotes and side-by-side versions the markup had lost.
 */

const ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&nbsp;': ' ' };
const INLINE = /('''|''|\[\[[^\]\n]+\]\]|\[https?:\/\/[^\s\]]+(?: [^\]\n]+)?\]|<ref>[\s\S]*?<\/ref>|<br\s*\/?>|<nowiki\s*\/>|<\/?(?:u|sup|sub|small)>|&(?:lt|gt|amp|quot|nbsp);)/;
const TAG_MARK: Record<string, PageMark> = { u: 'u', sup: 'sup', sub: 'sub', small: 'small' };

/** Which display rules a page's old body is read with, from where it was imported. */
export function legacyProfile(bodySource: unknown): TextProfile {
  const s = (bodySource ?? {}) as { source?: string; via?: string };
  if (s.via === 'mafteiach-index' || s.source === 'mafteiach') return 'outline';
  if (s.via === 'sefaria' || s.via === 'sefaria-index' || s.source === 'sefaria') return 'sefaria';
  if (s.via === 'chabadlibrary' || s.source === 'chabadlibrary') return 'chabad-library';
  if (s.via === 'igros-index' || s.source === 'igros-app') return 'sichos-kodesh';
  return 'plain';
}

/** One line's markup as runs; its <ref>s become notes of `notes`. */
function inline(text: string, notes: PageSegment[]): PageInline[] {
  const out: PageInline[] = [];
  const marks: PageMark[] = [];
  const toggle = (mark: PageMark) => {
    const at = marks.lastIndexOf(mark);
    if (at >= 0) marks.splice(at, 1);
    else marks.push(mark);
  };
  for (const part of text.split(INLINE)) {
    if (!part) continue;
    if (part === "'''") toggle('b');
    else if (part === "''") toggle('i');
    else if (/^<(u|sup|sub|small)>$/.test(part)) marks.push(TAG_MARK[part.slice(1, -1)]!);
    else if (/^<\/(u|sup|sub|small)>$/.test(part)) {
      const at = marks.lastIndexOf(TAG_MARK[part.slice(2, -1)]!);
      if (at >= 0) marks.splice(at, 1);
    } else if (/^<br/.test(part)) out.push({ br: true });
    else if (/^<nowiki/.test(part)) continue;
    else if (part.startsWith('[[')) {
      const [target, label] = part.slice(2, -2).split('|');
      const t = target!.trim();
      const href = /^rh-[0-9a-z]+$/i.test(t) ? t.toLowerCase() : t.startsWith('/') ? t : undefined;
      out.push({ text: label ?? t, ...(marks.length ? { marks: [...marks] } : {}), ...(href ? { href } : {}) });
    } else if (part.startsWith('[http')) {
      const inner = part.slice(1, -1);
      const space = inner.indexOf(' ');
      const url = space === -1 ? inner : inner.slice(0, space);
      out.push({ text: space === -1 ? url : inner.slice(space + 1), href: url, ...(marks.length ? { marks: [...marks] } : {}) });
    } else if (part.startsWith('<ref>')) {
      const id = `n${notes.length + 1}`;
      const words = tidyInline(inline(part.slice(5, -6), []));
      if (words.length) {
        notes.push({ id, kind: 'note', n: notes.length + 1, text: words });
        out.push({ note: id });
      }
    } else if (part.startsWith('&')) out.push({ text: ENTITIES[part] ?? part, ...(marks.length ? { marks: [...marks] } : {}) });
    else out.push({ text: part, ...(marks.length ? { marks: [...marks] } : {}) });
  }
  return tidyInline(out);
}

const hasHebrew = (text: string) => /[֐-׿]/.test(text);

/** An old body (a string of wiki markup) as a page's structured words. */
export function fromWikitext(text: string, profile: TextProfile = 'plain', language: Language = 'he'): PageText {
  const versions: PageVersion[] = [];
  let version!: PageVersion;
  let notes: PageSegment[] = [];
  let section: PageSegment | null = null;
  let counter = 0;
  let verse = 0;
  const open = (id: string, lang: Language, title?: string) => {
    notes = [];
    version = { id, language: lang, ...(title ? { title } : {}), segments: [] };
    versions.push(version);
    section = null;
    counter = 0;
    verse = 0;
  };
  const close = () => {
    if (notes.length) version.notes = notes;
  };
  open(language, language);
  const push = (segment: PageSegment) => (section ? section.children! : version.segments).push(segment);
  let paragraph: string[] = [];
  const flush = () => {
    if (!paragraph.length) return;
    const line = paragraph.join(' ');
    paragraph = [];
    const numbered = profile === 'outline' ? /^(\d{1,4})[.)]\s+(.+)$/.exec(line) : null;
    const runs = inline(numbered ? numbered[2]! : line, notes);
    if (!runs.length) return;
    counter++;
    if (profile === 'outline') push({ id: section ? `${section.id}.${section.children!.length + 1}` : `p${counter}`, kind: 'item', ...(numbered ? { n: Number(numbered[1]) } : {}), text: runs });
    else if (profile === 'sefaria') {
      verse++;
      push({ id: section ? `${section.id}.${verse}` : String(verse), kind: 'verse', n: verse, text: runs });
    } else push({ id: `p${counter}`, kind: 'paragraph', text: runs });
  };

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const heading = /^(={2,5})\s*(.+?)\s*\1$/.exec(line);
    const item = /^([*#:])\s*(.*)$/.exec(line);
    if (!line.trim() || /^-{4,}$/.test(line)) {
      flush();
    } else if (heading) {
      flush();
      const title = heading[2]!;
      const runs = inline(title, notes);
      // A heading with no Hebrew over Hebrew words was a second version's own (its English), as the importers wrote it.
      const words = versions.flatMap((v) => v.segments).length > 0;
      if (profile !== 'plain' && profile !== 'outline' && words && !hasHebrew(title) && version.language === 'he') {
        close();
        open(versions.some((v) => v.id === 'en') ? `v${versions.length + 1}` : 'en', 'en', title.replace(/'''|''/g, ''));
        continue;
      }
      if (profile === 'plain' || profile === 'sichos-kodesh' || profile === 'chabad-library') {
        push({ id: `h${++counter}`, kind: 'heading', level: Math.min(4, heading[1]!.length - 1) as 1 | 2 | 3 | 4, text: runs });
        continue;
      }
      // Sefaria's sub-headings and the outline's headings open a section.
      const n = version.segments.filter((s) => s.kind === 'section').length + 1;
      const opened: PageSegment = { id: profile === 'outline' ? `s${n}` : String(n), kind: 'section', ...(profile === 'sefaria' ? { n } : {}), text: runs, children: [] };
      version.segments.push(opened);
      section = opened;
      verse = 0;
    } else if (item) {
      flush();
      if (profile === 'plain' || profile === 'sichos-kodesh' || profile === 'chabad-library') {
        const runs = inline(item[2]!, notes);
        if (runs.length) push({ id: `p${++counter}`, kind: 'item', text: runs });
      } else {
        paragraph = [item[2]!];
        flush();
      }
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  close();
  const kept = versions.filter((v) => v.segments.length);
  return { profile, versions: kept.length ? kept : [{ id: language, language, segments: [] }] };
}

/**
 * An item's data with its body as structured words: an old string body is
 * read (by where it came from), an empty one dropped. Anything else is
 * returned as it is, the same object.
 */
export function withStructuredBody<T>(data: T): T {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const d = data as Record<string, unknown>;
  if (typeof d.body !== 'string') return data;
  const { body, ...rest } = d;
  const words = (body as string).trim();
  if (!words) return rest as T;
  const page = fromWikitext(words, legacyProfile(d.bodySource));
  if (!page.versions.some((v) => v.segments.length)) return rest as T;
  return { ...rest, body: page } as T;
}
