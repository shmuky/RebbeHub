import { dateKeyToGregorian } from './dateKey.js';
import { MONTHS as MONTH_NAMES } from './months.js';
import { normalizeSearchText } from './normalize.js';
import { parseHebrewNumeral, toHebrewNumeral } from './numerals.js';
import { TANYA_YOMI } from './tanyaYomi.js';

/**
 * What the printed Hayom Yom puts at the head of each day, above its
 * words: the weekday and the year (on the calendar of 5703-5704, the year
 * it was written for, from 19 Kislev 5703 to 18 Kislev 5704), and the day's
 * shiurim, Chitas: Chumash (the week's parsha, a portion a day with
 * Rashi), Tehillim (the monthly cycle, with Elul's three more a day) and
 * Tanya (the yearly cycle).
 *
 * Chumash and Tehillim are worked out here the way the print sets them,
 * checked day by day against the Otzros scan of the book (every day it
 * has). The print's own ways are kept: a week of a festival learns the
 * parsha after it; the weeks from Yom Kippur to Simchas Torah learn
 * V'zos Habracha; a long parsha's name is shortened on Sunday. Tanya's
 * place is the day's start and end in the cycle; its words are the
 * catalog's (the print quotes the first and last of them).
 *
 * A schedule, not a text: nothing here is the book's words.
 */

/** Where the catalog keeps Tanya and Hayom Yom: their readable paths. */
export const DAILY_WORKS = { tanya: '/tanya', hayomYom: '/hayom-yom' } as const;

export interface HayomYomShiurim {
  /** `5703-05-04`: the day in the year the book was written for. */
  hebrew: string;
  /** `יום ראשון` … `יום ששי`, `שבת`, as the print heads the day. */
  weekday: string;
  /** `ה׳תש״ג` or `ה׳תש״ד`. */
  year: string;
  /** `בא, פרשה ראשונה עם פירש״י.` */
  chumash: string;
  /** `כג-כח.`; in Elul and the ten days, two ranges; on Yom Kippur, by the times it is said. */
  tehillim: string;
  /** Where the day's Tanya starts (the unit by its Sefaria reference, and the segment), and where the next day starts. */
  tanya: { unit: string; segment: string; next: { unit: string; segment: string } | null; label: string } | null;
  /** How many of the day's first paragraphs the print sets above the shiurim (a Shabbos Mevarchim's "מברכים", a fast's "תענית"). */
  before: number;
}

const WEEKDAYS = ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום ששי', 'שבת'];
const ALIYOS = ['פרשה ראשונה', 'שני', 'שלישי', 'רביעי', 'חמישי', 'ששי', 'שביעי'];

/**
 * The week's parsha, each week from Sunday to Shabbos, from the week of 19
 * Kislev 5703 (a Shabbos, Vayishlach) to that of 18 Kislev 5704, as the
 * print spells them. Pesach's week learns Acharei, as the week after it;
 * the three weeks from Yom Kippur to Simchas Torah learn V'zos Habracha.
 */
const WEEKS = [
  'וישלח', 'וישב', 'מקץ', 'ויגש', 'ויחי', 'שמות', 'וארא', 'בא', 'בשלח', 'יתרו', 'משפטים', 'תרומה', 'תצוה', 'כי תשא',
  'ויקהל', 'פקודי', 'ויקרא', 'צו', 'שמיני', 'תזריע', 'מצורע', 'אחרי מות', 'אחרי מות', 'קדושים', 'אמור', 'בהר', 'בחוקתי',
  'במדבר', 'נשא', 'בהעלותך', 'שלח', 'קרח', 'חוקת', 'בלק', 'פנחס', 'מטות-מסעי', 'דברים', 'ואתחנן', 'עקב', 'ראה', 'שופטים',
  'תצא', 'תבוא', 'נצבים וילך', 'האזינו', 'ברכה', 'ברכה', 'ברכה', 'נח', 'לך לך', 'וירא', 'חיי שרה', 'תולדות', 'ויצא',
  'וישלח', 'וישב',
] as const;

/** Sunday's line, where the print shortens it to fit: the parsha's name, or `פרשה` to `פ׳`. */
const SUNDAY: Record<string, string> = {
  'מטות-מסעי': 'מטו״ס, פרשה ראשונה',
  'נצבים וילך': 'נצו״י, פרשה ראשונה',
  'חיי שרה': 'ח״ש, פרשה ראשונה',
  ...Object.fromEntries(['וישלח', 'אחרי מות', 'בחוקתי', 'בהעלותך', 'ואתחנן', 'שופטים', 'האזינו', 'תולדות'].map((p) => [p, `${p}, פ׳ ראשונה`])),
};

/** Days the print sets otherwise, by `MM-DD` of the year's key: its own spellings, Simchas Torah and Shabbos Bereishis. */
const CHUMASH_DAYS: Record<string, string> = {
  // Ki Savo is spelled תבא on these days.
  '12-15': 'תבא, רביעי עם פירש״י.',
  '12-17': 'תבא, ששי עם פירש״י.',
  '12-18': 'תבא, שביעי עם פירש״י.',
  '08-24': 'בחוקותי, שני עם פירש״י.',
  '08-25': 'בחוקותי, שלישי עם פירש״י.',
  // Vayakhel's fourth and sixth, without "with Rashi".
  '06A-26': 'ויקהל, רביעי.',
  '06A-28': 'ויקהל, ששי.',
  // Simchas Torah finishes V'zos Habracha; Shabbos Bereishis learns all of Bereishis.
  '01-23': 'ברכה, ששי ושביעי עם פירש״י.',
  '01-24': 'בראשית, כל הסדרה עם פירש״י.',
};

/**
 * The days whose first paragraphs the print sets between the day's head and
 * its shiurim, and how many: the day's notices (מברכים החודש, a fast,
 * תחנון, what is said at the Seder), where the words of the day follow the
 * shiurim. Found by reading the scan's order against the catalog's
 * paragraphs, day by day; counts, not words.
 */
const BEFORE: Record<string, number> = {
  '03-26': 1, '04-10': 1, '04-25': 1, '05-15': 1, '06A-14': 1, '06B-13': 1, '06B-14': 3, '07-01': 2, '07-15': 1, '07-16': 1, '07-19': 2,
  '07-26': 2, '08-24': 1, '09-06': 1, '10-17': 1, '11-09': 1, '11-13': 1, '11-15': 1, '11-27': 1, '11-30': 1, '12-18': 1, '12-25': 3,
  '12-29': 1, '01-02': 1, '01-03': 1, '01-04': 1, '01-16': 1, '01-17': 3, '01-23': 1,
};

/** Tehillim's monthly cycle: the chapters of each day of the month (119 in two halves, on the 25th and 26th). */
const TEHILLIM: ReadonlyArray<readonly [number, number] | string> = [
  [1, 9], [10, 17], [18, 22], [23, 28], [29, 34], [35, 38], [39, 43], [44, 48], [49, 54], [55, 59], [60, 65], [66, 68], [69, 71], [72, 76], [77, 78],
  [79, 82], [83, 87], [88, 89], [90, 96], [97, 103], [104, 105], [106, 107], [108, 112], [113, 118], 'קיט, אשרי . . . מצותך מאד',
  'קיט, מה . . . לא שכחתי', [120, 134], [135, 139], [140, 144], [145, 150],
];

const numeral = (n: number) => toHebrewNumeral(n).replace(/[״׳]/g, '');
const range = ([a, b]: readonly [number, number]) => (a === b ? numeral(a) : `${numeral(a)}-${numeral(b)}`);

/** The Hebrew months in the order the book has them, each with its year and days (5703 had a second Adar). */
const MONTHS: ReadonlyArray<readonly [string, number, number]> = [
  ['03', 5703, 29], ['04', 5703, 29], ['05', 5703, 30], ['06A', 5703, 30], ['06B', 5703, 29], ['07', 5703, 30], ['08', 5703, 29], ['09', 5703, 30],
  ['10', 5703, 29], ['11', 5703, 30], ['12', 5703, 29], ['01', 5704, 30], ['02', 5704, 29], ['03', 5704, 30],
];

/** The day's number from 19 Kislev 5703 (0), or null for a day the book does not have. */
function dayIndex(month: string, day: number): { index: number; year: number; length: number } | null {
  // Kislev is in the book twice: from the 19th in 5703, to the 18th in 5704.
  const at = month === '03' ? (day >= 19 ? 0 : MONTHS.length - 1) : MONTHS.findIndex(([m]) => m === month);
  if (at < 0) return null;
  const [, year, length] = MONTHS[at]!;
  if (day < 1 || day > length || (at === MONTHS.length - 1 && day > 18)) return null;
  let index = 0;
  for (let i = 0; i < at; i++) index += MONTHS[i]![2] - (i === 0 ? 18 : 0);
  return { index: index + day - (at === 0 ? 19 : 1), year, length };
}

/**
 * The head of a Hayom Yom day as the print sets it, for the entry of a
 * month (a month token: `05` Shevat, `06A` and `06B` the Adars) and day;
 * null for a day the book does not have (a 30th of a 29-day month).
 */
export function hayomYomShiurim(month: string, day: number): HayomYomShiurim | null {
  const at = dayIndex(month, day);
  if (!at) return null;
  const hebrew = `${at.year}-${month}-${String(day).padStart(2, '0')}`;
  const civil = dateKeyToGregorian(hebrew);
  if (!civil) return null;
  const weekday = new Date(`${civil}T12:00:00Z`).getUTCDay();
  const key = `${month}-${String(day).padStart(2, '0')}`;

  // 19 Kislev 5703 is a Shabbos: the weeks turn on each Sunday after it.
  const parsha = WEEKS[Math.floor((at.index + 6) / 7)]!;
  const chumash = CHUMASH_DAYS[key] ?? `${weekday === 0 ? (SUNDAY[parsha] ?? `${parsha}, ${ALIYOS[0]}`) : `${parsha}, ${ALIYOS[weekday]}`} עם פירש״י.`;

  // The month's day, the 29th of a short month to the book's end; Elul and the ten days add three a day.
  const cycle = TEHILLIM[day - 1]!;
  const monthly = typeof cycle === 'string' ? cycle : range(day === 29 && at.length === 29 ? [140, 150] : cycle);
  const extra = month === '12' ? day : month === '01' && day < 10 ? 29 + day : 0;
  const tehillim =
    month === '01' && day === 10
      ? `${monthly}. קודם כל נדרי: קטו-קכג. קודם השינה: קכד-קלב. אחר מוסף: קלג-קמא. אחר נעילה: קמב-קנ.`
      : extra
        ? `${monthly}. ${range([extra * 3 - 2, extra * 3])}.`
        : `${monthly}.`;

  // Tanya by the cycle of a leap year, as 5703 was.
  const start = TANYA_YOMI.leap[key];
  const following = nextKey(month, day, at.length);
  const next = following ? TANYA_YOMI.leap[following] : undefined;
  // Where it ends: in the chapter it starts in, or the one after (not when the next day starts a chapter).
  const ends = next && next[0] !== start?.[0] && next[1] !== '1' ? next[0] : null;
  const tanya = start
    ? { unit: `Tanya, ${start[0]}`, segment: start[1], next: next ? { unit: `Tanya, ${next[0]}`, segment: next[1] } : null, label: [tanyaChapter(start[0]), ends ? tanyaChapter(ends) : null].filter(Boolean).join(' – ') }
    : null;

  return { hebrew, weekday: WEEKDAYS[weekday]!, year: at.year === 5703 ? 'ה׳תש״ג' : 'ה׳תש״ד', chumash, tehillim, tanya, before: BEFORE[key] ?? 0 };
}

/** The next day's `MM-DD` in the book's year. */
function nextKey(month: string, day: number, length: number): string | null {
  if (day < length) return `${month}-${String(day + 1).padStart(2, '0')}`;
  const at = MONTHS.findIndex(([m], i) => m === month && (month !== '03' || i === 0));
  const after = MONTHS[at + 1];
  return after ? `${after[0]}-01` : null;
}

/**
 * A Tanya chapter's name in Hebrew, as its Sefaria reference (without
 * "Tanya, ") names it: `Part I; Likkutei Amarim 17` is `פרק יז`.
 */
export function tanyaChapter(ref: string): string {
  const n = /(\d+)$/.exec(ref)?.[1];
  const num = n ? numeral(Number(n)) : '';
  if (ref.includes('Title Page')) return 'שער הספר';
  if (ref.includes('Approbation')) return 'הסכמות';
  if (ref.includes('Compiler')) return 'הקדמת המלקט';
  if (ref.includes('Chinukh Katan')) return 'חנוך קטן';
  if (ref.startsWith('Part I;')) return `פרק ${num}`;
  if (ref.startsWith('Part II;')) return `שעהיוה״א, פרק ${num}`;
  if (ref.startsWith('Part III;')) return `אגה״ת, פרק ${num}`;
  if (ref.startsWith('Part IV;')) return `אגה״ק, ${num}`;
  if (ref.startsWith('Part V;')) return `קו״א, ${num}`;
  return ref;
}

/** A Hayom Yom month's name as its section is titled (`<h2>מנחם אב</h2>`), as a month token. */
export function monthOfLabel(label: unknown): string | null {
  const he = typeof label === 'object' && label ? String((label as { he?: string }).he ?? '') : '';
  const text = normalizeSearchText(he.replace(/<[^>]*>/g, ''));
  const month = MONTH_NAMES.find((m) => [m.he, ...m.aliases].some((name) => normalizeSearchText(name) === text));
  return month?.token ?? null;
}

/** The day of the month a Hayom Yom entry is for, from its title (`<h3>א טבת ר"ח, ו' דחנוכה</h3>` is 1). */
export function dayOfLabel(data: unknown): number | null {
  const he = String(((data as { label?: { he?: string } }).label ?? {}).he ?? '').replace(/<[^>]*>/g, '').trim();
  return parseHebrewNumeral(he.split(/\s+/)[0] ?? '');
}

/** The head of a Hayom Yom entry, from where it is in the sefer (its month's section) and its title. */
export function hayomYomShiurimOf(data: unknown): HayomYomShiurim | null {
  const month = monthOfLabel(((data as { position?: Array<{ label?: unknown }> }).position ?? [])[0]?.label);
  const day = dayOfLabel(data);
  return month && day ? hayomYomShiurim(month, day) : null;
}
