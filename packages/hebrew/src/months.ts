/**
 * The months as RebbeHub's date keys number them: Tishrei first, as the
 * year is counted, with a leap year's Adar split into 06A (Adar I) and 06B
 * (Adar II) rather than shifting every later month. This is mafteiach's
 * numbering, which Sichos-Kodesh's catalog already files every farbrengen
 * under (`toMafteiachHebrewDateKey` in its packages/catalog), so a key made
 * here looks up the same occasion there.
 */
export type MonthToken = '01' | '02' | '03' | '04' | '05' | '06' | '06A' | '06B' | '07' | '08' | '09' | '10' | '11' | '12';

export interface MonthInfo {
  token: MonthToken;
  /** HDate's own numbering: 1 = Nisan ... 7 = Tishrei ... 12 = Adar / Adar I, 13 = Adar II. */
  hdateMonth: number;
  en: string;
  he: string;
  /** Other spellings people type, normalised (lower case, no punctuation). */
  aliases: string[];
  /** Where it sorts within a year: Adar I and plain Adar share 6, Adar II is 6.5. */
  order: number;
  /** Which years it exists in. */
  years: 'all' | 'common' | 'leap';
}

export const MONTHS: readonly MonthInfo[] = [
  { token: '01', hdateMonth: 7, en: 'Tishrei', he: 'תשרי', aliases: ['tishrei', 'tishri', 'tishre'], order: 1, years: 'all' },
  { token: '02', hdateMonth: 8, en: 'Cheshvan', he: 'חשוון', aliases: ['cheshvan', 'marcheshvan', 'heshvan', 'chesvan', 'חשון', 'מרחשון', 'מרחשוון'], order: 2, years: 'all' },
  { token: '03', hdateMonth: 9, en: 'Kislev', he: 'כסלו', aliases: ['kislev', 'kislew'], order: 3, years: 'all' },
  { token: '04', hdateMonth: 10, en: 'Teves', he: 'טבת', aliases: ['teves', 'tevet', 'tebeth', 'tevais'], order: 4, years: 'all' },
  { token: '05', hdateMonth: 11, en: 'Shevat', he: 'שבט', aliases: ['shevat', 'shvat', 'shvot', 'shevet'], order: 5, years: 'all' },
  { token: '06', hdateMonth: 12, en: 'Adar', he: 'אדר', aliases: ['adar'], order: 6, years: 'common' },
  { token: '06A', hdateMonth: 12, en: 'Adar I', he: 'אדר א׳', aliases: ['adar i', 'adar 1', 'adar rishon', 'אדר א', 'אדר ראשון'], order: 6, years: 'leap' },
  { token: '06B', hdateMonth: 13, en: 'Adar II', he: 'אדר ב׳', aliases: ['adar ii', 'adar 2', 'adar sheni', 'adar beis', 'אדר ב', 'אדר שני'], order: 6.5, years: 'leap' },
  { token: '07', hdateMonth: 1, en: 'Nisan', he: 'ניסן', aliases: ['nisan', 'nissan'], order: 7, years: 'all' },
  { token: '08', hdateMonth: 2, en: 'Iyar', he: 'אייר', aliases: ['iyar', 'iyyar', 'איר'], order: 8, years: 'all' },
  { token: '09', hdateMonth: 3, en: 'Sivan', he: 'סיוון', aliases: ['sivan', 'סיון'], order: 9, years: 'all' },
  { token: '10', hdateMonth: 4, en: 'Tammuz', he: 'תמוז', aliases: ['tammuz', 'tamuz'], order: 10, years: 'all' },
  { token: '11', hdateMonth: 5, en: 'Av', he: 'אב', aliases: ['av', 'menachem av', 'מנחם אב', 'מנ״א', 'מנא'], order: 11, years: 'all' },
  { token: '12', hdateMonth: 6, en: 'Elul', he: 'אלול', aliases: ['elul'], order: 12, years: 'all' },
];

const BY_TOKEN = new Map(MONTHS.map((m) => [m.token, m]));

export function monthByToken(token: string): MonthInfo | undefined {
  return BY_TOKEN.get(token as MonthToken);
}

export function isMonthToken(token: string): token is MonthToken {
  return BY_TOKEN.has(token as MonthToken);
}
