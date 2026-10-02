import type { PageSegment, PageText } from '@rebbehub/model';

/**
 * What a letter's own opening lines say: the date (after ב״ה), the place,
 * and who it is to, as the design's letter page (5b, 5d) shows them under
 * its name. Nothing is stored: the lines are read from the letter's words
 * each time, so a fix to them shows here. Most of the Rebbe's letters open
 * the same way: ב״ה with the date, the place, the addressee, then "שלום
 * וברכה" alone on its line. A letter that does not is left as it is.
 */
export interface LetterOpening {
  date?: string;
  place?: string;
  to?: string;
  /** The date and place lines, set to the line's end as a letter prints them. */
  end: string[];
}

const GREETING = /^(שלום וברכה|ברכה ושלום|שלו״ב|שלו"ב)[!.]?$/;
const BH = /^ב["״]ה[,.]?\s*/;
/** Only its first lines are looked at: a greeting further in is not the letter's opening. */
const OPENING = 6;
/** A line longer than this is the letter's body, not its heading. */
const SHORT = 90;

const plain = (segment: PageSegment) =>
  (segment.text ?? [])
    .map((run) => ('text' in run ? run.text : 'br' in run ? ' ' : ''))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();

/** True for the line a letter greets with, alone on its line. */
export function isGreeting(segment: PageSegment): boolean {
  return segment.kind === 'paragraph' && GREETING.test(plain(segment));
}

export function letterOpening(page: PageText): LetterOpening | null {
  const version = page.versions.find((v) => v.segments.length);
  if (!version) return null;
  const lines = version.segments.slice(0, OPENING);
  const greeting = lines.findIndex(isGreeting);
  if (greeting < 1) return null;
  const head = lines.slice(0, greeting);
  if (head.some((s) => s.kind !== 'paragraph' || plain(s).length > SHORT)) return null;
  const first = plain(head[0]!);
  if (!BH.test(first)) return null;
  // The line just before the greeting is the addressee, unless it is the dateline itself.
  const to = head.length > 1 ? plain(head[head.length - 1]!) : undefined;
  const dateline = head.length > 1 ? head.slice(0, -1) : head;
  const date = first.replace(BH, '').replace(/[.,]$/, '') || undefined;
  const place = dateline.length > 1 ? plain(dateline[1]!).replace(/[.,]$/, '') : undefined;
  return { date, place, to, end: dateline.map((s) => s.id) };
}

/** The letter's words with its date and place lines set to the line's end, for reading only. */
export function shapeLetter(page: PageText, opening: LetterOpening): PageText {
  const end = new Set(opening.end);
  return { ...page, versions: page.versions.map((v, i) => (i === page.versions.findIndex((x) => x.segments.length) ? { ...v, segments: v.segments.map((s) => (end.has(s.id) ? { ...s, end: true } : s)) } : v)) };
}
