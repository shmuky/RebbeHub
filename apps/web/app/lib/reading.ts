import type { MachineOrigin, PageInline, PageMark, PageSegment, PageText } from '@rebbehub/model';

/**
 * A page our reader read (the Likkutei Sichos OCR model), for a showcase:
 * the text file the reader writes for a sicha, made into the site's own
 * words (PageText) so it draws as every text on RebbeHub does.
 *
 * The reader's file, as RebbeHub-OCR's assemble step writes it:
 *
 *   title: …                 (optional, first lines: the sicha's name,
 *   scan: https://…           its scan's address)
 *   ## {62}בהעלותך 2)        a heading; {62} is a printed page starting
 *   ### אות א                the reader's own label of a piece: not printed, left out
 *   ⦃א.⦄ איתא בספרי[1] …     a paragraph: ⦃…⦄ the ois letter, ⟨…⟩ Miram
 *                            (written as bold), [1] a footnote's mark
 *   ---                      the footnotes follow
 *   1) פרשתנו י, י.
 *   *) [level 2] …           a note on a note, marked * as printed
 *
 * It stays machine-read, and labelled so, until a person checks it.
 */

export interface Reading {
  title: string;
  /** Where its scan is (a Drive or RebbeHub address), as the file names it; the showcase keeps its own copy of the address. */
  scan: string | null;
  body: PageText;
}

const HEBREW_DIGITS = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const MAX_LINES = 4000;

/** A note's id from its mark: `[12]` is n12, `[*]` is n-star. */
const noteId = (mark: string) => (mark === '*' ? 'n-star' : `n${mark}`);

/** One line's words: the ois letter, Miram, page markers and footnote marks as the site's runs. */
export function readingInline(line: string): PageInline[] {
  const runs: PageInline[] = [];
  const token = /\{(\d{1,4})\}|\[(\d{1,3}|\*)\]|⟨([^⟩]*)⟩|⦃([^⦄]*)⦄/g;
  let at = 0;
  const words = (text: string, marks?: PageMark[]) => {
    if (text) runs.push(marks ? { text, marks } : { text });
  };
  for (let m = token.exec(line); m; m = token.exec(line)) {
    words(line.slice(at, m.index));
    if (m[1]) runs.push({ marker: m[1] });
    else if (m[2]) runs.push({ note: noteId(m[2]) });
    else if (m[3] !== undefined) words(m[3], ['b']);
    else if (m[4] !== undefined) words(m[4], ['ois']);
    at = m.index + m[0].length;
  }
  words(line.slice(at));
  return runs;
}

/**
 * The reader reads a heading's sicha letter (בהעלותך ב) as a number and a
 * bracket ("בהעלותך 2)"): written back as the letter it is.
 */
const headingWords = (line: string) => line.replace(/\s(\d)\)\s*$/, (_, d: string) => ` ${HEBREW_DIGITS[Number(d)] ?? d}`);

/** The reader's file as a reading; null when it holds no words. */
export function readingOf(file: string, fallbackTitle = ''): Reading | null {
  const lines = file.replace(/\r/g, '').split('\n').slice(0, MAX_LINES);
  let title = '';
  let scan: string | null = null;
  const segments: PageSegment[] = [];
  const notes: PageSegment[] = [];
  let inNotes = false;
  let n = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const header = /^(title|scan):\s*(.+)$/i.exec(line);
    if (header && !segments.length && !inNotes) {
      if (header[1]!.toLowerCase() === 'title') title = header[2]!.trim().slice(0, 200);
      else if (/^https:\/\/\S+$/.test(header[2]!.trim())) scan = header[2]!.trim();
      continue;
    }
    if (line === '---') {
      inNotes = true;
      continue;
    }
    if (line.startsWith('### ')) continue;
    if (inNotes) {
      const note = /^(\d{1,3}|\*)\)\s*(?:\[level 2\]\s*)?(.*)$/.exec(line);
      if (note) {
        const mark = note[1]!;
        notes.push({ id: noteId(mark), kind: 'note', ...(mark === '*' ? { label: '*' } : { n: Number(mark) }), text: readingInline(note[2]!) });
      } else if (notes.length) {
        // A footnote that runs on to another line.
        notes[notes.length - 1]!.text!.push({ text: ' ' }, ...readingInline(line));
      }
      continue;
    }
    const heading = /^##\s+(.*)$/.exec(line);
    if (heading) {
      const words = readingInline(headingWords(heading[1]!));
      segments.push({ id: `h${++n}`, kind: 'heading', level: 2, text: words });
      if (!title) title = words.map((r) => ('text' in r ? r.text : '')).join('').trim();
      continue;
    }
    segments.push({ id: `p${++n}`, kind: 'paragraph', text: readingInline(line) });
  }
  if (!segments.length) return null;
  const origin: MachineOrigin = { by: 'ocr:rebbehub-kraken-ls-v1', checked: false };
  return {
    title: title || fallbackTitle,
    scan,
    body: { profile: 'plain', versions: [{ id: 'he', language: 'he', segments, notes, origin }] },
  };
}
