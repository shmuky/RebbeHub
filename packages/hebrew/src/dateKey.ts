import { HDate } from '@hebcal/core';
import { isMonthToken, monthByToken, MONTHS, type MonthToken } from './months.js';
import { toHebrewNumeral } from './numerals.js';

/**
 * A Hebrew date key: how RebbeHub files an event, a letter or a printing
 * by date, and how its paths read (`/events/5742-05-10`).
 *
 *   5742          a year (a letter dated only by year)
 *   5742-05       a month (Shevat 5742)
 *   5742-05-10    a day (10 Shevat 5742)
 *   5741-06B-14   Purim in a leap year (Adar II)
 *
 * Months are numbered from Tishrei (see months.ts), the same keys
 * Sichos-Kodesh's catalog uses.
 */
export type DateKey = string;

export type DatePrecision = 'year' | 'month' | 'day';

export interface DateKeyParts {
  year: number;
  month?: MonthToken;
  day?: number;
}

const KEY_PATTERN = /^(\d{4})(?:-(0[1-9]|1[0-2]|06A|06B)(?:-(0[1-9]|[12]\d|30))?)?$/;

/** The parts of a key, checking its shape only; `validateDateKey` also checks the calendar. */
export function parseDateKey(key: string): DateKeyParts | null {
  const match = KEY_PATTERN.exec(key);
  if (!match) return null;
  const [, year, month, day] = match;
  const parts: DateKeyParts = { year: Number(year) };
  if (month !== undefined) parts.month = month as MonthToken;
  if (day !== undefined) parts.day = Number(day);
  return parts;
}

export function formatDateKey(parts: DateKeyParts): DateKey {
  if (parts.day !== undefined && parts.month === undefined) throw new RangeError('a day needs a month');
  let key = String(parts.year).padStart(4, '0');
  if (parts.month !== undefined) key += `-${parts.month}`;
  if (parts.day !== undefined) key += `-${String(parts.day).padStart(2, '0')}`;
  return key;
}

export function datePrecision(key: DateKey): DatePrecision | null {
  const parts = parseDateKey(key);
  if (!parts) return null;
  return parts.day !== undefined ? 'day' : parts.month !== undefined ? 'month' : 'year';
}

export type DateKeyCheck = { ok: true; parts: DateKeyParts } | { ok: false; reason: string };

/**
 * Whether a key names a real date: the shape, then Adar against the year
 * (06 only in a common year, 06A/06B only in a leap year), then the day
 * against the month's length (Cheshvan and Kislev vary by year). This is
 * the "valid Hebrew date?" check a suggestion shows its reviewer.
 */
export function validateDateKey(key: string): DateKeyCheck {
  const parts = parseDateKey(key);
  if (!parts) return { ok: false, reason: `"${key}" is not a date key (5742, 5742-05 or 5742-05-10)` };
  if (parts.year < 5000 || parts.year > 6000) return { ok: false, reason: `year ${parts.year} is outside 5000-6000` };
  if (parts.month === undefined) return { ok: true, parts };
  const info = monthByToken(parts.month)!;
  const leap = HDate.isLeapYear(parts.year);
  if (info.years === 'leap' && !leap) return { ok: false, reason: `${parts.year} is not a leap year, so it has no ${info.en}; use 06` };
  if (info.years === 'common' && leap) return { ok: false, reason: `${parts.year} is a leap year: say Adar I (06A) or Adar II (06B)` };
  if (parts.day !== undefined) {
    const length = HDate.daysInMonth(info.hdateMonth, parts.year);
    if (parts.day > length) return { ok: false, reason: `${info.en} ${parts.year} has ${length} days` };
  }
  return { ok: true, parts };
}

export function isValidDateKey(key: string): boolean {
  return validateDateKey(key).ok;
}

/** The key of a day, from HDate's own month numbering. */
export function dateKeyFromHDate(date: HDate): DateKey {
  const year = date.getFullYear();
  const hdateMonth = date.getMonth();
  const token: MonthToken =
    hdateMonth === 12 ? (HDate.isLeapYear(year) ? '06A' : '06') : hdateMonth === 13 ? '06B' : MONTHS.find((m) => m.hdateMonth === hdateMonth && m.years === 'all')!.token;
  return formatDateKey({ year, month: token, day: date.getDate() });
}

/** The day a full key names; null for a year or month key, or one that is not a real date. */
export function dateKeyToHDate(key: DateKey): HDate | null {
  const check = validateDateKey(key);
  if (!check.ok || check.parts.day === undefined || check.parts.month === undefined) return null;
  return new HDate(check.parts.day, monthByToken(check.parts.month)!.hdateMonth, check.parts.year);
}

/** The civil date of a full key, as `YYYY-MM-DD` (the day that begins at nightfall before it is the previous civil day's evening). */
export function dateKeyToGregorian(key: DateKey): string | null {
  const date = dateKeyToHDate(key);
  if (!date) return null;
  const g = date.greg();
  return `${String(g.getFullYear()).padStart(4, '0')}-${String(g.getMonth() + 1).padStart(2, '0')}-${String(g.getDate()).padStart(2, '0')}`;
}

/** The key of a civil date (`YYYY-MM-DD`, daytime). */
export function dateKeyFromGregorian(iso: string): DateKey | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return null;
  return dateKeyFromHDate(new HDate(date));
}

/** Calendar order; a year sorts before its months and a month before its days. */
export function compareDateKeys(a: DateKey, b: DateKey): number {
  const pa = parseDateKey(a);
  const pb = parseDateKey(b);
  if (!pa || !pb) return a < b ? -1 : a > b ? 1 : 0;
  if (pa.year !== pb.year) return pa.year - pb.year;
  const ma = pa.month ? monthByToken(pa.month)!.order : 0;
  const mb = pb.month ? monthByToken(pb.month)!.order : 0;
  if (ma !== mb) return ma - mb;
  return (pa.day ?? 0) - (pb.day ?? 0);
}

/** Whether `key` falls within `range` (a year contains its months and days, a month its days). */
export function dateKeyWithin(key: DateKey, range: DateKey): boolean {
  return key === range || key.startsWith(`${range}-`);
}

/** A key as people read it: `י׳ שבט תשמ״ב` or `10 Shevat 5742`. */
export function describeDateKey(key: DateKey, language: 'he' | 'en' = 'he'): string {
  const parts = parseDateKey(key);
  if (!parts) return key;
  const month = parts.month ? monthByToken(parts.month) : undefined;
  if (language === 'en') return [parts.day, month?.en, parts.year].filter((x) => x !== undefined).join(' ');
  const day = parts.day !== undefined ? toHebrewNumeral(parts.day) : undefined;
  return [day, month?.he, toHebrewNumeral(parts.year)].filter((x) => x !== undefined).join(' ');
}
