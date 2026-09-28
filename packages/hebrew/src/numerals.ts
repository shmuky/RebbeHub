/**
 * Hebrew numerals (gematria) as years and days are written: תשמ״ב for
 * 5742, י״א for 11, ט״ו and ט״ז for 15 and 16 (never יה, יו).
 */

const LETTER_VALUES: Record<string, number> = {
  א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9,
  י: 10, כ: 20, ך: 20, ל: 30, מ: 40, ם: 40, נ: 50, ן: 50, ס: 60, ע: 70, פ: 80, ף: 80, צ: 90, ץ: 90,
  ק: 100, ר: 200, ש: 300, ת: 400,
};

const ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת', 'תק', 'תר', 'תש', 'תת', 'תתק'];

/** The letters of 1-999, without punctuation: 742 → תשמב, 15 → טו. */
function letters(n: number): string {
  let out = HUNDREDS[Math.floor(n / 100)] ?? '';
  const rest = n % 100;
  if (rest === 15) return `${out}טו`;
  if (rest === 16) return `${out}טז`;
  out += TENS[Math.floor(rest / 10)] ?? '';
  out += ONES[rest % 10] ?? '';
  return out;
}

/**
 * A number as Hebrew numerals with gershayim before the last letter, or a
 * geresh after a single letter: 5742 → תשמ״ב (the thousands dropped, as
 * years are written), 10 → י׳, 400 → ת׳.
 */
export function toHebrewNumeral(n: number, options: { keepThousands?: boolean } = {}): string {
  if (!Number.isInteger(n) || n <= 0) throw new RangeError(`not a positive integer: ${n}`);
  const thousands = Math.floor(n / 1000);
  const body = letters(n % 1000);
  const prefix = options.keepThousands && thousands > 0 ? `${ONES[thousands] ?? ''}׳` : '';
  if (body.length === 0) return prefix;
  if (body.length === 1) return `${prefix}${body}׳`;
  return `${prefix}${body.slice(0, -1)}״${body.slice(-1)}`;
}

/** The value of Hebrew numerals, ignoring geresh, gershayim and quotes: תשמ"ב → 742, יו"ד → 10 (the spelled-out yud). */
export function parseHebrewNumeral(text: string): number | null {
  const clean = text.replace(/[׳״"'`‘’“”\s]/g, '');
  if (clean.length === 0) return null;
  // Days written out as words, as they commonly are in titles.
  const spelled: Record<string, number> = { יוד: 10, יו: 10 };
  if (spelled[clean] !== undefined) return spelled[clean];
  let total = 0;
  for (const ch of clean) {
    const value = LETTER_VALUES[ch];
    if (value === undefined) return null;
    total += value;
  }
  return total;
}

/**
 * A Hebrew year from how it is written: תשמ"ב → 5742, ה'תשמ"ב → 5742,
 * "5742" → 5742. Years without thousands are taken in the sixth
 * millennium (5000s), the only one this index holds.
 */
export function parseHebrewYear(text: string): number | null {
  const trimmed = text.trim();
  if (/^\d{4}$/.test(trimmed)) return Number(trimmed);
  const withoutThousands = trimmed.replace(/^ה[׳']/, '');
  const value = parseHebrewNumeral(withoutThousands);
  if (value === null || value <= 0 || value >= 1000) return null;
  return 5000 + value;
}
