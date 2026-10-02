import { HDate } from '@hebcal/core';
import { dailyRambam1, dailyRambam3, DailyRambamEvent, seferHaMitzvot } from '@hebcal/learning';
import { toHebrewNumeral } from '@rebbehub/hebrew';

/**
 * The daily Rambam in its three tracks, as the Rebbe set them in 5744:
 * three chapters a day (the whole Mishneh Torah in a year), one chapter a
 * day (in three years), and Sefer HaMitzvos (the mitzvos of the one
 * chapter's track). Worked out by @hebcal/learning; each shiur is named
 * in Hebrew and by Sefaria's references, one per chapter or mitzvah.
 */

export interface RambamShiur {
  /** `הלכות מקואות פרקים ה-ז` */
  label: string;
  /** Sefaria's references, in order: `Mishneh Torah, Immersion Pools 5`. */
  refs: string[];
}

export interface DailyRambam {
  three: RambamShiur;
  one: RambamShiur;
  mitzvos: RambamShiur | null;
}

const numeral = (n: number) => toHebrewNumeral(n).replace(/[״׳]/g, '');
/** Hebcal's Hebrew name of a Mishneh Torah book, `הלכות גירושין`, from how it names a chapter of it. */
const bookName = (date: HDate, reading: Reading) => new DailyRambamEvent(date, reading).render('he').replace(/\s+פרק\s+\S+$/, '');

/** A day's reading as Hebcal gives it: a chapter, or on a few days a range (`1-21`, `1:1-4:8`, the introduction and the list of mitzvos). */
type Reading = { name: string; perek: number | string };

/** Chapters, grouped by book: `הלכות מקואות פרקים ה-ז`, or two books' chapters one after the other. */
function chapters(date: HDate, readings: Reading[]): RambamShiur {
  const groups: Array<{ name: string; he: string; pereks: Array<number | string> }> = [];
  for (const r of readings) {
    const last = groups.at(-1);
    if (last && last.name === r.name && typeof r.perek === 'number') last.pereks.push(r.perek);
    else groups.push({ name: r.name, he: bookName(date, r), pereks: [r.perek] });
  }
  const label = groups
    .map((g) => {
      const [first] = g.pereks;
      if (typeof first === 'string') return `${g.he} ${first.replace(/\d+/g, (n) => numeral(Number(n)))}`;
      return g.pereks.length === 1 ? `${g.he} פרק ${numeral(first!)}` : `${g.he} פרקים ${numeral(first!)}-${numeral(g.pereks.at(-1) as number)}`;
    })
    .join('; ');
  return { label, refs: readings.map((r) => `Mishneh Torah, ${r.name} ${r.perek}`) };
}

/** One piece of the day's Sefer HaMitzvos as Hebcal writes it (`P109`, `N12`, `Principle 1-3`), in Hebrew and as Sefaria refers to it. */
function mitzvah(piece: string): { he: string; ref: string | null } {
  const m = /^([PN])(\d+)$/.exec(piece);
  if (m) {
    const n = Number(m[2]);
    return m[1] === 'P' ? { he: `מצות עשה ${numeral(n)}`, ref: `Sefer HaMitzvot, Positive Commandments ${n}` } : { he: `מצות לא תעשה ${numeral(n)}`, ref: `Sefer HaMitzvot, Negative Commandments ${n}` };
  }
  const principle = /^Principle (\d+)(?:-(\d+))?$/.exec(piece);
  if (principle) {
    const [a, b] = [Number(principle[1]), Number(principle[2] ?? principle[1])];
    return { he: `שורשים ${numeral(a)}${b !== a ? `-${numeral(b)}` : ''}`, ref: `Sefer HaMitzvot, Shorashim ${a}${b !== a ? `-${b}` : ''}` };
  }
  if (/Introduction/i.test(piece)) return { he: 'הקדמת הרמב״ם', ref: 'Sefer HaMitzvot, Introductions' };
  if (/Nusach HaTefila/i.test(piece)) return { he: 'נוסח התפלה', ref: null };
  if (/Order of Prayer/i.test(piece)) return { he: 'סדר התפלה', ref: null };
  if (/Haggadah/i.test(piece)) return { he: 'נוסח ההגדה', ref: null };
  const megillah = /Megillah and Chanukah Chapters (\d+)-(\d+)/.exec(piece);
  if (megillah) return { he: `הלכות מגילה וחנוכה פרקים ${numeral(Number(megillah[1]))}-${numeral(Number(megillah[2]))}`, ref: `Mishneh Torah, Scroll of Esther and Hanukkah ${megillah[1]}-${megillah[2]}` };
  return { he: piece, ref: null };
}

/** The day's Rambam, by its civil date (`YYYY-MM-DD`, the day it is learned). */
export function dailyRambam(date: string): DailyRambam {
  const [y, m, d] = date.split('-').map(Number);
  const day = new HDate(new Date(y!, m! - 1, d!));
  const pieces = (seferHaMitzvot(day)?.reading ?? '').split(/,\s*(?=[PN]\d|Principle|Nusach|Order|Text|Laws|Maimonides)/).filter(Boolean).map(mitzvah);
  return {
    three: chapters(day, dailyRambam3(day)),
    one: chapters(day, [dailyRambam1(day)]),
    mitzvos: pieces.length ? { label: pieces.map((p) => p.he).join(', '), refs: pieces.map((p) => p.ref).filter((r): r is string => r !== null) } : null,
  };
}
