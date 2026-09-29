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
 */

export const SEFARIA = 'https://www.sefaria.org';
export const SEFARIA_SET = { key: 'rebbehub-set:sefaria', path: '/sets/sefaria', name: { he: 'ספריא: ספרי חב״ד', en: 'Sefaria: Chabad books' } } as const;
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

export const sefariaRefPath = (text: string) => encodeURIComponent(text.replace(/ /g, '_')).replace(/%2C/g, ',');
/** Where a person reads a ref on Sefaria. */
export const sefariaPage = (text: string) => `${SEFARIA}/${sefariaRefPath(text)}`;

export interface SefariaClient {
  toc(): Promise<unknown>;
  index(title: string): Promise<SefariaIndex>;
  /** The primary version of a ref in one language (`api/v3/texts`). */
  text(textRef: string, language: 'he' | 'en'): Promise<SefariaTextResponse>;
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
    text: (textRef, language) => json(`${base}/api/v3/texts/${sefariaRefPath(textRef)}?version=${language === 'he' ? 'hebrew' : 'english'}`),
  };
}

/** The books Sefaria files under Chabad, from its table of contents. */
export function chabadTitles(toc: unknown): Array<{ title: string; heTitle: string; categories: string[] }> {
  const out: Array<{ title: string; heTitle: string; categories: string[] }> = [];
  const walk = (node: unknown, trail: string[]) => {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, trail));
    if (!node || typeof node !== 'object') return;
    const n = node as { contents?: unknown; category?: string; title?: string; heTitle?: string; categories?: string[] };
    if (n.contents) return walk(n.contents, n.category ? [...trail, n.category] : trail);
    const categories = n.categories ?? trail;
    if (n.title && categories.includes('Chabad')) out.push({ title: n.title, heTitle: n.heTitle ?? n.title, categories });
  };
  walk(toc, []);
  return out;
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
  units: SefariaUnit[];
}
export interface SefariaCrawl {
  books: SefariaBook[];
}

async function leafText(client: SefariaClient, leaf: Leaf, language: 'he' | 'en'): Promise<SefariaVersionText | null> {
  const answer = await client.text(leaf.ref, language);
  const found = answer.versions?.[0];
  if (found?.text !== undefined) return found;
  // Too big for one answer: its sections one by one.
  if (!answer.error || leaf.depth < 2 || !leaf.sectionSizes) return null;
  const sections: unknown[] = [];
  let first: SefariaVersionText | undefined;
  for (const [i, size] of leaf.sectionSizes.entries()) {
    if (!size) {
      sections.push([]);
      continue;
    }
    const part = (await client.text(`${leaf.ref} ${i + 1}`, language)).versions?.[0];
    first ??= part;
    sections.push(part?.text ?? []);
  }
  return first ? { ...first, text: sections } : null;
}

const authorNames = (index: SefariaIndex) => (index.authors ?? []).map((a) => (typeof a === 'string' ? a : `${a.slug ?? ''} ${a.en ?? ''}`)).filter(Boolean);

/**
 * Reads one book from Sefaria into units, each with its primary Hebrew and
 * English versions; the words of the ones whose licence lets them be kept
 * are handed to `save` as documents.
 */
export async function crawlBook(client: SefariaClient, title: string, save: (sha256: string, html: string) => Promise<void>, log: (line: string) => void = () => {}): Promise<SefariaBook> {
  const index = await client.index(title);
  const book: SefariaBook = { title: index.title, heTitle: index.heTitle || index.title, categories: index.categories ?? [], authors: authorNames(index), units: [] };
  const seen = new Set<string>();
  for (const leaf of bookLeaves(index)) {
    const versions = new Map<'he' | 'en', SefariaVersionText>();
    for (const language of ['he', 'en'] as const) {
      const found = await leafText(client, leaf, language);
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
 * (`crawl.json`, and each kept text as `texts/<sha256>.html`).
 */
export async function crawlSefaria(options: { out: string; exclude: Set<string>; client: SefariaClient; only?: string[]; log?: (line: string) => void }): Promise<SefariaCrawl> {
  const log = options.log ?? (() => {});
  const titles = options.only ?? chabadTitles(await options.client.toc()).map((t) => t.title);
  const wanted = titles.filter((t) => !options.exclude.has(t) && ![...options.exclude].some((e) => t.endsWith(` on ${e}`)));
  log(`${titles.length} Chabad books on Sefaria; ${wanted.length} not published by Sichos-Kodesh`);
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
      const genres = new Set(crawl.books.map(sefariaGenre));
      for (const genre of [...genres].sort()) yield { key: `rebbehub-set:${genre}`, type: 'set', path: `/sets/${genre}`, data: { name: GENRE_NAMES[genre], slug: genre, policy: 'moderated', keepers: [] } };
      for (const book of crawl.books) {
        if (!book.units.length) continue;
        const slug = bookSlug(book.title);
        const workKey = `sefaria-work:${book.title}`;
        const genre = sefariaGenre(book);
        const bookAuthors = [...new Set(book.authors.map(sefariaAuthor).filter((a): a is string => a !== null && authors.has(a)))];
        const versions = new Map<string, SefariaText>();
        for (const u of book.units) for (const t of u.texts) versions.set(`${t.language}\u0000${t.version}`, t);
        const levels = [...new Set(book.units[0]!.position.map((p) => p.level))];
        yield {
          key: workKey,
          type: 'work',
          path: `/sefaria/${slug}`,
          data: {
            title: { he: book.heTitle.slice(0, 500), en: book.title.slice(0, 500) },
            slug: `sefaria-${slug}`.slice(0, 100).replace(/-+$/, ''),
            authors: bookAuthors.map((a) => ref(`sichos-kodesh-author:${a}`)),
            genre,
            levels,
            sets: [ref(`rebbehub-set:${genre}`), ref(SEFARIA_SET.key)],
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
            key: `sefaria-unit:${book.title}/${unit.id}`,
            type: 'unit',
            path: joinPath('sefaria', slug, ...unit.position.map((p) => p.value)),
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
