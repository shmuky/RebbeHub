import type { Language, MachineOrigin } from './entities.js';

/**
 * A page's words as structure, not markup: versions (a chapter's Hebrew
 * and its English), each a tree of segments (sections holding headings,
 * paragraphs, numbered verses, outline items), and each segment's words as
 * runs of text with a small, fixed set of marks. Nothing in it is ever
 * read as HTML, so it is safe to draw as it is; every segment has an id
 * that stays put, so a change shows as the segment it changed, two people
 * fixing different segments never clash, and a link can point at one
 * segment (`#s-3.14`).
 *
 * How a page is drawn is its `profile`, the display rules of where its
 * words came from: `sefaria` (numbered segments in chapters, the Hebrew
 * and English side by side, footnotes, the credit line), `sichos-kodesh`
 * (the texts Sichos-Kodesh publishes: paragraphs, headings, a letter's
 * lines set to the end side, versions one at a time), `outline` (a
 * farbrengen's contents from the Mafteiach: numbered items under
 * headings), and `plain` (what people write on RebbeHub itself).
 */

export type TextProfile = 'plain' | 'sefaria' | 'sichos-kodesh' | 'outline';
export const TEXT_PROFILES: readonly TextProfile[] = ['plain', 'sefaria', 'sichos-kodesh', 'outline'];

/** The marks a run of words may carry: bold, italic, underline, small, raised, lowered. Nothing else. */
export type PageMark = 'b' | 'i' | 'u' | 'small' | 'sup' | 'sub';
export const PAGE_MARKS: readonly PageMark[] = ['b', 'i', 'u', 'small', 'sup', 'sub'];

/**
 * One piece of a segment's words: a run of text (with its marks, and a
 * link when it is one), a footnote's marker (the note's id in its
 * version's `notes`), a source's own marker kept as it is (a page of the
 * printed edition, a day of the study cycle), or a line break.
 */
export type PageInline = { text: string; marks?: PageMark[]; href?: string } | { note: string } | { marker: string } | { br: true };

export type PageSegmentKind = 'section' | 'heading' | 'paragraph' | 'verse' | 'item' | 'note';
export const PAGE_SEGMENT_KINDS: readonly PageSegmentKind[] = ['section', 'heading', 'paragraph', 'verse', 'item', 'note'];

/** One segment of a version: a section (its title, and the segments in it), a heading, a paragraph, a numbered verse, an outline item, a footnote. */
export interface PageSegment {
  /** Stable within its version, and the same in every version for the same place (Sefaria's `3.14` in Hebrew and English). */
  id: string;
  kind: PageSegmentKind;
  /** Its number as the source counts it: verse 14, footnote 3, item 2. */
  n?: number;
  /** How the source marks it when that is not its number (a footnote's `*`). */
  label?: string;
  /** A heading's level, 1 the highest. */
  level?: 1 | 2 | 3 | 4;
  /** Set to the line's end side, as a letter's date and signature are printed. */
  end?: boolean;
  /** Its words (a section's title). */
  text?: PageInline[];
  /** A section's segments. */
  children?: PageSegment[];
  /** Set when a machine made it; labelled until a person checks it. */
  origin?: MachineOrigin;
}

/** One version of a page's words: a language and edition, with its credit. */
export interface PageVersion {
  /** `he`, `en`, or any short name, stable within the page. */
  id: string;
  language: Language;
  /** The edition's own name (Sefaria's version title). */
  title?: string;
  credit?: string;
  licence?: string;
  /** Where this version is read at its source. */
  url?: string;
  segments: PageSegment[];
  /** Its footnotes, pointed to from the words by id. */
  notes?: PageSegment[];
  origin?: MachineOrigin;
}

/** A page's words (entities.ts, `CommonFields.body`). */
export interface PageText {
  profile: TextProfile;
  versions: PageVersion[];
}

/** An id a segment or version may have: short, and safe in a URL fragment. */
export const PAGE_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$';
const PAGE_ID = new RegExp(PAGE_ID_PATTERN);
/** Where a link may go: the web, a path on RebbeHub, or an item by id. */
export const PAGE_HREF_PATTERN = '^(https?://[^\\s]+|/[^\\s]*|rh-[0-9a-hjkmnp-tv-z]{6,16})$';
const PAGE_HREF = new RegExp(PAGE_HREF_PATTERN);

export const isPageId = (id: unknown): id is string => typeof id === 'string' && PAGE_ID.test(id);
export const isPageHref = (href: unknown): href is string => typeof href === 'string' && href.length <= 2000 && PAGE_HREF.test(href);

export function isPageText(value: unknown): value is PageText {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as PageText).versions) && typeof (value as PageText).profile === 'string');
}

// ---------------------------------------------------------------- reading

/** A segment's words as plain text: runs joined, line breaks as newlines; markers and footnote marks left out. */
export function inlineText(runs: readonly PageInline[] | undefined): string {
  let out = '';
  for (const run of runs ?? []) {
    if ('text' in run) out += run.text;
    else if ('br' in run) out += '\n';
  }
  return out;
}

/** Every segment of a list, depth first, in reading order. */
export function* allSegments(segments: readonly PageSegment[] | undefined): Generator<PageSegment> {
  for (const segment of segments ?? []) {
    yield segment;
    if (segment.children) yield* allSegments(segment.children);
  }
}

/**
 * A page's words as plain text, for search, reading by meaning and
 * finding citations: every version, segment by segment, then its notes.
 * A body from before words had structure (a string) is taken as it is.
 */
export function pageTextPlain(body: unknown): string {
  if (typeof body === 'string') return body;
  if (!isPageText(body)) return '';
  const lines: string[] = [];
  for (const version of body.versions) {
    for (const segment of allSegments(version.segments)) {
      const words = inlineText(segment.text).trim();
      if (words) lines.push(words);
    }
    for (const note of version.notes ?? []) {
      const words = inlineText(note.text).trim();
      if (words) lines.push(words);
    }
  }
  return lines.join('\n');
}

/** Where a segment is in a version: its list (the version's, a section's, or the notes) and its place there. */
export function findSegment(version: PageVersion, id: string): { segment: PageSegment; list: PageSegment[]; index: number } | null {
  const search = (list: PageSegment[]): { segment: PageSegment; list: PageSegment[]; index: number } | null => {
    for (const [index, segment] of list.entries()) {
      if (segment.id === id) return { segment, list, index };
      if (segment.children) {
        const found = search(segment.children);
        if (found) return found;
      }
    }
    return null;
  };
  return search(version.segments) ?? (version.notes ? search(version.notes) : null);
}

/** A fresh segment id for a version: `p` and the next number no segment there uses. */
export function newSegmentId(version: PageVersion, prefix = 'p'): string {
  const used = new Set<string>();
  for (const s of allSegments(version.segments)) used.add(s.id);
  for (const s of version.notes ?? []) used.add(s.id);
  let n = used.size + 1;
  while (used.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

// ---------------------------------------------------------------- writing

/**
 * Words made tidy, the one form they are kept in: adjacent runs with the
 * same marks and link joined, empty runs dropped, marks in their fixed
 * order and never twice, spaces at the segment's two ends trimmed. Links
 * that are not the web, a RebbeHub path or an id lose their link.
 */
export function tidyInline(runs: readonly PageInline[]): PageInline[] {
  const out: PageInline[] = [];
  for (const run of runs) {
    if ('text' in run) {
      if (typeof run.text !== 'string' || !run.text) continue;
      const marks = PAGE_MARKS.filter((m) => run.marks?.includes(m));
      const href = isPageHref(run.href) ? run.href : undefined;
      const text = run.text.replace(/[\r\n\t]+/g, ' ');
      const last = out[out.length - 1];
      if (last && 'text' in last && (last.href ?? '') === (href ?? '') && (last.marks ?? []).join() === marks.join()) {
        last.text += text;
        continue;
      }
      out.push({ text, ...(marks.length ? { marks } : {}), ...(href ? { href } : {}) });
    } else if ('note' in run) {
      if (isPageId(run.note)) out.push({ note: run.note });
    } else if ('marker' in run) {
      if (typeof run.marker === 'string' && run.marker.trim()) out.push({ marker: run.marker.trim() });
    } else if ('br' in run) {
      if (out.length && !('br' in out[out.length - 1]!)) out.push({ br: true });
    }
  }
  // No spaces or breaks at the ends.
  while (out.length && 'br' in out[out.length - 1]!) out.pop();
  const first = out[0];
  if (first && 'text' in first) first.text = first.text.replace(/^\s+/, '');
  const last = out[out.length - 1];
  if (last && 'text' in last) last.text = last.text.replace(/\s+$/, '');
  for (const run of out) if ('text' in run) run.text = run.text.replace(/ {2,}/g, ' ');
  return out.filter((r) => !('text' in r) || r.text.length > 0);
}

/** Plain words as runs: taken literally, line breaks kept. */
export function plainInline(text: string): PageInline[] {
  const runs: PageInline[] = [];
  text.split('\n').forEach((line, i) => {
    if (i > 0) runs.push({ br: true });
    runs.push({ text: line });
  });
  return tidyInline(runs);
}

/** A page of plain paragraphs (one per blank-line-separated block): what a person starts a page with, and how a body from before structure is shown. */
export function plainPage(text: string, language: Language = 'he', profile: TextProfile = 'plain'): PageText {
  const segments: PageSegment[] = text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((block) => plainInline(block.trim()))
    .filter((runs) => runs.length > 0)
    .map((runs, i) => ({ id: `p${i + 1}`, kind: 'paragraph', text: runs }));
  return { profile, versions: [{ id: language, language, segments }] };
}

/** A page's words with one segment's replaced, or removed (`null`), or a new segment put after it; the rest untouched. */
export function changeSegment(page: PageText, versionId: string, segmentId: string, change: { text?: PageInline[]; remove?: true; after?: PageSegment }): PageText {
  const next = structuredClone(page);
  const version = next.versions.find((v) => v.id === versionId);
  if (!version) throw new RangeError(`no version "${versionId}"`);
  const found = findSegment(version, segmentId);
  if (!found) throw new RangeError(`no segment "${segmentId}" in version "${versionId}"`);
  if (change.remove) found.list.splice(found.index, 1);
  else if (change.after) found.list.splice(found.index + 1, 0, change.after);
  else if (change.text) {
    found.segment.text = change.text;
    // A person has now read it: a machine's segment is checked.
    if (found.segment.origin) found.segment.origin = { ...found.segment.origin, checked: true };
  }
  return next;
}
