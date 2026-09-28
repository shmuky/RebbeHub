import { HDate, HebrewCalendar, Locale, getSedra, months } from '@hebcal/core';
import { dateKeyFromHDate, dateKeyToHDate } from '@rebbehub/hebrew';
import type { Lang } from './i18n.js';

/**
 * The Hebrew week the site opens on, as Sichos-Kodesh's app does: today's
 * date, this week's parsha (or the chag), the days of the week, and the
 * year of the Rebbe's farbrengens whose calendar falls the same way (the
 * kvius), so "this week" can be followed in a year that matches.
 */

/** The years farbrengens are indexed for (Sichos-Kodesh's catalog). */
export const FIRST_YEAR = 5710;
export const LAST_YEAR = 5752;

/** Parsha names are Hebrew without nikud in Hebrew, and hebcal's transliteration in English. */
const parshaName = (name: string, lang: Lang) => (lang === 'he' ? Locale.gettext(name, 'he-x-NoNikud') : name);

export interface Week {
  /** Today's date key (`5787-01-17`). */
  today: string;
  /** Today as people read it: `י״ז תשרי תשפ״ז`. */
  todayLabel: string;
  /** This week's Shabbos parsha, or the chag in its place. */
  parsha: string | null;
  /** Today's holidays, when there are any (`סוכות ג׳ (חוה״מ)`). */
  holidays: string[];
  /** Sunday to Shabbos, as date keys. */
  days: string[];
  /** The month-and-day of each (`01-17`), with Adar's other spelling, for finding the same days in any year. */
  dayTokens: string[];
}

/** The same day in a year with or without a second Adar: a leap year's Adar II is a plain year's Adar. */
function dayTokensOf(key: string): string[] {
  const token = key.slice(5);
  if (token.startsWith('06-')) return [token, `06B-${token.slice(3)}`];
  if (token.startsWith('06B-')) return [token, `06-${token.slice(4)}`];
  return [token];
}

export function thisWeek(lang: Lang, now: Date = new Date()): Week {
  const today = new HDate(now);
  const sunday = today.onOrBefore(0);
  const shabbos = today.onOrAfter(6);
  const sedra = getSedra(shabbos.getFullYear(), false).lookup(shabbos);
  const days: string[] = [];
  for (let d = sunday; d.deltaDays(shabbos) <= 0; d = d.next()) days.push(dateKeyFromHDate(d));
  const holidays = (HebrewCalendar.getHolidaysOnDate(today, false) ?? []).map((e) => e.render(lang === 'he' ? 'he-x-NoNikud' : 'en'));
  return {
    today: dateKeyFromHDate(today),
    todayLabel: lang === 'he' ? today.renderGematriya(true) : today.render('en'),
    parsha: sedra.chag ? null : sedra.parsha.map((p) => parshaName(p, lang)).join('–'),
    holidays,
    days,
    dayTokens: [...new Set(days.flatMap(dayTokensOf))],
  };
}

/** How a year falls: leap or not, the weekday of Rosh Hashanah, and its length. Years alike in all three share every week. */
export function kvius(year: number): string {
  return `${HDate.isLeapYear(year) ? 'L' : 'P'}${new HDate(1, months.TISHREI, year).getDay()}-${HDate.daysInYear(year)}`;
}

/** The years of farbrengens whose calendar falls like `year`'s, latest first. */
export function kviusYears(year: number): number[] {
  const sig = kvius(year);
  const out: number[] = [];
  for (let y = LAST_YEAR; y >= FIRST_YEAR; y--) if (kvius(y) === sig) out.push(y);
  return out;
}

/** A day of `week` in another year: the same month and day there, when that year has it. */
export function sameDayIn(key: string, year: number): string {
  let token = key.slice(5);
  const leap = HDate.isLeapYear(year);
  if (!leap && token.startsWith('06')) token = `06-${token.slice(token.indexOf('-') + 1)}`;
  if (leap && token.startsWith('06-')) token = `06B-${token.slice(3)}`;
  return `${year}-${token}`;
}

/** The parsha read on the Shabbos of a date's week, in any year: what a farbrengen on that date is known by. */
export function parshaOf(key: string, lang: Lang): string | null {
  const hdate = dateKeyToHDate(key);
  if (!hdate) return null;
  const shabbos = hdate.onOrAfter(6);
  const sedra = getSedra(shabbos.getFullYear(), false).lookup(shabbos);
  return sedra.chag ? null : sedra.parsha.map((p) => parshaName(p, lang)).join('–');
}
