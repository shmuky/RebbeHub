import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { toHebrewNumeral } from '@rebbehub/hebrew';
import { joinPath, orderKeys, slugify, type Genre, type Licence, type LocalName, type PageVersion } from '@rebbehub/model';
import { htmlToPageVersion } from './htmlToPageText.js';
import { ref, type ImportRecord, type Importer } from './importer.js';
import { GENRE_NAMES } from './sichosKodeshWorks.js';
import { textUrl } from './sichosKodeshTexts.js';

/**
 * Sefaria's Chabad books that Sichos-Kodesh does not already publish (it
 * publishes the Tanya, Torah Ohr, Likkutei Torah, the Shulchan Aruch HaRav
 * and the rest of its registry; those come in with its works). Each book
 * is read from Sefaria's own API at import time, politely (one request at
 * a time, named, cached), and each chapter becomes a page on RebbeHub with
 * its words.
 *
 * A text whose licence lets it be shared (Kehot's CC BY-NC, CC BY, CC0,
 * public domain) keeps its words, with its credit; any other stays a link
 * to Sefaria. Each kept text is one small HTML document in the same form
 * as Sichos-Kodesh's texts, stored once on RebbeHub's own storage by its
 * sha256 (`texts/<sha256>` in rebbehub-public, served at
 * `/v1/texts/<sha256>`), like the Sefaria copies that come through
 * Sichos-Kodesh. The repository keeps none of them.
 *
 * The walk over a book's schema, and the text documents, follow
 * Sichos-Kodesh's packages/sefaria-index, so a book is cut into the same
 * units either way.
 *
 * With `daily`, the crawl also reads the texts of the daily learning,
 * Chitas and the Rambam (`dailyBooks`): the Chumash with Rashi, Tehillim,
 * every book of the Mishneh Torah and the Sefer HaMitzvot. They are not
 * Chabad books, so they have a Set of their own (`DAILY_SET`) and paths of
 * their own (`/chumash/genesis`, `/tehillim`, `/rambam/<book>`), and for
 * each the crawl asks for a named Hebrew version whose licence lets its
 * words be kept, since Sefaria's first Hebrew version of the Tanach is
 * under CC BY-SA.
 */

export const SEFARIA = 'https://www.sefaria.org';
export const SEFARIA_SET = { key: 'rebbehub-set:sefaria', path: '/sets/sefaria', name: { he: 'ספריא: ספרי חב״ד', en: 'Sefaria: Chabad books' } } as const;
/** The Set of the daily learning's texts from Sefaria (`dailyBooks`). */
export const DAILY_SET = { key: 'rebbehub-set:chitas-rambam', path: '/sets/chitas-rambam', name: { he: 'חת״ת ורמב״ם', en: 'Chitas and Rambam' } } as const;
const USER_AGENT = 'RebbeHubIndex/0.1 (+https://github.com/shmuky/RebbeHub; the Chabad books, with their licences and credit)';

// ---------------------------------------------------------------- the API

interface SefariaTitle {
  text: string;
  lang: string;
  primary?: boolean;
}
export interface SefariaNode {
  nodeType?: string | null;
  key?: string;
  title?: string;
  heTitle?: string;
  titles?: SefariaTitle[];
  sharedTitle?: string;
  default?: boolean;
  depth?: number;
  sectionNames?: string[];
  heSectionNames?: string[];
  content_counts?: unknown;
  nodes?: SefariaNode[];
}
export interface SefariaIndex {
  title: string;
  heTitle?: string;
  categories?: string[];
  authors?: Array<string | { en?: string; he?: string; slug?: string }>;
  schema: SefariaNode;
}
interface SefariaVersionText {
  versionTitle?: string;
  language?: string;
  license?: string;
  text?: unknown;
}
interface SefariaTextResponse {
  versions?: SefariaVersionText[];
  error?: string;
}
/** One version of a book as `api/texts/versions` lists it. */
export interface SefariaVersionInfo {
  versionTitle: string;
  language: string;
  /** The language its words are in: a translation into Yiddish is listed under `he` with `yi` here. */
  actualLanguage?: string;
  license?: string;
  priority?: number | string;
}

export const sefariaRefPath = (text: string) => encodeURIComponent(text.replace(/ /g, '_')).replace(/%2C/g, ',');
/** Where a person reads a ref on Sefaria. */
export const sefariaPage = (text: string) => `${SEFARIA}/${sefariaRefPath(text)}`;

export interface SefariaClient {
  toc(): Promise<unknown>;
  index(title: string): Promise<SefariaIndex>;
  /** A ref in one language (`api/v3/texts`): the named version, or without one the primary. */
  text(textRef: string, language: 'he' | 'en', version?: string): Promise<SefariaTextResponse>;
  /** Every version of a book, with its licence (`api/texts/versions`). */
  versions(title: string): Promise<SefariaVersionInfo[]>;
}

/**
 * A polite reader of Sefaria's API: one request at a time, `delayMs`
 * apart, naming itself; a 429 or 5xx is tried again, backing off; every
 * answer is kept in `cacheDir`, so a second run asks Sefaria nothing.
 */
export function sefariaClient(options: { fetch?: typeof fetch; cacheDir?: string; delayMs?: number; retries?: number; base?: string } = {}): SefariaClient {
  const get = options.fetch ?? fetch;
  const base = options.base ?? SEFARIA;
  const delayMs = options.delayMs ?? 500;
  let last = 0;
  const json = async <T>(url: string): Promise<T> => {
    const file = options.cacheDir ? join(options.cacheDir, `${createHash('sha1').update(url).digest('hex')}.json`) : null;
    if (file && existsSync(file)) return JSON.parse(await readFile(file, 'utf8')) as T;
    for (let attempt = 0; ; attempt++) {
      const wait = last + delayMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      let status = 0;
      try {
        const response = await get(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
        status = response.status;
        const body = await response.text();
        // A bad ref is answered 400 with {"error": ...}: an answer, not a failure.
        if (response.ok || (status === 400 && body.trimStart().startsWith('{'))) {
          if (file) {
            await mkdir(options.cacheDir!, { recursive: true });
            await writeFile(`${file}.partial`, body);
            await rename(`${file}.partial`, file);
          }
          return JSON.parse(body) as T;
        }
      } catch {
        // not reached: tried again below
      }
      if ((status && status !== 429 && status < 500) || attempt >= (options.retries ?? 3)) throw new Error(`Sefaria answered ${status || 'nothing'} for ${url}`);
      await new Promise((r) => setTimeout(r, Math.max(delayMs, 1) * 4 * 2 ** attempt));
    }
  };
  return {
    toc: () => json(`${base}/api/index`),
    async index(title) {
      const index = await json<SefariaIndex & { error?: string }>(`${base}/api/v2/index/${sefariaRefPath(title)}?with_content_counts=1`);
      if (index.error || !index.schema) throw new Error(`Sefaria has no index "${title}": ${index.error ?? 'no schema'}`);
      return index;
    },
    text: (textRef, language, version) => {
      const name = language === 'he' ? 'hebrew' : 'english';
      return json(`${base}/api/v3/texts/${sefariaRefPath(textRef)}?version=${encodeURIComponent(version ? `${name}|${version}` : name)}`);
    },
    async versions(title) {
      const list = await json<unknown>(`${base}/api/texts/versions/${sefariaRefPath(title)}`);
      return Array.isArray(list) ? (list as SefariaVersionInfo[]).filter((v) => v && typeof v.versionTitle === 'string') : [];
    },
  };
}

/** Every book in Sefaria's table of contents, in its order, with its categories. */
function tocBooks(toc: unknown): Array<{ title: string; heTitle: string; categories: string[] }> {
  const out: Array<{ title: string; heTitle: string; categories: string[] }> = [];
  const walk = (node: unknown, trail: string[]) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, trail));
    if (!node || typeof node !== 'object') return;
    const n = node as { contents?: unknown; category?: string; title?: string; heTitle?: string; categories?: string[] };
    if (n.contents) return walk(n.contents, n.category ? [...trail, n.category] : trail);
    if (n.title) out.push({ title: n.title, heTitle: n.heTitle ?? n.title, categories: n.categories ?? trail });
  };
  walk(toc, []);
  return out;
}

/** The books Sefaria files under Chabad, from its table of contents. */
export const chabadTitles = (toc: unknown) => tocBooks(toc).filter((b) => b.categories.includes('Chabad'));

// ---------------------------------------------------------------- the daily learning

/** A book of the daily learning: where it lives on RebbeHub, and which Hebrew versions to ask Sefaria for. */
export interface DailyBook {
  title: string;
  heTitle: string;
  /** Its work's path: `/chumash/genesis`. */
  path: string;
  /** The works contract has no kind for the Tanach, so it is `chassidus`, the kind any Sefaria book falls back to. */
  genre: Genre;
  /** The Hebrew versions to ask for, best first; each is taken only when Sefaria has it under a licence that lets its words be kept. */
  hebrew: readonly string[];
  /** The English versions to ask for, the same way; without them, Sefaria's primary English, kept when its licence lets it be. */
  english?: readonly string[];
}

/** Public domain, all three; the first has the cantillation marks. */
const TANACH_HEBREW = ["Tanach with Ta'amei Hamikra", 'Tanach with Nikkud', 'Tanach with Text Only'];
/** Rosenbaum and Silbermann's London edition, public domain, in both languages (Sefaria's primary English Rashi covers only some chapters). */
const RASHI_HEBREW = ["Pentateuch with Rashi's commentary by M. Rosenbaum and A.M. Silbermann, 1929-1934"];
const RASHI_ENGLISH = RASHI_HEBREW;
/** Public domain, both. */
const MISHNEH_TORAH_HEBREW = ['Torat Emet 363'];
const SEFER_HAMITZVOT_HEBREW = ['Sefer HaMitzvot, Warsaw 1883'];
const CHUMASH: ReadonlyArray<readonly [string, string]> = [
  ['Genesis', 'בראשית'],
  ['Exodus', 'שמות'],
  ['Leviticus', 'ויקרא'],
  ['Numbers', 'במדבר'],
  ['Deuteronomy', 'דברים'],
];

/**
 * The daily learning's books: Chumash with Rashi and Tehillim (Chitas),
 * and the Rambam, every book of the Mishneh Torah (its introduction and
 * list of the mitzvos too) as Sefaria's table of contents has them, and
 * the Sefer HaMitzvot.
 */
export function dailyBooks(toc: unknown): DailyBook[] {
  const books: DailyBook[] = [];
  for (const [title, heTitle] of CHUMASH) {
    books.push({ title, heTitle, path: `/chumash/${slugify(title)}`, genre: 'chassidus', hebrew: TANACH_HEBREW });
    books.push({ title: `Rashi on ${title}`, heTitle: `רש״י על ${heTitle}`, path: `/chumash/rashi-${slugify(title)}`, genre: 'chassidus', hebrew: RASHI_HEBREW, english: RASHI_ENGLISH });
  }
  books.push({ title: 'Psalms', heTitle: 'תהלים', path: '/tehillim', genre: 'chassidus', hebrew: TANACH_HEBREW });
  for (const book of tocBooks(toc)) {
    if (!book.categories.includes('Mishneh Torah') || !book.title.startsWith('Mishneh Torah, ')) continue;
    books.push({ title: book.title, heTitle: book.heTitle, path: `/rambam/${slugify(book.title.slice('Mishneh Torah, '.length))}`, genre: 'halacha', hebrew: MISHNEH_TORAH_HEBREW });
  }
  books.push({ title: 'Sefer HaMitzvot', heTitle: 'ספר המצוות', path: '/sefer-hamitzvos', genre: 'halacha', hebrew: SEFER_HAMITZVOT_HEBREW });
  return books;
}

/**
 * The version of a book to ask for in one language: the first of
 * `preferred` that Sefaria has under a licence that lets its words be
 * kept, else the most prominent such version in that language (not a
 * translation filed under it); null when there is none, and the primary
 * version is asked for, as a link.
 */
export function chooseVersion(versions: readonly SefariaVersionInfo[], language: 'he' | 'en', preferred: readonly string[] = []): string | null {
  const own = versions.filter((v) => v.language === language && (v.actualLanguage ?? language) === language && !/\[[a-z]{2,3}\]\s*$/.test(v.versionTitle) && mayKeepText(sefariaLicence(v.license)));
  for (const title of preferred) {
    const found = own.find((v) => v.versionTitle.trim() === title);
    if (found) return found.versionTitle;
  }
  return [...own].sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0))[0]?.versionTitle ?? null;
}

// ---------------------------------------------------------------- a book's parts

interface Leaf {
  ref: string;
  /** The named parts above it, each with its place among its siblings. */
  trail: Array<{ value: string; label: LocalName }>;
  depth: number;
  sectionNames: string[];
  heSectionNames: string[];
  sectionSizes: number[] | null;
}

const HEBREW_SECTION_NAMES: Record<string, string> = { Chapter: 'פרק', Paragraph: 'פסקה', Siman: 'סימן', Seif: 'סעיף', Section: 'סעיף', Letter: 'אות', Verse: 'פסוק', Page: 'דף', Maamar: 'מאמר', Sicha: 'שיחה' };

function nodeTitle(node: SefariaNode): LocalName {
  const primary = (lang: string) => node.titles?.find((t) => t.primary && t.lang === lang)?.text;
  const en = node.title || primary('en') || node.sharedTitle || node.key || '';
  return { he: node.heTitle || primary('he') || en, en };
}

const deepSum = (value: unknown): number => (typeof value === 'number' ? value : Array.isArray(value) ? value.reduce((s: number, x) => s + deepSum(x), 0) : 0);

function leafOf(node: SefariaNode, textRef: string, trail: Leaf['trail']): Leaf {
  const sectionNames = node.sectionNames ?? [];
  return {
    ref: textRef,
    trail,
    depth: node.depth ?? 1,
    sectionNames,
    heSectionNames: node.heSectionNames ?? sectionNames.map((n) => HEBREW_SECTION_NAMES[n] ?? n),
    sectionSizes: (node.depth ?? 1) >= 2 && Array.isArray(node.content_counts) ? node.content_counts.map(deepSum) : null,
  };
}

/** Every leaf of a book's schema in order; a leaf's ref is the book and the English titles above it, and a `default` node takes its parent's. */
export function bookLeaves(index: SefariaIndex): Leaf[] {
  const out: Leaf[] = [];
  const walk = (node: SefariaNode, textRef: string, trail: Leaf['trail']) => {
    let place = 0;
    for (const child of node.nodes ?? []) {
      if (child.default) {
        if (child.nodes?.length) walk(child, textRef, trail);
        else out.push(leafOf(child, textRef, trail));
        continue;
      }
      place++;
      const title = nodeTitle(child);
      const childTrail = [...trail, { value: String(place), label: title }];
      if (child.nodes?.length) walk(child, `${textRef}, ${title.en}`, childTrail);
      else out.push(leafOf(child, `${textRef}, ${title.en}`, childTrail));
    }
  };
  if (index.schema.nodes?.length) walk(index.schema, index.title, []);
  else out.push(leafOf(index.schema, index.title, []));
  return out;
}

// ---------------------------------------------------------------- the text documents

const escapeText = (text: string) => text.replace(/&(?![a-zA-Z][a-zA-Z0-9]*;|#[0-9]+;|#x[0-9a-fA-F]+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = (text: string) => escapeText(text).replace(/"/g, '&quot;');

/**
 * One Sefaria segment as clean inline HTML: bold, italic, underline, small,
 * line breaks; its footnotes moved to the unit's notes and linked from
 * the text; page markers kept as marks; every other tag unwrapped.
 */
export function cleanSegment(html: string, notes: string[]): string {
  let text = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '');
  // A footnote: its marker, then its text in <i class="footnote">, which may hold more italics.
  text = text.replace(/<sup[^>]*class="[^"]*footnote-marker[^"]*"[^>]*>[\s\S]*?<\/sup>\s*/gi, '');
  for (;;) {
    const start = /<i[^>]*class="[^"]*\bfootnote\b[^"]*"[^>]*>/i.exec(text);
    if (!start) break;
    let depth = 0;
    let end = text.length;
    const tags = /<(\/?)i\b[^>]*>/gi;
    tags.lastIndex = start.index;
    for (let m = tags.exec(text); m; m = tags.exec(text)) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) {
        end = m.index + m[0].length;
        break;
      }
    }
    const inner = cleanSegment(text.slice(start.index + start[0].length, Math.max(start.index + start[0].length, end - 4)), []);
    if (inner) notes.push(inner);
    // Marked for now, and made a link once the tags are cleaned.
    text = `${text.slice(0, start.index)}${inner ? `\u0001f${notes.length}\u0002` : ''}${text.slice(end)}`;
  }
  // Page and study-schedule markers (`<i data-overlay="Vilna Pages" data-value="[מ: כד כסלו]"></i>`) keep only their value.
  text = text.replace(/<([a-z]+)\b[^>]*\bdata-overlay\b[^>]*>(\s*<\/\1>)?/gi, (tag: string) => {
    const value = /\bdata-value="([^"]*)"/i.exec(tag)?.[1]?.trim();
    return value ? `\u0001m${value.replace(/[\u0001\u0002<>]/g, '')}\u0002` : '';
  });
  const INLINE: Record<string, string> = { b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u', small: 'small', sup: 'sup' };
  let out = '';
  const open: string[] = [];
  for (const token of text.split(/(<[^>]*>)/)) {
    if (!token) continue;
    if (token[0] !== '<') {
      out += escapeText(token);
      continue;
    }
    const tag = /^<\s*(\/?)\s*([a-z0-9]+)/i.exec(token);
    if (!tag) continue;
    const name = tag[2]!.toLowerCase();
    if (name === 'br') out += '<br>';
    else if (INLINE[name] && !tag[1] && !token.endsWith('/>')) {
      open.push(INLINE[name]!);
      out += `<${INLINE[name]}>`;
    } else if (INLINE[name] && tag[1] && open.lastIndexOf(INLINE[name]!) >= 0) {
      const at = open.lastIndexOf(INLINE[name]!);
      while (open.length > at) out += `</${open.pop()}>`;
    }
    // Any other tag (span, a, div, big) is unwrapped: its words stay.
  }
  while (open.length) out += `</${open.pop()}>`;
  return out
    .replace(/\u0001f(\d+)\u0002/g, '<sup class="fn"><a href="#n$1" id="r$1">$1</a></sup>')
    .replace(/\u0001m([^\u0002]*)\u0002/g, '<span class="mark">$1</span>')
    .replace(/\s+/g, ' ')
    .replace(/<(b|i|u|small|sup)>\s*<\/\1>/g, '')
    .trim();
}

const hasText = (text: unknown): boolean => (typeof text === 'string' ? text.replace(/<[^>]*>/g, '').trim().length > 0 : Array.isArray(text) && text.some(hasText));

const LICENCE_LABELS: Partial<Record<Licence, string>> = { 'public-domain': 'Public domain', cc0: 'CC0', 'cc-by': 'CC BY', 'cc-by-nc': 'CC BY-NC' };

/** Sefaria's licence strings, as licences; anything else is unknown, and keeps no text. */
export function sefariaLicence(license: string | undefined): Licence {
  const normal = (license ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (normal === 'cc0' || normal === 'cc0-1.0') return 'cc0';
  if (normal === 'public-domain') return 'public-domain';
  if (normal === 'cc-by' || normal === 'cc-by-3.0' || normal === 'cc-by-4.0') return 'cc-by';
  if (normal === 'cc-by-nc' || normal === 'cc-by-nc-3.0' || normal === 'cc-by-nc-4.0') return 'cc-by-nc';
  return 'unknown';
}

/** Whether a licence lets RebbeHub keep and show the words (docs/rights.md: open, or with credit). */
export const mayKeepText = (licence: Licence) => licence === 'cc-by-nc' || licence === 'cc-by' || licence === 'cc0' || licence === 'public-domain';

const sectionLabel = (name: string | undefined, n: number, language: 'he' | 'en') => {
  const number = language === 'he' ? toHebrewNumeral(n).replace(/[׳״]/g, '') : String(n);
  return name ? `${name} ${number}` : number;
};

function renderBody(text: unknown, names: readonly string[], language: 'he' | 'en', notes: string[], level: number): string {
  if (typeof text === 'string') {
    const html = cleanSegment(text, notes);
    return html ? `<p>${html}</p>` : '';
  }
  if (!Array.isArray(text)) return '';
  const deeper = text.some(Array.isArray);
  return text
    .map((part, i) => {
      if (!deeper || !Array.isArray(part)) return renderBody(part, names.slice(1), language, notes, level);
      const inner = renderBody(part, names.slice(1), language, notes, level + 1);
      return inner ? `<h${Math.min(level, 6)}>${escapeText(sectionLabel(names[0], i + 1, language))}</h${Math.min(level, 6)}>${inner}` : '';
    })
    .join('');
}

/** One unit in one version, as a text document with its credit; the same text gives the same bytes on every run. */
export function renderSefariaText(unit: { heading: string; ref: string; language: 'he' | 'en'; version: string; licence: Licence; text: unknown; sectionNames: readonly string[] }): string {
  const notes: string[] = [];
  const main = renderBody(unit.text, unit.sectionNames, unit.language, notes, 2);
  const noteList = notes.map((html, i) => `<p id="n${i + 1}"><a href="#r${i + 1}">${i + 1}</a> ${html}</p>`).join('');
  const url = `${sefariaPage(unit.ref)}?${unit.language === 'he' ? 'vhe' : 'ven'}=${encodeURIComponent(unit.version.replace(/ /g, '_'))}`;
  return (
    `<article dir="${unit.language === 'he' ? 'rtl' : 'ltr'}" lang="${unit.language}" data-source="sefaria" data-version="${escapeAttribute(unit.version)}">` +
    `<h1>${escapeText(unit.heading)}</h1>` +
    main +
    (noteList ? `<aside class="notes">${noteList}</aside>` : '') +
    `<footer class="source"><span class="version">${escapeText(unit.version)}</span> · <span class="licence">${escapeText(LICENCE_LABELS[unit.licence] ?? unit.licence)}</span> · <a href="${escapeAttribute(url)}">Sefaria</a></footer>` +
    `</article>\n`
  );
}

// ---------------------------------------------------------------- the crawl

export interface SefariaText {
  language: 'he' | 'en';
  version: string;
  licence: Licence;
  /** Set when the licence lets the words be kept: the document's hash and size (the bytes are in `texts/<sha256>.html` next to the crawl). */
  sha256?: string;
  bytes?: number;
  /** Set once the document is on RebbeHub's own storage. */
  kept?: boolean;
}
export interface SefariaUnit {
  /** Its place in the book: `2/14`. */
  id: string;
  ref: string;
  label: LocalName;
  position: Array<{ level: string; value: string; label?: LocalName }>;
  texts: SefariaText[];
}
export interface SefariaBook {
  title: string;
  heTitle: string;
  categories: string[];
  authors: string[];
  /** Set for a book of the daily learning (`dailyBooks`): its work's path and kind, and it goes in the daily learning's Set. */
  daily?: { path: string; genre: Genre };
  units: SefariaUnit[];
}
export interface SefariaCrawl {
  books: SefariaBook[];
}

async function leafText(client: SefariaClient, leaf: Leaf, language: 'he' | 'en', version?: string): Promise<SefariaVersionText | null> {
  const answer = await client.text(leaf.ref, language, version);
  const found = answer.versions?.[0];
  if (found?.text !== undefined) return found;
  // A named version this part does not have: the primary one, as for any book.
  if (version && !answer.error) return leafText(client, leaf, language);
  // Too big for one answer: its sections one by one.
  if (!answer.error || leaf.depth < 2 || !leaf.sectionSizes) return null;
  const sections: unknown[] = [];
  let first: SefariaVersionText | undefined;
  for (const [i, size] of leaf.sectionSizes.entries()) {
    if (!size) {
      sections.push([]);
      continue;
    }
    const part = (await client.text(`${leaf.ref} ${i + 1}`, language, version)).versions?.[0];
    first ??= part;
    sections.push(part?.text ?? []);
  }
  return first ? { ...first, text: sections } : null;
}

const authorNames = (index: SefariaIndex) => (index.authors ?? []).map((a) => (typeof a === 'string' ? a : `${a.slug ?? ''} ${a.en ?? ''}`)).filter(Boolean);

/**
 * Reads one book from Sefaria into units, each with its primary Hebrew and
 * English versions (or the versions `options.hebrew` and `options.english` name); the
 * words of the ones whose licence lets them be kept are handed to `save`
 * as documents.
 *
 * A unit is one section of the book's first level: a chapter. Its
 * segments are numbered as Sefaria numbers them, so verse 5 is segment 5;
 * a book three levels deep (Rashi: chapter, verse, comment) gives each
 * verse a heading with its comments under it, so the page's segment ids
 * are the verse (`5`) and the comment within it (`5.2`).
 */
export async function crawlBook(
  client: SefariaClient,
  title: string,
  save: (sha256: string, html: string) => Promise<void>,
  log: (line: string) => void = () => {},
  options: { hebrew?: string; english?: string; heTitle?: string; daily?: SefariaBook['daily'] } = {},
): Promise<SefariaBook> {
  const index = await client.index(title);
  const book: SefariaBook = {
    title: index.title,
    heTitle: options.heTitle || index.heTitle || index.title,
    categories: index.categories ?? [],
    authors: authorNames(index),
    ...(options.daily ? { daily: options.daily } : {}),
    units: [],
  };
  const seen = new Set<string>();
  for (const leaf of bookLeaves(index)) {
    const versions = new Map<'he' | 'en', SefariaVersionText>();
    for (const language of ['he', 'en'] as const) {
      const found = await leafText(client, leaf, language, language === 'he' ? options.hebrew : options.english);
      if (found && hasText(found.text)) versions.set(language, found);
    }
    const count = leaf.depth < 2 ? 1 : Math.max(0, ...[...versions.values()].map((v) => (Array.isArray(v.text) ? v.text.length : 1)));
    for (let i = 0; i < count; i++) {
      const n = i + 1;
      const unitRef = leaf.depth < 2 ? leaf.ref : `${leaf.ref} ${n}`;
      const position: SefariaUnit['position'] = leaf.trail.map((t) => ({ level: 'part', value: t.value, label: t.label }));
      if (leaf.depth >= 2) position.push({ level: slugify(leaf.sectionNames[0] ?? 'section') || 'section', value: String(n) });
      if (!position.length) position.push({ level: 'part', value: '1' });
      const id = position.map((p) => p.value).join('/');
      if (seen.has(id)) continue;
      const label: LocalName = {
        he: [leaf.trail.map((t) => t.label.he).join(', '), leaf.depth >= 2 ? sectionLabel(leaf.heSectionNames[0], n, 'he') : ''].filter(Boolean).join(', ') || book.heTitle,
        en: [leaf.trail.map((t) => t.label.en).join(', '), leaf.depth >= 2 ? sectionLabel(leaf.sectionNames[0], n, 'en') : ''].filter(Boolean).join(', ') || book.title,
      };
      const texts: SefariaText[] = [];
      for (const [language, version] of versions) {
        const text = leaf.depth < 2 ? version.text : Array.isArray(version.text) ? version.text[i] : i === 0 ? version.text : undefined;
        if (!hasText(text)) continue;
        const licence = sefariaLicence(version.license);
        const entry: SefariaText = { language, version: version.versionTitle ?? (language === 'he' ? 'Hebrew' : 'English'), licence };
        if (mayKeepText(licence)) {
          const html = renderSefariaText({ heading: language === 'he' ? label.he : label.en!, ref: unitRef, language, version: entry.version, licence, text, sectionNames: (language === 'he' ? leaf.heSectionNames : leaf.sectionNames).slice(leaf.depth < 2 ? 0 : 1) });
          entry.sha256 = createHash('sha256').update(html, 'utf8').digest('hex');
          entry.bytes = Buffer.byteLength(html, 'utf8');
          await save(entry.sha256, html);
        }
        texts.push(entry);
      }
      if (!texts.length) continue;
      seen.add(id);
      book.units.push({ id, ref: unitRef, label: { he: label.he.slice(0, 500), en: label.en!.slice(0, 500) }, position, texts });
    }
  }
  log(`${book.title}: ${book.units.length} units`);
  return book;
}

/** The Sefaria titles Sichos-Kodesh's registry already has (they come in with its works). */
export async function sichosKodeshSefariaTitles(root: string): Promise<Set<string>> {
  const dir = root.endsWith('works') ? root : join(root, 'apps/mobile/src/catalog/data/works');
  const index = JSON.parse(await readFile(join(dir, 'works.json'), 'utf8')) as { works: Array<{ sources: Array<{ source: string; sourceId: string }> }> };
  return new Set(index.works.flatMap((w) => w.sources.filter((s) => s.source === 'sefaria').map((s) => s.sourceId)));
}

/**
 * Crawls every Chabad book on Sefaria but those in `exclude` into `out`
 * (`crawl.json`, and each kept text as `texts/<sha256>.html`); with
 * `daily`, the daily learning's books too (`dailyBooks`), each in the
 * Hebrew version `chooseVersion` picks from the ones Sefaria lists.
 * `only` limits both to the titles it names.
 */
export async function crawlSefaria(options: { out: string; exclude: Set<string>; client: SefariaClient; only?: string[]; daily?: boolean; log?: (line: string) => void }): Promise<SefariaCrawl> {
  const log = options.log ?? (() => {});
  const toc = options.only && !options.daily ? null : await options.client.toc();
  const daily = options.daily ? dailyBooks(toc).filter((b) => !options.only || options.only.includes(b.title)) : [];
  const dailyTitles = new Set(daily.map((b) => b.title));
  const titles = (options.only ?? chabadTitles(toc).map((t) => t.title)).filter((t) => !dailyTitles.has(t));
  const wanted = titles.filter((t) => !options.exclude.has(t) && ![...options.exclude].some((e) => t.endsWith(` on ${e}`)));
  if (titles.length || !daily.length) log(`${titles.length} Chabad books on Sefaria; ${wanted.length} not published by Sichos-Kodesh`);
  await mkdir(join(options.out, 'texts'), { recursive: true });
  const save = async (sha256: string, html: string) => {
    const file = join(options.out, 'texts', `${sha256}.html`);
    if (!existsSync(file)) await writeFile(file, html);
  };
  const crawl: SefariaCrawl = { books: [] };
  for (const title of wanted) {
    try {
      crawl.books.push(await crawlBook(options.client, title, save, log));
    } catch (error) {
      log(`${title}: ${error instanceof Error ? error.message : String(error)}; left for the next run`);
    }
  }
  if (daily.length) log(`${daily.length} books of the daily learning`);
  for (const book of daily) {
    try {
      const versions = await options.client.versions(book.title);
      const hebrew = chooseVersion(versions, 'he', book.hebrew) ?? undefined;
      const english = book.english ? (chooseVersion(versions, 'en', book.english) ?? undefined) : undefined;
      log(`${book.title}: Hebrew ${hebrew ?? 'as Sefaria gives it first (no version that may be kept)'}${english ? `; English ${english}` : ''}`);
      crawl.books.push(await crawlBook(options.client, book.title, save, log, { hebrew, english, heTitle: book.heTitle, daily: { path: book.path, genre: book.genre } }));
    } catch (error) {
      log(`${book.title}: ${error instanceof Error ? error.message : String(error)}; left for the next run`);
    }
  }
  await writeFile(join(options.out, 'crawl.json'), JSON.stringify(crawl));
  return crawl;
}

/** A crawl as written, and a document of it by its hash. */
export async function readSefariaCrawl(dir: string): Promise<{ crawl: SefariaCrawl; text: (sha256: string) => Promise<string | null> }> {
  const crawl = JSON.parse(await readFile(join(dir, 'crawl.json'), 'utf8')) as SefariaCrawl;
  return {
    crawl,
    text: async (sha256) => {
      const file = join(dir, 'texts', `${sha256}.html`);
      return /^[0-9a-f]{64}$/.test(sha256) && existsSync(file) ? readFile(file, 'utf8') : null;
    },
  };
}

// ---------------------------------------------------------------- the importer

/** A book's kind, from its English title and categories. */
export function sefariaGenre(book: Pick<SefariaBook, 'title' | 'categories'>): Genre {
  const t = `${book.title} ${book.categories.join(' ')}`;
  if (/siddur|prayer|liturgy/i.test(t)) return 'siddur';
  if (/igrot|igros|letters/i.test(t)) return 'igros';
  if (/sichot|sichos|talks/i.test(t)) return 'sichos';
  if (/maamar|discourse/i.test(t)) return 'maamarim';
  if (/halakh|shulchan|laws/i.test(t)) return 'halacha';
  if (/minhag|customs/i.test(t)) return 'minhagim';
  return 'chassidus';
}

/** Sichos-Kodesh's author ids, from the names Sefaria gives its authors. */
export function sefariaAuthor(name: string): string | null {
  if (/shneur.?zalman/i.test(name)) return 'alter-rebbe';
  if (/tzemach|tzemah/i.test(name)) return 'tzemach-tzedek';
  if (/shalom.?dovber|sholom.?dovber|rashab/i.test(name)) return 'rebbe-rashab';
  if (/dovber|dov.?ber|mitteler/i.test(name)) return 'mitteler-rebbe';
  if (/shmuel|maharash/i.test(name)) return 'rebbe-maharash';
  if (/yosef.?yitz/i.test(name)) return 'frierdiker-rebbe';
  if (/menachem.?mendel.?schneerson\b|the.?rebbe/i.test(name)) return 'the-rebbe';
  return null;
}

const bookSlug = (title: string) => slugify(title) || createHash('sha256').update(title).digest('hex').slice(0, 12);

export interface SefariaInput {
  crawl: SefariaCrawl;
  text: (sha256: string) => Promise<string | null>;
  /** Sichos-Kodesh's author ids, so only those are referred to. */
  authors: Set<string>;
  api?: string;
}

export function sefariaImporter(input: SefariaInput | (() => Promise<SefariaInput>)): Importer {
  return {
    id: 'sefaria',
    bot: { id: 'bot:sefaria', displayName: 'Sefaria Chabad books importer' },
    async *records(): AsyncIterable<ImportRecord> {
      const { crawl, text, authors, api } = typeof input === 'function' ? await input() : input;
      yield { key: SEFARIA_SET.key, type: 'set', path: SEFARIA_SET.path, data: { name: SEFARIA_SET.name, slug: 'sefaria', policy: 'moderated', keepers: [] } };
      if (crawl.books.some((b) => b.daily)) yield { key: DAILY_SET.key, type: 'set', path: DAILY_SET.path, data: { name: DAILY_SET.name, slug: 'chitas-rambam', policy: 'moderated', keepers: [] } };
      // The daily learning's books are not Chabad books: they are in their own Set, not a Chabad kind's.
      const genres = new Set(crawl.books.filter((b) => !b.daily).map(sefariaGenre));
      for (const genre of [...genres].sort()) yield { key: `rebbehub-set:${genre}`, type: 'set', path: `/sets/${genre}`, data: { name: GENRE_NAMES[genre], slug: genre, policy: 'moderated', keepers: [] } };
      for (const book of crawl.books) {
        if (!book.units.length) continue;
        // A daily book's keys and path are its own (`sefaria-daily-work:Genesis` at /chumash/genesis), apart from the Chabad books'.
        const slug = book.daily ? book.daily.path.split('/').filter(Boolean).join('-') : bookSlug(book.title);
        const place = book.daily ? book.daily.path.split('/').filter(Boolean) : ['sefaria', slug];
        const workKey = book.daily ? `sefaria-daily-work:${book.title}` : `sefaria-work:${book.title}`;
        const unitKey = book.daily ? `sefaria-daily-unit:${book.title}` : `sefaria-unit:${book.title}`;
        const genre = book.daily ? book.daily.genre : sefariaGenre(book);
        const bookAuthors = [...new Set(book.authors.map(sefariaAuthor).filter((a): a is string => a !== null && authors.has(a)))];
        const versions = new Map<string, SefariaText>();
        for (const u of book.units) for (const t of u.texts) versions.set(`${t.language}\u0000${t.version}`, t);
        const levels = [...new Set(book.units[0]!.position.map((p) => p.level))];
        yield {
          key: workKey,
          type: 'work',
          path: joinPath(...place),
          data: {
            title: { he: book.heTitle.slice(0, 500), en: book.title.slice(0, 500) },
            slug: (book.daily ? slug : `sefaria-${slug}`).slice(0, 100).replace(/-+$/, ''),
            authors: bookAuthors.map((a) => ref(`sichos-kodesh-author:${a}`)),
            genre,
            levels,
            sets: book.daily ? [ref(DAILY_SET.key)] : [ref(`rebbehub-set:${genre}`), ref(SEFARIA_SET.key)],
            externalIds: { sefaria: book.title.slice(0, 200) },
            sourceCopies: [...versions.values()].map((t) => ({ source: 'sefaria', sourceId: book.title, kind: 'text', language: t.language, licence: t.licence, version: t.version, ...(mayKeepText(t.licence) ? { credit: `Sefaria: ${t.version}` } : {}) })),
          },
        };
        const orders = orderKeys(book.units.length);
        for (const [i, unit] of book.units.entries()) {
          // The page's words: each kept version (its Hebrew first, then its English), segment by
          // segment as Sefaria numbers them, so the two stand side by side; the first one's own copy on RebbeHub.
          const kept = unit.texts.filter((t) => t.sha256 && mayKeepText(t.licence)).sort((a, b) => Number(b.language === 'he') - Number(a.language === 'he'));
          const versions: PageVersion[] = [];
          let bodySource: Record<string, string> | undefined;
          for (const t of kept) {
            const html = await text(t.sha256!);
            if (!html) continue;
            if (versions.some((v) => v.id === t.language)) continue;
            const version = htmlToPageVersion(html, {
              id: t.language,
              language: t.language,
              numbered: true,
              title: t.version,
              credit: `Sefaria: ${t.version}`,
              licence: t.licence,
              url: `${sefariaPage(unit.ref)}?${t.language === 'he' ? 'vhe' : 'ven'}=${encodeURIComponent(t.version.replace(/ /g, '_'))}`,
            });
            if (!version.segments.length) continue;
            versions.push(version);
            if (!bodySource) {
              bodySource = {
                source: 'sefaria',
                via: 'sefaria',
                sourceId: unit.ref,
                url: sefariaPage(unit.ref),
                ...(t.kept ? { copy: textUrl(t.sha256!, api) } : {}),
                licence: t.licence,
                credit: `Sefaria: ${t.version}`,
                rights: t.licence === 'cc0' || t.licence === 'public-domain' ? 'open' : 'credit',
              };
            }
          }
          yield {
            key: `${unitKey}/${unit.id}`,
            type: 'unit',
            path: joinPath(...place, ...unit.position.map((p) => p.value)),
            data: {
              work: ref(workKey),
              position: unit.position,
              order: orders[i]!,
              label: unit.label,
              externalIds: { sefaria: unit.ref.slice(0, 200) },
              ...(bodySource ? { body: { profile: 'sefaria', versions }, bodySource } : {}),
              editions: unit.texts.map((t) => ({
                source: 'sefaria',
                sourceId: unit.ref,
                kind: 'text',
                licence: t.licence,
                language: t.language,
                version: t.version,
                ...(mayKeepText(t.licence) ? { credit: `Sefaria: ${t.version}` } : {}),
                url: sefariaPage(unit.ref),
              })),
            },
          };
        }
      }
    },
  };
}
