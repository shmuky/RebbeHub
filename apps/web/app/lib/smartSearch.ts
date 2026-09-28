import { HDate, Locale, getSedra, months as hmonths, parshiot } from '@hebcal/core';
import { MONTHS, dateKeyFromHDate, normalizeSearchText, parseHebrewNumeral, parseHebrewYear, unfinal } from '@rebbehub/hebrew';
import type { Lang } from './i18n.js';
import { FIRST_YEAR, LAST_YEAR, sameDayIn } from './week.js';

/**
 * Reads a search the way Sichos-Kodesh's app does: out of the words come a
 * parsha (`בשלח`, `Beshalach`, even `Beshalah`), a chag or a Chabad day
 * (`חנוכה`, `יו״ד שבט`), a day of a month (`י״ט כסלו`) and a year
 * (`תשל״ו`, `5736`); whatever is left is searched in names. So `בשלח תשל״ו`
 * is the farbrengens of the week of Beshalach 5736.
 */

export interface SmartQuery {
  /** hebcal's name of the parsha (`Beshalach`). */
  parsha?: string;
  /** A chag or Chabad day: its name as typed, and its days (`05-10`). */
  day?: { label: string; tokens: string[] };
  year?: number;
  /** The words left, for searching names. */
  rest: string;
}

const norm = (s: string) => unfinal(normalizeSearchText(s));

interface Phrase {
  words: string[];
  value: string;
}

/** Longest phrase first, so `שמחת תורה` wins over a word inside it. */
const byLength = (a: Phrase, b: Phrase) => b.words.length - a.words.length;

const PARSHA_PHRASES: Phrase[] = parshiot
  .flatMap((name) => [name, Locale.gettext(name, 'he-x-NoNikud'), name.replace(/-/g, ' ')].map((form) => ({ words: norm(form).split(' ').filter(Boolean), value: name })))
  .sort(byLength);

/** Chagim and Chabad days, with every day each covers (a month and day, `01-15`). */
const range = (month: string, from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `${month}-${String(from + i).padStart(2, '0')}`);
const DAYS: Array<{ names: string[]; tokens: string[] }> = [
  { names: ['ראש השנה', 'rosh hashanah', 'rosh hashana', 'rosh hashono'], tokens: range('01', 1, 2) },
  { names: ['יום כיפור', 'יום הכיפורים', 'יום כיפורים', 'yom kippur', 'yom kipur'], tokens: range('01', 9, 10) },
  { names: ['סוכות', 'חג הסוכות', 'sukkos', 'sukkot', 'succos'], tokens: range('01', 15, 21) },
  { names: ['שמיני עצרת', 'shmini atzeres', 'shemini atzeret'], tokens: ['01-22'] },
  { names: ['שמחת תורה', 'simchas torah', 'simchat torah'], tokens: ['01-23'] },
  { names: ['י״ט כסלו', 'יט כסלו', 'יוד טית כסלו', 'yud tes kislev', '19 kislev'], tokens: ['03-19', '03-20'] },
  { names: ['חנוכה', 'chanukah', 'hanukkah', 'chanuka'], tokens: [...range('03', 25, 30), ...range('04', 1, 3)] },
  { names: ['יו״ד שבט', 'יוד שבט', 'יו שבט', 'י שבט', 'yud shvat', 'yud shevat', '10 shvat'], tokens: ['05-10'] },
  { names: ['כ״ב שבט', 'כב שבט', 'chof beis shvat'], tokens: ['05-22'] },
  { names: ['פורים', 'purim'], tokens: ['06-14', '06B-14', '06-15', '06B-15'] },
  { names: ['י״א ניסן', 'יא ניסן', 'yud alef nissan', '11 nissan'], tokens: ['07-11'] },
  { names: ['פסח', 'pesach', 'passover'], tokens: range('07', 14, 22) },
  { names: ['ל״ג בעומר', 'לג בעומר', 'lag baomer', 'lag bomer'], tokens: ['08-18'] },
  { names: ['שבועות', 'shavuos', 'shavuot'], tokens: range('09', 6, 7) },
  { names: ['י״ב־י״ג תמוז', 'יב תמוז', 'יב יג תמוז', 'yud beis tammuz', '12 tammuz'], tokens: ['10-12', '10-13'] },
  { names: ['כ״ף מנחם אב', 'כף מנחם אב', 'כ מנחם אב', 'כ אב', 'chof av', '20 av'], tokens: ['11-20'] },
  { names: ['ח״י אלול', 'חי אלול', 'chai elul', '18 elul'], tokens: ['12-18'] },
];
const DAY_PHRASES: Phrase[] = DAYS.flatMap((d, i) => d.names.map((n) => ({ words: norm(n).split(' '), value: String(i) }))).sort(byLength);

const MONTH_PHRASES: Phrase[] = MONTHS.flatMap((m) => [m.he, m.en, ...m.aliases].map((form) => ({ words: norm(form).split(' ').filter(Boolean), value: m.token }))).sort(byLength);

const PREFIXES = new Set(['פרשת', 'פרשה', 'parshas', 'parshat', 'parsha', 'parashat', 'שנת', 'year', 'שבת', 'shabbos']);

function take(words: string[], phrases: Phrase[]): { value: string; at: number; length: number } | null {
  for (const p of phrases) {
    for (let i = 0; i + p.words.length <= words.length; i++) {
      if (p.words.every((w, j) => words[i + j] === w)) return { value: p.value, at: i, length: p.words.length };
    }
  }
  return null;
}

/** Edit distance, for a mistyped parsha. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

/** The one parsha a mistyped word is closest to, within a third of its letters; none if two are as close. */
function fuzzyParsha(word: string): string | null {
  if (word.length < 4) return null;
  const budget = Math.floor(word.length * 0.34);
  let best: { name: string; d: number } | null = null;
  let tie = false;
  for (const p of PARSHA_PHRASES) {
    if (p.words.length !== 1) continue;
    const d = distance(word, p.words[0]!);
    if (d > budget) continue;
    if (!best || d < best.d) {
      best = { name: p.value, d };
      tie = false;
    } else if (d === best.d && p.value !== best.name) tie = true;
  }
  return best && !tie ? best.name : null;
}

const dayNumber = (w: string): number | null => {
  const n = /^\d{1,2}$/.test(w) ? Number(w) : /^[א-ת]{1,3}$/.test(w) ? (w === 'יוד' ? 10 : parseHebrewNumeral(w)) : null;
  return n !== null && n >= 1 && n <= 30 ? n : null;
};

const yearOf = (w: string): number | null => {
  const y = /^\d{4}$/.test(w) ? Number(w) : /^ת[א-ת]{1,3}$/.test(w) ? parseHebrewYear(w) : null;
  return y !== null && y >= 5600 && y <= 5800 ? y : null;
};

export function parseSmartQuery(q: string): SmartQuery {
  let words = norm(q).split(' ').filter(Boolean);
  const out: SmartQuery = { rest: '' };
  const drop = (at: number, length: number) => (words = [...words.slice(0, at), ...words.slice(at + length)]);

  const chag = take(words, DAY_PHRASES);
  if (chag) {
    out.day = { label: DAYS[Number(chag.value)]!.names[0]!, tokens: DAYS[Number(chag.value)]!.tokens };
    drop(chag.at, chag.length);
  }
  if (!out.day) {
    // A day of a month: `יט כסלו`, `10 shevat`, `shevat 10`.
    const month = take(words, MONTH_PHRASES);
    if (month) {
      const before = month.at > 0 ? dayNumber(words[month.at - 1]!) : null;
      const after = month.at + month.length < words.length ? dayNumber(words[month.at + month.length]!) : null;
      const day = before ?? after;
      if (day !== null) {
        const tokens = [`${month.value}-${String(day).padStart(2, '0')}`];
        if (month.value === '06') tokens.push(`06B-${String(day).padStart(2, '0')}`);
        out.day = { label: q, tokens };
        drop(before !== null ? month.at - 1 : month.at, month.length + 1);
      }
    }
  }
  const parsha = take(words, PARSHA_PHRASES);
  if (parsha) {
    out.parsha = parsha.value;
    drop(parsha.at, parsha.length);
  }
  const yearAt = words.findIndex((w) => yearOf(w) !== null);
  if (yearAt >= 0) {
    out.year = yearOf(words[yearAt]!)!;
    drop(yearAt, 1);
  }
  words = words.filter((w) => !PREFIXES.has(w));
  if (!out.parsha && !out.day && words.length === 1) {
    const guess = fuzzyParsha(words[0]!);
    if (guess) {
      out.parsha = guess;
      words = [];
    }
  }
  out.rest = words.join(' ');
  return out;
}

/** The days of the week whose Shabbos reads `parsha`, in one year (a joined parsha counts for both). */
export function parshaWeek(parsha: string, year: number): string[] {
  const sedra = getSedra(year, false);
  let d = new HDate(1, hmonths.TISHREI, year).onOrAfter(6);
  const end = new HDate(1, hmonths.TISHREI, year + 1);
  while (d.deltaDays(end) < 0) {
    const found = sedra.lookup(d);
    if (!found.chag && found.parsha.includes(parsha)) {
      const days: string[] = [];
      for (let x = d.onOrBefore(0); x.deltaDays(d) <= 0; x = x.next()) days.push(dateKeyFromHDate(x));
      return days;
    }
    d = d.add(7, 'd');
  }
  return [];
}

/** The exact dates a query names, when it names a year or a parsha; null when it names days of every year. */
export function datesOf(query: SmartQuery): string[] | null {
  if (query.parsha) {
    const years = query.year ? [query.year] : Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);
    return years.flatMap((y) => parshaWeek(query.parsha!, y));
  }
  if (query.day && query.year) return [...new Set(query.day.tokens.map((tok) => sameDayIn(`${query.year}-${tok}`, query.year!)))];
  return null;
}

export const parshaLabel = (name: string, lang: Lang) => (lang === 'he' ? Locale.gettext(name, 'he-x-NoNikud') : name);
