import { HDate } from '@hebcal/core';
import { formatDateKey, parseDateKey, validateDateKey, type DateKey } from './dateKey.js';
import { MONTHS, type MonthInfo } from './months.js';
import { normalizeSearchText } from './normalize.js';
import { parseHebrewNumeral } from './numerals.js';

export type ParsedDate = { ok: true; key: DateKey } | { ok: false; reason: string };

interface MonthPhrase {
  words: string[];
  month: MonthInfo;
}

const MONTH_PHRASES: MonthPhrase[] = MONTHS.flatMap((month) =>
  [month.en, month.he, ...month.aliases].map((name) => ({ words: normalizeSearchText(name).split(' '), month })),
)
  // Longest first, so "adar ii" is taken before "adar".
  .sort((a, b) => b.words.length - a.words.length);

const LETTER_VALUE = (ch: string): number => parseHebrewNumeral(ch) ?? 0;

/** A year token: 5742, תשמב, התשמב (ה as the thousands). */
function yearOf(token: string): number | null {
  if (/^\d{4}$/.test(token)) return Number(token);
  if (!/^[א-ת]+$/.test(token)) return null;
  let letters = token;
  // Numerals are written largest letter first, so a leading ה followed by a
  // larger letter is the thousands (ה׳תשמ״ב), not five.
  if (letters.length >= 3 && letters[0] === 'ה' && LETTER_VALUE(letters[1]!) > 5) letters = letters.slice(1);
  // A numeral runs from its largest letter down (תשמב); a word whose letters
  // climb (באתי) only adds up to a year by chance.
  const values = [...letters].map(LETTER_VALUE);
  if (values.some((v, i) => i > 0 && v > values[i - 1]!)) return null;
  const value = parseHebrewNumeral(letters);
  return value !== null && value >= 100 && value < 1000 ? 5000 + value : null;
}

/** A day token: 10, 10th, י, יוד, טו. */
function dayOf(token: string): number | null {
  const digits = /^(\d{1,2})(?:st|nd|rd|th)?$/.exec(token);
  const value = digits ? Number(digits[1]) : /^[א-ת]+$/.test(token) ? parseHebrewNumeral(token) : null;
  return value !== null && value >= 1 && value <= 30 ? value : null;
}

/**
 * Reads a Hebrew date however people write it, in Hebrew or English:
 * `יו"ד שבט תשכ"ב`, `י' שבט ה'תשכ"ב`, `10 Shvat 5722`, `Shvat 10, 5722`,
 * `the 10th of Shevat 5722`, `Shevat 5722`, `5722`, `5722-05-10`.
 * In a leap year a plain "Adar" is refused as ambiguous rather than guessed.
 */
export function parseDateText(text: string): ParsedDate {
  const raw = text.trim();
  if (parseDateKey(raw)) {
    const check = validateDateKey(raw);
    return check.ok ? { ok: true, key: raw } : { ok: false, reason: check.reason };
  }
  let tokens = normalizeSearchText(raw).split(' ').filter((t) => t.length > 0);
  let month: MonthInfo | undefined;
  for (const phrase of MONTH_PHRASES) {
    const at = tokens.findIndex((_, i) => phrase.words.every((w, j) => tokens[i + j] === w));
    if (at >= 0) {
      month = phrase.month;
      tokens = [...tokens.slice(0, at), ...tokens.slice(at + phrase.words.length)];
      break;
    }
  }
  // Filler words, dropped only now so "אדר ב" above keeps its ב.
  tokens = tokens.filter((t) => !['the', 'of', 'on', 'ב', 'לחודש', 'חודש', 'שנת'].includes(t));
  let year: number | undefined;
  let day: number | undefined;
  for (const token of tokens) {
    const asYear = year === undefined ? yearOf(token) : null;
    if (asYear !== null) {
      year = asYear;
      continue;
    }
    const asDay = day === undefined && month ? dayOf(token) : null;
    if (asDay !== null) {
      day = asDay;
      continue;
    }
    return { ok: false, reason: `could not read "${token}" as a day, month or year` };
  }
  if (year === undefined) return { ok: false, reason: 'no year found' };
  if (!month) return day === undefined ? { ok: true, key: formatDateKey({ year }) } : { ok: false, reason: 'a day needs a month' };
  const token = month.token;
  if (token === '06' && HDate.isLeapYear(year)) return { ok: false, reason: `${year} is a leap year: say Adar I or Adar II` };
  const key = formatDateKey(day === undefined ? { year, month: token } : { year, month: token, day });
  const check = validateDateKey(key);
  return check.ok ? { ok: true, key } : { ok: false, reason: check.reason };
}
