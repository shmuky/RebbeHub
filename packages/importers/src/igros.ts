import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MONTHS, normalizeSearchText, parseDateText, parseHebrewNumeral, parseHebrewYear } from '@rebbehub/hebrew';
import type { ImportRecord, Importer } from './importer.js';

const MONTH_WORDS = new Set(MONTHS.flatMap((m) => [m.he, ...m.aliases].flatMap((name) => normalizeSearchText(name).split(' '))));

/**
 * The dates of the Rebbe's letters, Igros Kodesh (11,059 letters in 28
 * volumes). The letters themselves, with their words, come in with
 * Sichos-Kodesh's works (the `igros-kodesh-rebbe` sefer: its letters ship,
 * cleared on 2026-09-24, see Sichos-Kodesh's SHIPPABLE_COLLECTIONS). What
 * that catalog does not carry is each letter's date: it is in the date
 * line at the head of the letter, in the Igros app's own files, which
 * Sichos-Kodesh's packages/igros-index reads (`build-igros`) into one JSON
 * file per volume. This importer reads that output and puts each letter's
 * date on its page, so a letter is found by its day like a farbrengen.
 *
 * The app's files are Shmuly's and are never in a repository: the import
 * runs where a build of them is given (IGROS_DATA). The Maanos, which the
 * same build reads, are not imported: their rights are not cleared.
 */

export const IGROS_WORK = 'igros-kodesh-rebbe';

/** One letter as `build-igros` writes it (Sichos-Kodesh's `IgrosLetter`), as far as this reads it. */
export interface IgrosLetterRecord {
  /** `igros:3275`, `igros:141a` for a supplement. */
  id: string;
  volume: number;
  /** Plain text: `ב"ה, ט"ו שבט, תשט"ו`. */
  dateLine: string;
  /** The year the date line names, when it names one. */
  hebrewYear: number | null;
}

/** Reads the letters of a `build-igros` output folder (`igros/vol-NN.json`); the maanos next to them are left alone. */
export async function readIgrosBuild(dir: string): Promise<IgrosLetterRecord[]> {
  const volumes = join(dir, 'igros');
  if (!existsSync(volumes)) throw new Error(`no igros/ in ${dir}: give the folder Sichos-Kodesh's build-igros wrote`);
  const files = (await readdir(volumes)).filter((f) => /^vol-\d+\.json$/.test(f)).sort();
  const letters: IgrosLetterRecord[] = [];
  for (const file of files) letters.push(...(JSON.parse(await readFile(join(volumes, file), 'utf8')) as { letters: IgrosLetterRecord[] }).letters);
  if (!letters.length) throw new Error(`no letters in ${volumes}`);
  return letters;
}

/**
 * A letter's date from its date line: the day, month and year when it
 * names them (`ט"ו שבט, תשט"ו` → 5715-05-15), otherwise as much of it as
 * is certain (`ר"ח שבט תשט"ו` → 5715-05), otherwise the year alone.
 * Words that are not part of a date (`ב"ה`, `ערב`, `עש"ק`) are passed over.
 */
export function letterDate(letter: Pick<IgrosLetterRecord, 'dateLine' | 'hebrewYear'>): string | null {
  // Only what can be part of a date: a month's words, a day (1-30), and the letter's own year.
  let text = normalizeSearchText(letter.dateLine.replace(/ב["״]ה/g, ' '))
    .split(' ')
    .filter((t) => {
      if (MONTH_WORDS.has(t) || /^\d{1,4}$/.test(t)) return true;
      const n = parseHebrewNumeral(t);
      if (n !== null && n >= 1 && n <= 30) return true;
      return letter.hebrewYear ? parseHebrewYear(t) === letter.hebrewYear : n !== null && n >= 100;
    })
    .join(' ');
  for (let tries = 0; text && tries < 12; tries++) {
    const parsed = parseDateText(text);
    if (parsed.ok) {
      // A year the letter's own reading disagrees with is a misreading: keep the letter's.
      if (letter.hebrewYear && !parsed.key.startsWith(String(letter.hebrewYear))) break;
      return parsed.key;
    }
    const word = /could not read "([^"]+)"/.exec(parsed.reason)?.[1];
    if (!word) break;
    text = text
      .split(' ')
      .filter((t, i, all) => t !== word || all.indexOf(word) !== i)
      .join(' ');
  }
  return letter.hebrewYear ? String(letter.hebrewYear) : null;
}

/** A letter's unit key: the works importer's (`sichos-kodesh-unit:igros-kodesh-rebbe/3275`). */
export const letterKey = (letter: Pick<IgrosLetterRecord, 'id'>) => `sichos-kodesh-unit:${IGROS_WORK}/${letter.id.replace(/^igros:/, '')}`;

export function igrosImporter(input: IgrosLetterRecord[] | (() => Promise<IgrosLetterRecord[]>)): Importer {
  return {
    id: 'igros',
    bot: { id: 'bot:igros', displayName: 'Igros Kodesh dates importer' },
    async *records(): AsyncIterable<ImportRecord> {
      const letters = typeof input === 'function' ? await input() : input;
      for (const letter of letters) {
        if (!/^igros:\d+[a-z]?(-\d+)?$/.test(letter.id)) continue; // a maaneh, or anything else, is not a letter
        const date = letterDate(letter);
        if (!date) continue;
        yield { key: letterKey(letter), type: 'unit', patch: 'set', data: { date } };
      }
    },
  };
}
