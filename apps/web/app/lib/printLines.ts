import { allSegments, type PageInline, type PageSegment, type PageVersion } from '@rebbehub/model';

/**
 * A sicha set again as it was printed, line for line, from the line ends
 * the reader keeps in its words ({ eol }, with the line's page and box on
 * the scan). Each printed line becomes one line here, at the place it
 * stands on the page, so the text can be shown as the page itself: two
 * columns, the footnotes under them, a broken word broken where the print
 * broke it.
 */

export type PrintLineKind = 'heading' | 'body' | 'end' | 'note';

export interface PrintLine {
  kind: PrintLineKind;
  /** x, y, width, height as fractions (0-1) of its page. */
  box: [number, number, number, number];
  runs: PageInline[];
  /** The first printed line of its paragraph or note (a note's number goes before it). */
  first: boolean;
  /** The last printed line of its paragraph or note: set flush, not stretched. */
  last: boolean;
  /** The print broke a word at the end of this line with a hyphen. */
  split: boolean;
  /** A note's label (its number, or a star) on its first line. */
  label?: string;
  level?: number;
}

export interface PrintPage {
  /** The page of the scan, from 1. */
  page: number;
  /** Its printed number, where the words say where it starts. */
  printed: string | null;
  lines: PrintLine[];
  /** Body and note type sizes, as fractions of the page's height: the middle line height of each. */
  bodySize: number;
  noteSize: number;
}

const median = (xs: number[], fallback: number) => {
  if (!xs.length) return fallback;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

const wordsOf = (runs: PageInline[]) => runs.reduce((n, r) => n + ('text' in r ? r.text.trim().length : 0), 0);

/**
 * The version's printed lines, page by page; null when too few of its
 * words carry a printed line end to set it as the page (a reading from a
 * plain text file, or a sicha typed by hand).
 */
export function printPagesOf(version: PageVersion | undefined): PrintPage[] | null {
  if (!version) return null;
  const pages = new Map<number, PrintPage>();
  let placed = 0;
  let total = 0;
  let nextPrinted: string | null = null;
  const pageOf = (n: number) => {
    let p = pages.get(n);
    if (!p) pages.set(n, (p = { page: n, printed: null, lines: [], bodySize: 0, noteSize: 0 }));
    return p;
  };

  const take = (segment: PageSegment, kind: PrintLineKind, label?: string) => {
    const runs = segment.text ?? [];
    total += wordsOf(runs);
    let line: PageInline[] = [];
    const made: Array<{ page: number; line: PrintLine }> = [];
    for (const run of runs) {
      if ('marker' in run) {
        nextPrinted = run.marker;
        continue;
      }
      if (!('eol' in run)) {
        line.push(run);
        continue;
      }
      if (!run.page || !run.box) continue;
      const page = pageOf(run.page);
      if (nextPrinted && !page.printed) page.printed = nextPrinted;
      nextPrinted = null;
      placed += wordsOf(line);
      made.push({ page: run.page, line: { kind, box: run.box, runs: line, first: made.length === 0, last: false, split: run.split === true, ...(made.length === 0 && label ? { label } : {}), ...(segment.level ? { level: segment.level } : {}) } });
      line = [];
    }
    if (made.length) made[made.length - 1]!.line.last = true;
    for (const { page, line: l } of made) pageOf(page).lines.push(l);
  };

  for (const segment of allSegments(version.segments)) {
    if (segment.kind === 'section') continue;
    take(segment, segment.kind === 'heading' ? 'heading' : segment.end ? 'end' : 'body');
  }
  for (const note of version.notes ?? []) take(note, 'note', note.label ?? (note.n !== undefined ? String(note.n) : undefined));

  if (!total || placed / total < 0.9) return null;
  const out = [...pages.values()].sort((a, b) => a.page - b.page);
  for (const page of out) {
    page.bodySize = median(
      page.lines.filter((l) => l.kind === 'body').map((l) => l.box[3]),
      0.0115,
    );
    page.noteSize = median(
      page.lines.filter((l) => l.kind === 'note').map((l) => l.box[3]),
      page.bodySize * 0.75,
    );
  }
  // A page whose number the words do not give takes it from its neighbour.
  out.forEach((page, i) => {
    if (page.printed) return;
    const before = out[i - 1]?.printed;
    if (before && /^\d+$/.test(before)) page.printed = String(Number(before) + (page.page - out[i - 1]!.page));
  });
  return out;
}

/** Each note's printed label by its id: its number, or its star. */
export function noteLabels(version: PageVersion | undefined): Record<string, string> {
  return Object.fromEntries((version?.notes ?? []).map((n) => [n.id, n.label ?? (n.n !== undefined ? String(n.n) : '*')]));
}
