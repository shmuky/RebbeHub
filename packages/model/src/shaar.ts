import type { LocalName, MachineOrigin, WorkData } from './entities.js';
import { isEntityId } from './ids.js';
import { GENRES, type Genre } from './works.js';

/**
 * A sefer's shaar file: what a README is to a repository, a shaar is to a
 * sefer. Every text-based sefer in the catalog has one, written the same
 * way everywhere (docs/shaar.md): a header of fixed fields between two
 * `---` lines, then its sections under fixed headings, in plain words.
 *
 *   ---
 *   shaar: 1
 *   title: ליקוטי שיחות
 *   title-en: Likkutei Sichos
 *   by: rh-7k2m9q4d (כ"ק אדמו"ר)
 *   genre: sichos
 *   ---
 *
 *   ## על הספר | About
 *
 *   Sichos of the Rebbe, edited by the Rebbe himself.
 *
 * The file is not kept as text. Its header is the sefer's own fields
 * (its title, authors and genre) and what its title page says besides
 * (a subtitle, the author as printed); its sections are kept as `shaar`
 * on the work. `writeShaar` makes the file from them and `readShaar`
 * reads one back, strictly, saying on which line anything is wrong, so a
 * shaar the catalog accepts is always one it can read, and every shaar
 * looks the same however it was written.
 */

export const SHAAR_VERSION = 1;

export type ShaarSectionKey = 'about' | 'structure' | 'printings' | 'sources' | 'notes';

/** The sections a shaar may have, in the order they are written; a heading may give either name. */
export const SHAAR_SECTIONS: ReadonlyArray<{ key: ShaarSectionKey; he: string; en: string }> = [
  { key: 'about', he: 'על הספר', en: 'About' },
  { key: 'structure', he: 'סדר הספר', en: 'Structure' },
  { key: 'printings', he: 'הדפסות', en: 'Printings' },
  { key: 'sources', he: 'מקורות', en: 'Sources' },
  { key: 'notes', he: 'הערות', en: 'Notes' },
];

/** What a sefer's shaar keeps beyond the sefer's own fields (entities.ts, WorkData.shaar). */
export interface WorkShaar {
  /** The title page's second line: `ליקוטי אמרים` under `תניא`. */
  subtitle?: LocalName;
  /** The author as the title page names him: `מאת כ"ק אדמו"ר הזקן`. */
  byLine?: LocalName;
  /** Each section's words: paragraphs, lines starting `- `, links to the web and to items (rh-…). */
  sections?: Partial<Record<ShaarSectionKey, string>>;
  /** Made from the catalog's data (`catalog`) and not yet read by a person. */
  origin?: MachineOrigin;
}

/** The longest a section may be, and a header field. */
export const SHAAR_SECTION_MAX = 20_000;
const FIELD_MAX = 500;

/** A line of a shaar that cannot be read, and why, in both languages. */
export interface ShaarProblem {
  line: number;
  en: string;
  he: string;
}

/** The fields of a work a shaar sets. */
export interface ShaarFields {
  title: LocalName;
  authors: string[];
  genre: Genre;
  shaar: WorkShaar;
}

export type ShaarReading = { ok: true; fields: ShaarFields; problems: [] } | { ok: false; fields: null; problems: ShaarProblem[] };

/** The header's fields, in the order they are written. `by` may repeat, one line an author. */
const HEADER_KEYS = ['shaar', 'title', 'title-en', 'subtitle', 'subtitle-en', 'by', 'by-line', 'by-line-en', 'genre'] as const;
type HeaderKey = (typeof HEADER_KEYS)[number];

const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim();

/** A section's words as the file keeps them: no spaces at line ends, at most one empty line in a row, nothing around. */
export function tidySection(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The shaar file of a work. `names` gives its authors' names, written after
 * their ids so a person reading the file knows who is meant; the id is what
 * counts.
 */
export function writeShaar(work: Pick<WorkData, 'title' | 'authors' | 'genre' | 'shaar'>, names: Record<string, string> = {}): string {
  const shaar = work.shaar ?? {};
  const lines = ['---', `shaar: ${SHAAR_VERSION}`];
  const field = (key: HeaderKey, value: string | undefined) => {
    if (value && oneLine(value)) lines.push(`${key}: ${oneLine(value)}`);
  };
  field('title', work.title.he);
  field('title-en', work.title.en);
  field('subtitle', shaar.subtitle?.he);
  field('subtitle-en', shaar.subtitle?.en);
  for (const id of work.authors) field('by', names[id] ? `${id} (${oneLine(names[id]!).replace(/[()]/g, '')})` : id);
  field('by-line', shaar.byLine?.he);
  field('by-line-en', shaar.byLine?.en);
  field('genre', work.genre);
  lines.push('---');
  for (const section of SHAAR_SECTIONS) {
    const text = tidySection(shaar.sections?.[section.key] ?? '');
    if (text) lines.push('', `## ${section.he} | ${section.en}`, '', text);
  }
  return `${lines.join('\n')}\n`;
}

/** Which section a heading names, by its Hebrew or English name (either side of `|`). */
function sectionOf(heading: string): ShaarSectionKey | null {
  for (const part of heading.split('|')) {
    const name = oneLine(part).toLowerCase();
    const found = SHAAR_SECTIONS.find((s) => s.he === name || s.en.toLowerCase() === name);
    if (found) return found.key;
  }
  return null;
}

const SECTION_NAMES = SHAAR_SECTIONS.map((s) => `${s.he} | ${s.en}`).join(', ');

/** Reads a shaar file: its fields when every line is right, else every line that is not, and why. */
export function readShaar(text: string): ShaarReading {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const problems: ShaarProblem[] = [];
  const problem = (line: number, en: string, he: string) => problems.push({ line, en, he });

  let at = 0;
  while (at < lines.length && !lines[at]!.trim()) at++;
  if (lines[at]?.trim() !== '---') {
    problem(at + 1, 'A shaar starts with a line of three dashes (---), then its header.', 'שער מתחיל בשורה של שלושה מקפים (---), ואחריה הכותרת.');
    return { ok: false, fields: null, problems };
  }
  const start = at;
  let end = start + 1;
  while (end < lines.length && lines[end]!.trim() !== '---') end++;
  if (end >= lines.length) {
    problem(start + 1, 'The header has no end: close it with a line of three dashes (---).', 'לכותרת אין סוף: סגרו אותה בשורה של שלושה מקפים (---).');
    return { ok: false, fields: null, problems };
  }

  // The header.
  const values = new Map<HeaderKey, string[]>();
  for (let i = start + 1; i < end; i++) {
    const line = lines[i]!;
    if (!line.trim()) continue;
    const match = /^\s*([a-z-]+)\s*:(.*)$/.exec(line);
    if (!match) {
      problem(i + 1, 'Each header line is a field, a colon and its value (title: …).', 'כל שורה בכותרת היא שם שדה, נקודתיים וערך (title: …).');
      continue;
    }
    const key = match[1] as HeaderKey;
    const value = oneLine(match[2]!);
    if (!HEADER_KEYS.includes(key)) {
      problem(i + 1, `There is no field "${match[1]}" in a shaar; its fields are ${HEADER_KEYS.join(', ')}.`, `אין שדה "${match[1]}" בשער; השדות הם ${HEADER_KEYS.join(', ')}.`);
      continue;
    }
    if (values.has(key) && key !== 'by') {
      problem(i + 1, `"${key}" is given twice.`, `השדה "${key}" מופיע פעמיים.`);
      continue;
    }
    if (!value) {
      problem(i + 1, `"${key}" has no value: give one, or leave the line out.`, `לשדה "${key}" אין ערך: כתבו ערך, או השמיטו את השורה.`);
      continue;
    }
    if (value.length > FIELD_MAX) {
      problem(i + 1, `"${key}" is longer than ${FIELD_MAX} characters.`, `השדה "${key}" ארוך מ-${FIELD_MAX} תווים.`);
      continue;
    }
    values.set(key, [...(values.get(key) ?? []), value]);
  }
  const lineOf = (key: HeaderKey) => {
    for (let i = start + 1; i < end; i++) if (new RegExp(`^\\s*${key}\\s*:`).test(lines[i]!)) return i + 1;
    return start + 1;
  };
  const one = (key: HeaderKey) => values.get(key)?.[0];
  const version = one('shaar');
  if (!version) problem(start + 2, 'The header\'s first field is "shaar: 1", the version of these rules.', 'השדה הראשון בכותרת הוא "shaar: 1", גרסת הכללים.');
  else if (version !== String(SHAAR_VERSION)) problem(lineOf('shaar'), `This is a shaar of version ${version}; the catalog reads version ${SHAAR_VERSION}.`, `זה שער בגרסה ${version}; הקטלוג קורא גרסה ${SHAAR_VERSION}.`);
  if (!one('title')) problem(start + 1, 'A shaar needs the sefer\'s name in Hebrew (title: …).', 'לשער צריך את שם הספר בעברית (title: …).');
  const genre = one('genre');
  if (!genre) problem(start + 1, `A shaar needs the kind of sefer (genre: one of ${GENRES.join(', ')}).`, `לשער צריך את סוג הספר (genre: אחד מ-${GENRES.join(', ')}).`);
  else if (!(GENRES as readonly string[]).includes(genre)) problem(lineOf('genre'), `"${genre}" is not a kind of sefer; the kinds are ${GENRES.join(', ')}.`, `"${genre}" אינו סוג ספר; הסוגים הם ${GENRES.join(', ')}.`);
  const authors: string[] = [];
  let byLine = start + 1;
  for (const by of values.get('by') ?? []) {
    while (byLine < end && !/^\s*by\s*:/.test(lines[byLine]!)) byLine++;
    const id = /^(rh-[0-9a-z]+)(\s*\(.*\))?$/i.exec(by)?.[1]?.toLowerCase();
    if (!id || !isEntityId(id)) problem(byLine + 1, 'An author is given by his id (by: rh-…), his name after it in brackets if you like.', 'מחבר נכתב במזהה שלו (by: rh-…), ואם רוצים שמו אחריו בסוגריים.');
    else if (authors.includes(id)) problem(byLine + 1, `${id} is given twice.`, `${id} מופיע פעמיים.`);
    else authors.push(id);
    byLine++;
  }
  const pair = (he: HeaderKey, en: HeaderKey): LocalName | undefined => {
    if (one(en) && !one(he)) problem(lineOf(en), `"${en}" needs "${he}" beside it: the Hebrew comes first.`, `"${en}" צריך את "${he}" לצידו: העברית קודמת.`);
    return one(he) ? { he: one(he)!, ...(one(en) ? { en: one(en)! } : {}) } : undefined;
  };
  const title = pair('title', 'title-en');
  const subtitle = pair('subtitle', 'subtitle-en');
  const byLineName = pair('by-line', 'by-line-en');

  // The sections.
  const sections: Partial<Record<ShaarSectionKey, string>> = {};
  let current: { key: ShaarSectionKey; from: number; lines: string[] } | null = null;
  const close = () => {
    if (!current) return;
    const words = tidySection(current.lines.join('\n'));
    if (words.length > SHAAR_SECTION_MAX) problem(current.from, `This section is longer than ${SHAAR_SECTION_MAX} characters.`, `הפרק הזה ארוך מ-${SHAAR_SECTION_MAX} תווים.`);
    else if (words) sections[current.key] = words;
    current = null;
  };
  for (let i = end + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const heading = /^\s*(#+)\s*(.*)$/.exec(line);
    if (heading) {
      if (heading[1] !== '##') {
        problem(i + 1, 'A section\'s heading is two hashes and its name (## על הספר); nothing else starts with #.', 'כותרת של פרק היא שני סימני # ושמו (## על הספר); שום דבר אחר לא מתחיל ב-#.');
        continue;
      }
      const key = sectionOf(heading[2]!);
      if (!key) {
        problem(i + 1, `There is no section "${oneLine(heading[2]!)}"; the sections are ${SECTION_NAMES}.`, `אין פרק "${oneLine(heading[2]!)}"; הפרקים הם ${SECTION_NAMES}.`);
        continue;
      }
      close();
      if (key in sections) problem(i + 1, `The section "${heading[2]!.trim()}" is given twice.`, `הפרק "${heading[2]!.trim()}" מופיע פעמיים.`);
      current = { key, from: i + 1, lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
    else if (line.trim()) problem(i + 1, 'Words after the header belong under a section\'s heading (## על הספר).', 'מילים אחרי הכותרת שייכות תחת כותרת של פרק (## על הספר).');
  }
  close();

  if (problems.length || !title || !genre) return { ok: false, fields: null, problems: problems.sort((a, b) => a.line - b.line) };
  const shaar: WorkShaar = {
    ...(subtitle ? { subtitle } : {}),
    ...(byLineName ? { byLine: byLineName } : {}),
    ...(Object.keys(sections).length ? { sections } : {}),
  };
  return { ok: true, fields: { title, authors, genre: genre as Genre, shaar }, problems: [] };
}

/** Whether a shaar holds anything beyond its sefer's own fields. */
export function shaarIsEmpty(shaar: WorkShaar | undefined): boolean {
  return !shaar || (!shaar.subtitle && !shaar.byLine && !Object.values(shaar.sections ?? {}).some(Boolean));
}

/**
 * A work's data with a shaar file read into it: its title (keeping a
 * Yiddish title the file has no field for), authors, genre and shaar.
 * The shaar a person sends is theirs: it carries no machine origin, so
 * sending on the one the catalog made is saying it was read.
 */
export function applyShaar<T extends Pick<WorkData, 'title' | 'authors' | 'genre' | 'shaar'>>(work: T, text: string): { ok: true; data: T } | { ok: false; problems: ShaarProblem[] } {
  const read = readShaar(text);
  if (!read.ok) return { ok: false, problems: read.problems };
  const { title, authors, genre, shaar } = read.fields;
  // An empty shaar is still kept: a person read the sefer's and had nothing to add, and the catalog makes it no other.
  return { ok: true, data: { ...work, title: { ...title, ...(work.title.yi ? { yi: work.title.yi } : {}) }, authors, genre, shaar } };
}

// ---------------------------------------------------------------- made from the catalog

/** Levels a sefer is divided by, in Hebrew: one and many. */
const LEVEL_WORDS: Record<string, [string, string]> = {
  volume: ['כרך', 'כרכים'],
  chelek: ['חלק', 'חלקים'],
  part: ['חלק', 'חלקים'],
  section: ['מדור', 'מדורים'],
  parsha: ['פרשה', 'פרשיות'],
  year: ['שנה', 'שנים'],
  month: ['חודש', 'חודשים'],
  day: ['יום', 'ימים'],
  chapter: ['פרק', 'פרקים'],
  siman: ['סימן', 'סימנים'],
  sicha: ['שיחה', 'שיחות'],
  maamar: ['מאמר', 'מאמרים'],
  letter: ['מכתב', 'מכתבים'],
  event: ['אירוע', 'אירועים'],
  farbrengen: ['התוועדות', 'התוועדויות'],
  yoman: ['רשימה', 'רשימות'],
};

/** How a sefer is divided, in a sentence: `הספר מחולק לכרכים, וכל כרך לשיחות.` Null for levels without Hebrew words. */
export function structureSentence(levels: readonly string[]): string | null {
  if (!levels.length || levels.some((l) => !LEVEL_WORDS[l])) return null;
  const words = levels.map((l) => LEVEL_WORDS[l]!);
  const steps = words.slice(1).map(([, many], i) => `${i === words.length - 2 ? 'וכל' : 'כל'} ${words[i]![0]} ל${many}`);
  return `הספר מחולק ל${words[0]![1]}${steps.length ? `, ${steps.join(', ')}` : ''}.`;
}

/**
 * A work's shaar made from what the catalog knows of it, for a sefer no
 * person has written one for: its description, and how it is divided.
 * Labelled as made by the catalog until a person reads it and sends it on.
 */
export function shaarFromCatalog(work: Pick<WorkData, 'description' | 'levels'>): WorkShaar {
  const sections: Partial<Record<ShaarSectionKey, string>> = {};
  const about = [work.description?.he, work.description?.en].filter((x): x is string => Boolean(x?.trim())).map(tidySection);
  if (about.length) sections.about = about.join('\n\n');
  const structure = structureSentence(work.levels ?? []);
  if (structure) sections.structure = structure;
  return { ...(Object.keys(sections).length ? { sections } : {}), origin: { by: 'catalog', checked: false } };
}

/** Sefarim that are words to read, and so have a shaar: not a shelf of recordings. */
export const hasShaar = (work: Pick<WorkData, 'genre'>): boolean => work.genre !== 'recordings';

// ---------------------------------------------------------------- reading a section

/** A run of a section's words: plain, a link, or a line break. */
export type ShaarRun = { text: string } | { text: string; href: string } | { br: true };

/** A section as it is shown: paragraphs and lists. */
export type ShaarBlock = { kind: 'paragraph'; runs: ShaarRun[] } | { kind: 'list'; items: ShaarRun[][] };

const LINK = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'])|\b(rh-[0-9a-hjkmnp-tv-z]{6,16})\b/gi;

/** A line's words with its links found: the web, and items by their id (shown at `/rh-…`). */
export function shaarRuns(line: string): ShaarRun[] {
  const runs: ShaarRun[] = [];
  let last = 0;
  for (const match of line.matchAll(LINK)) {
    if (match.index! > last) runs.push({ text: line.slice(last, match.index) });
    runs.push(match[1] ? { text: match[1], href: match[1] } : { text: match[2]!, href: `/${match[2]!.toLowerCase()}` });
    last = match.index! + match[0].length;
  }
  if (last < line.length) runs.push({ text: line.slice(last) });
  return runs;
}

/** A section's words as blocks: paragraphs split by empty lines, their lines kept; lines starting `- ` as a list. */
export function shaarBlocks(text: string): ShaarBlock[] {
  const blocks: ShaarBlock[] = [];
  for (const chunk of tidySection(text).split(/\n\s*\n/)) {
    const lines = chunk.split('\n').filter((l) => l.trim());
    let paragraph: string[] = [];
    let list: ShaarRun[][] | null = null;
    const flush = () => {
      if (!paragraph.length) return;
      blocks.push({ kind: 'paragraph', runs: paragraph.flatMap((l, i) => [...(i ? [{ br: true } as const] : []), ...shaarRuns(l.trim())]) });
      paragraph = [];
    };
    for (const line of lines) {
      const item = /^\s*[-*]\s+(.*)$/.exec(line);
      if (!item) {
        list = null;
        paragraph.push(line);
        continue;
      }
      flush();
      if (!list) {
        list = [];
        blocks.push({ kind: 'list', items: list });
      }
      list.push(shaarRuns(item[1]!.trim()));
    }
    flush();
  }
  return blocks;
}
