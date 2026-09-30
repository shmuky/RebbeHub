/**
 * A sefer's volumes as its page lists them. Sources name the same volume
 * differently: Sichos Kodesh's contents call Likkutei Sichos 30 "כרך ל"
 * (with the value "1", its first volume there), HebrewBooks calls it
 * "ל (בראשית)", and a PDF copy from a Drive folder "30". So a printing is
 * put with a volume by the volume's number when both have one, and only
 * by the same words otherwise; and a volume that only printings have (no
 * contents yet) still gets its own row, so each volume's PDFs, from every
 * source, are on one page.
 */

export interface Part {
  value: string;
  label: { he: string; en?: string } | null;
  units: number;
}

const LETTERS: Record<string, number> = { א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9, י: 10, כ: 20, ך: 20, ל: 30, מ: 40, ם: 40, נ: 50, ן: 50, ס: 60, ע: 70, פ: 80, ף: 80, צ: 90, ץ: 90, ק: 100, ר: 200, ש: 300, ת: 400 };

/** A Hebrew numeral (ל, לד, קכג, טו), or null for a word that only looks like one: its letters must fall in value, as numerals are written. */
function hebrewNumeral(word: string): number | null {
  const letters = [...word.replace(/["'׳״]/g, '')];
  if (!letters.length || letters.length > 3) return null;
  if (word === 'טו' || word === 'טז') return word === 'טו' ? 15 : 16;
  let total = 0;
  let last = Infinity;
  for (const c of letters) {
    const v = LETTERS[c];
    if (!v || v > last || (v === last && v < 100)) return null;
    total += v;
    last = v;
  }
  return total;
}

/** A volume's number from how a source names it ("34", "לד (דברים)", "כרך לד", "Volume 34"), or null when its name has none. */
export function volumeNumber(name: string | null | undefined): number | null {
  const m = String(name ?? '').trim().match(/^(?:כרך|חלק|volume|vol\.?)?\s*([0-9]{1,3}|[א-ת"'׳״]{1,5})(?=$|\s*[(\-–,])/i);
  if (!m) return null;
  const token = m[1]!;
  return /^[0-9]+$/.test(token) ? Number(token) : hebrewNumeral(token);
}

const partNumber = (part: Pick<Part, 'value' | 'label'>) => volumeNumber(part.label?.he) ?? volumeNumber(part.value);

/** Whether a printing (by its `volume`) is of this volume; a printing with no volume is of every one. */
export function ofVolume(volume: unknown, part: Pick<Part, 'value' | 'label'> | null | undefined): boolean {
  if (!part || volume === undefined || volume === null || volume === '') return true;
  const n = volumeNumber(String(volume));
  const p = partNumber(part);
  if (n !== null && p !== null) return n === p;
  return String(volume) === part.value;
}

const ONES = ['', 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט'];
const TENS = ['', 'י', 'כ', 'ל', 'מ', 'נ', 'ס', 'ע', 'פ', 'צ'];
const HUNDREDS = ['', 'ק', 'ר', 'ש', 'ת'];

/** 34 as לד, for a volume only a Drive folder numbered. */
export function hebrewNumber(n: number): string {
  if (n < 1 || n > 499) return String(n);
  const rest = n % 100;
  const tail = rest === 15 ? 'טו' : rest === 16 ? 'טז' : TENS[Math.floor(rest / 10)]! + ONES[rest % 10]!;
  return HUNDREDS[Math.floor(n / 100)]! + tail;
}

/**
 * The sefer's volumes: those its contents have, then any its printings name
 * that none of those is, each once however many sources name it; in the
 * volumes' order when every one has a number.
 */
export function workVolumes(outline: readonly Part[], volumes: readonly unknown[]): Part[] {
  const out: Part[] = [...outline];
  const extra = new Map<string, string[]>();
  for (const v of volumes) {
    if (v === undefined || v === null || v === '') continue;
    const name = String(v);
    if (out.some((p) => ofVolume(name, p))) continue;
    const n = volumeNumber(name);
    const key = n === null ? `=${name}` : `#${n}`;
    const names = extra.get(key) ?? [];
    if (!names.includes(name)) names.push(name);
    extra.set(key, names);
  }
  if (!extra.size) return out;
  const taken = new Set(out.map((p) => p.value));
  for (const [key, names] of extra) {
    // The fullest name ("ה (בראשית)" over "5") is shown; a bare number becomes "כרך ה".
    const words = names.filter((x) => !/^[0-9]+$/.test(x)).sort((a, b) => b.length - a.length)[0];
    const n = key.startsWith('#') ? Number(key.slice(1)) : null;
    const he = words ? (n !== null && !/^כרך/.test(words) ? `כרך ${words}` : words) : `כרך ${hebrewNumber(n!)}`;
    // Its address is a name no volume of the contents uses (their values are often "1", "2"...).
    const value = [words, ...names].find((x): x is string => Boolean(x) && !taken.has(x!)) ?? `v${n}`;
    taken.add(value);
    out.push({ value, label: { he, ...(n !== null ? { en: `Volume ${n}` } : {}) }, units: 0 });
  }
  const numbers = out.map(partNumber);
  if (numbers.every((n) => n !== null)) return out.map((p, i) => ({ p, n: numbers[i]! })).sort((a, b) => a.n - b.n).map((x) => x.p);
  return out;
}
