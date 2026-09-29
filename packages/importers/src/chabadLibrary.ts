import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { joinPath, orderKeys, type LocalName, type PageText } from '@rebbehub/model';
import { htmlToPageVersion } from './htmlToPageText.js';
import { ref, type ImportRecord, type Importer } from './importer.js';
import { textUrl } from './sichosKodeshTexts.js';
import { workPath } from './sichosKodeshWorks.js';

/**
 * The seforim of chabadlibrary.org (ספריית ליובאוויטש), a page on RebbeHub
 * for every chapter, letter and sicha, with its words and a link to that
 * exact page of the library. The table of contents is the titles and ids
 * its own API lists (`books/api/main?path=/<id>`); a crawl with texts also
 * keeps each page's text, credited to the library (a steward's decision,
 * 2026-09-28: docs/rights.md), as `texts/<sha256>.html` beside the tree,
 * and in RebbeHub's own storage like Sefaria's texts.
 *
 * The contents are crawled politely, a few requests at a time, into a
 * file that later runs continue from (.github/workflows/import.yml keeps
 * it between runs), since the whole library is some 69,000 pages.
 * The works themselves are Sichos-Kodesh's (its registry names each one's
 * id in the library); a work Sichos-Kodesh already has chapters for keeps
 * those.
 */

export const CHABAD_LIBRARY = 'https://chabadlibrary.org/books';

/** How a page's words are credited (in English, "The Lubavitch Library"), with a link to the page at chabadlibrary.org. */
export const LIBRARY_CREDIT = 'ספריית ליובאוויטש';

export interface LibraryNode {
  heading: string;
  parent: number;
  /** A section lists pages or more sections; a page is one text. Unset until the crawl reaches it. */
  kind?: 'section' | 'page';
  children?: number[];
  /** A page's text, kept as `texts/<sha256>.html` beside the tree; unset until a crawl with texts reads it. */
  sha256?: string;
  /** The form that text was kept in (`LIBRARY_TEXT_FORM`). */
  form?: number;
  /** Whether that text is in RebbeHub's own storage (`texts/<sha256>`), so the page can link to its copy. */
  kept?: boolean;
}

/** The crawled contents, by id. */
export interface LibraryTree {
  nodes: Record<string, LibraryNode>;
}

interface ApiContent {
  type: string;
  data: Array<{ id: number; heading: string }> | { text?: string; haoros?: string } | unknown;
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Marks the library writes in square brackets, around words, that mean bold or small. */
const PAIRS: Array<[RegExp, string]> = [
  [/\[(cup|dibur_maschil|mudgash)\]([\s\S]*?)\[\/\1\]/g, '<b>$2</b>'],
  [/\[headingintext_begin\]([\s\S]*?)\[headingintext_end\]/g, '<b>$1</b>'],
  [/\[(small|smallitalic)_begin\]([\s\S]*?)\[\1_end\]/g, '<small>$2</small>'],
];

/** A note's marker in the words (`[ftnref_3_1]`) and where the note itself begins (`[ftn_3_1]`), footnotes and endnotes alike. */
const NOTE_REF = /\[(ftnref|ednref|ednrefm)_([^_\]]*)_([^\]]*)\]/g;
const NOTE_START = /\[(ftn|edn)_([^_\]]*)_([^\]]*)\]/g;
const noteKey = (kind: string, group: string, label: string) => `${kind.startsWith('edn') ? 'edn' : 'ftn'}:${group}:${label}`;
/** Where a note begins, while the text is being read: its id between two control characters. */
const START = /\u0001([^\u0002]*)\u0002/;
const P_BLOCK = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
const hasWords = (html: string) => /\S/.test(html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' '));

/** The notes of one page: each gets an id (`n1`, `n2`, in the order they are met), its marker and its words. */
class PageNotes {
  private ids = new Map<string, { id: string; label: string }>();
  readonly started = new Set<string>();
  readonly notes: Array<{ id: string; label: string; html: string }> = [];
  constructor(texts: string[]) {
    for (const text of texts) for (const m of text.matchAll(NOTE_START)) this.started.add(noteKey(m[1]!, m[2]!, m[3]!));
  }
  of(key: string, label: string) {
    let found = this.ids.get(key);
    if (!found) this.ids.set(key, (found = { id: `n${this.ids.size + 1}`, label: label.trim() || String(this.ids.size + 1) }));
    return found;
  }
  label(id: string) {
    for (const note of this.ids.values()) if (note.id === id) return note.label;
    return '';
  }
}

/**
 * One text of the library as the HTML RebbeHub reads (htmlToPageText.ts):
 * its own marks in square brackets read for what they mean, a note's
 * beginning left as a place for `withNotes` to take the note from.
 */
function readMarks(text: string, notes: PageNotes): string {
  let html = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?xml[^>]*>|<\/?(o|w|v):[^>]*>/gi, '');
  for (const [pattern, to] of PAIRS) html = html.replace(pattern, to);
  html = html
    .replace(NOTE_REF, (_, kind: string, group: string, label: string) => {
      const key = noteKey(kind, group, label);
      // A marker whose note the page does not have stays its number, raised.
      if (!notes.started.has(key)) return `<sup>${escapeHtml(label)}</sup>`;
      const note = notes.of(key, label);
      return `<sup class="fn"><a href="#${note.id}">${escapeHtml(note.label)}</a></sup>`;
    })
    .replace(NOTE_START, (_, kind: string, group: string, label: string) => `\u0001${notes.of(noteKey(kind, group, label), label).id}\u0002`)
    .replace(/\[mafteach_gopage [^\]]*gopage="([^"]*)"[^\]]*\]/g, "עמ' $1")
    .replace(/\[mafteach_goterm [^\]]*goterm="([^"]*)"[^\]]*\]/g, '$1')
    .replace(/\[mrzlg_([^\]]*)\]/g, '$1')
    .replace(/\[oldpage_([^\]]*)\]/g, (_, page: string) => `<span class="mark">עמ' ${escapeHtml(page)}</span>`)
    .replace(/\[\/?[a-z][a-z0-9_]*(?:\s[^\]]*)?\]/gi, (mark) => (/[\u0590-\u05ff]/.test(mark) ? mark : ''));
  // A text of plain lines: each line a paragraph.
  if (!/<(p|div|br)\b/i.test(html)) {
    html = html
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => (/^<(h[1-6]|p|div|table|ul|ol)\b/i.test(line) ? line : `<p>${line}</p>`))
      .join('\n');
  }
  // A note begins a paragraph of its own.
  return html.replace(/(\u0001[^\u0002]*\u0002)/g, '</p><p>$1').replace(/<p\b[^>]*>(\s|&nbsp;)*<\/p>/gi, '');
}

/**
 * Takes the notes out of a text's paragraphs: a paragraph that begins a
 * note becomes that note. In the haoros (`all`), a paragraph that begins
 * none goes on the note before it.
 */
function withNotes(html: string, notes: PageNotes, all = false): string {
  let last: { html: string } | null = null;
  const rest = html.replace(P_BLOCK, (whole, inner: string) => {
    const at = START.exec(inner);
    const before = at ? inner.slice(0, at.index) : '';
    if (at && !hasWords(before)) {
      // Its words, without the `)` or `.` the library writes after a note's number.
      const words = inner.slice(at.index + at[0].length).replace(/^((?:\s|<\/[a-z][^>]*>)*)[).]\s*/i, '$1');
      const note = { id: at[1]!, label: notes.label(at[1]!), html: before + words };
      notes.notes.push(note);
      last = all ? note : null;
      return '';
    }
    if (all && last && hasWords(inner)) {
      last.html += `<br>${inner}`;
      return '';
    }
    return whole;
  });
  // A note's beginning that is not a paragraph's: its number, as the library shows it.
  return rest.replace(new RegExp(START.source, 'g'), (_, id: string) => `${escapeHtml(notes.label(id))} `);
}

/**
 * A page's text as the library stores it - HTML, or plain lines, with its
 * own marks in square brackets (`[ftnref_3_1]` a note's marker, `[ftn_3_1]`
 * where that note begins, `[cup]` an opening word, `[mafteach_gopage
 * file="ls30" gopage="240"]` a page an index points to, `[oldpage_לח]`
 * where a page of the printed edition begins) - and its haoros, as the
 * HTML form Sichos-Kodesh's texts are in (htmlToPageText.ts): notes in an
 * `<aside class="notes">`, each pointed to from its marker, old pages as
 * markers. Marks it has no meaning for are dropped and their words kept;
 * Hebrew in square brackets is the text's own.
 */
export function libraryHtml(text: string, haoros?: string): string {
  const notes = new PageNotes([text, haoros ?? '']);
  const words = withNotes(readMarks(text, notes), notes);
  const extra = haoros?.trim() ? withNotes(readMarks(haoros, notes), notes, true) : '';
  const aside = [hasWords(extra) ? extra : '', ...notes.notes.map((n) => `<p id="${n.id}"><a href="#r${n.id}">${escapeHtml(n.label)}</a> ${n.html.trim()}</p>`)].filter(Boolean);
  return aside.length ? `${words}\n<aside class="notes">\n${aside.join('\n')}\n</aside>` : words;
}

/**
 * The form of the texts a crawl keeps; a text kept in an older form is
 * read again. 2: notes, haoros and old pages in Sichos-Kodesh's form.
 */
export const LIBRARY_TEXT_FORM = 2;

/** A page of the library as the one HTML file RebbeHub keeps: its heading, text and notes, and where it is from. */
export function renderLibraryPage(page: { id: number; heading: string; text: string; haoros?: string }): string {
  const url = `${CHABAD_LIBRARY}/${page.id}`;
  return [
    `<article lang="he" dir="rtl" data-source="chabadlibrary">`,
    `<h1>${escapeHtml(page.heading)}</h1>`,
    libraryHtml(page.text, page.haoros),
    `<footer class="source"><span class="version">${escapeHtml(LIBRARY_CREDIT)}</span> <a href="${url}">${url}</a></footer>`,
    '</article>',
  ].join('\n');
}

/**
 * Crawls the contents under `roots` into `tree`, continuing where an
 * earlier crawl stopped, until everything is known or `deadline` (ms since
 * the epoch) passes. Returns whether everything under the roots is known.
 */
export async function crawlChabadLibrary(
  roots: number[],
  tree: LibraryTree,
  options: {
    fetch?: typeof fetch;
    concurrency?: number;
    pauseMs?: number;
    deadline?: number;
    log?: (line: string) => void;
    save?: (tree: LibraryTree) => Promise<void>;
    /** Keeps each page's text too (`renderLibraryPage`), by its sha256; a page read before without it, or kept in an older form, is read again. */
    texts?: (sha256: string, html: string) => Promise<void>;
  } = {},
): Promise<boolean> {
  const get = options.fetch ?? fetch;
  const read = async (id: number): Promise<ApiContent> => {
    for (let attempt = 1; ; attempt++) {
      try {
        const response = await get(`${CHABAD_LIBRARY}/api/main?path=/${id}`, { headers: { 'User-Agent': 'RebbeHubIndex/0.1 (+https://github.com/shmuky/RebbeHub; the contents only, to link each page)' } });
        if (!response.ok) throw new Error(`answered ${response.status}`);
        return ((await response.json()) as { content: ApiContent }).content;
      } catch (error) {
        if (attempt >= 4) throw new Error(`chabadlibrary ${id}: ${error instanceof Error ? error.message : String(error)}`);
        await new Promise((r) => setTimeout(r, (options.pauseMs ?? 250) * 8 * attempt));
      }
    }
  };
  const queue: number[] = [...roots];
  let fetched = 0;
  let complete = true;
  const visit = async (id: number) => {
    const node = tree.nodes[id];
    if (node?.kind === 'page' && (!options.texts || (node.sha256 && node.form === LIBRARY_TEXT_FORM))) return;
    if (node?.kind === 'section' && node.children) {
      queue.push(...node.children);
      return;
    }
    const content = await read(id);
    fetched++;
    const here = (tree.nodes[id] ??= { heading: '', parent: 0 });
    if (content.type === 'children' && Array.isArray(content.data)) {
      here.kind = 'section';
      here.children = [];
      for (const child of content.data as Array<{ id: number; heading: string }>) {
        if (!Number.isSafeInteger(child.id)) continue;
        here.children.push(child.id);
        tree.nodes[child.id] ??= { heading: String(child.heading ?? '').trim(), parent: id };
        queue.push(child.id);
      }
    } else {
      here.kind = 'page';
      if (options.texts) {
        const data = (content.data ?? {}) as { text?: string; haoros?: string };
        const html = renderLibraryPage({ id, heading: here.heading, text: String(data.text ?? ''), haoros: data.haoros ? String(data.haoros) : undefined });
        const sha256 = createHash('sha256').update(html, 'utf8').digest('hex');
        await options.texts(sha256, html);
        if (here.sha256 !== sha256) delete here.kept;
        here.sha256 = sha256;
        here.form = LIBRARY_TEXT_FORM;
      }
    }
    if (fetched % 500 === 0) {
      options.log?.(`${fetched} contents pages read, ${queue.length} to go`);
      await options.save?.(tree);
    }
    await new Promise((r) => setTimeout(r, options.pauseMs ?? 250));
  };
  const workers = Array.from({ length: options.concurrency ?? 4 }, async () => {
    while (queue.length) {
      if (options.deadline && Date.now() > options.deadline) {
        complete = false;
        return;
      }
      await visit(queue.shift()!);
    }
  });
  await Promise.all(workers);
  await options.save?.(tree);
  options.log?.(`${fetched} contents pages read; ${complete ? 'all known' : 'more next run'}`);
  return complete;
}

/** Sichos-Kodesh's works registry, as far as this reads it. */
interface WorksIndex {
  works: Array<{ id: string; levels: string[]; sources: Array<{ source: string; sourceId: string; licence: string; kind: string }> }>;
}

export interface ChabadLibraryInput {
  index: WorksIndex;
  /** Works Sichos-Kodesh already has chapters for. */
  withContents: Set<string>;
  tree: LibraryTree;
  /** A kept text by its sha256 (`texts/<sha256>.html` beside the tree); without it the pages carry no words. */
  text?: (sha256: string) => Promise<string | null>;
  /** The API that keeps the texts; each page links to its copy there. */
  api?: string;
}

/** The works that are in the library, with their ids there. */
export function libraryWorks(index: WorksIndex, withContents: Set<string>): Array<{ work: WorksIndex['works'][number]; root: number; licence: string }> {
  return index.works.flatMap((work) => {
    if (withContents.has(work.id)) return [];
    const source = work.sources.find((s) => s.source === 'chabadlibrary' && /^\d+$/.test(s.sourceId));
    return source ? [{ work, root: Number(source.sourceId), licence: source.licence }] : [];
  });
}

/** Reads the registry from a Sichos-Kodesh checkout, and the crawled contents from `treeFile` (its texts beside it). */
export async function readChabadLibrary(root: string, treeFile: string, options: { api?: string } = {}): Promise<ChabadLibraryInput> {
  const dir = root.endsWith('works') ? root : join(root, 'apps/mobile/src/catalog/data/works');
  const index = JSON.parse(await readFile(join(dir, 'works.json'), 'utf8')) as WorksIndex;
  const withContents = new Set((await readdir(join(dir, 'contents'))).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)));
  const tree = JSON.parse(await readFile(treeFile, 'utf8')) as LibraryTree;
  const texts = join(treeFile, '..', 'texts');
  const text = async (sha256: string) => {
    const file = join(texts, `${sha256}.html`);
    return /^[0-9a-f]{64}$/.test(sha256) && existsSync(file) ? readFile(file, 'utf8') : null;
  };
  return { index, withContents, tree, text, api: options.api };
}

export function chabadLibraryImporter(input: ChabadLibraryInput | (() => Promise<ChabadLibraryInput>)): Importer {
  return {
    id: 'chabadlibrary',
    bot: { id: 'bot:chabadlibrary', displayName: 'Chabad Library contents importer' },
    async *records(): AsyncIterable<ImportRecord> {
      const { index, withContents, tree, text, api } = typeof input === 'function' ? await input() : input;
      for (const { work, root, licence } of libraryWorks(index, withContents)) {
        const placed: Array<{ id: number; position: Array<{ level: string; value: string; label?: LocalName }> }> = [];
        const walk = (id: number, trail: Array<{ level: string; value: string; label?: LocalName }>) => {
          const node = tree.nodes[id];
          node?.children?.forEach((childId, i) => {
            const child = tree.nodes[childId];
            if (!child?.kind) return; // not crawled yet
            const level = work.levels[trail.length] ?? (child.kind === 'section' ? 'part' : 'unit');
            if (child.kind === 'section') walk(childId, [...trail, { level, value: String(i + 1), label: { he: child.heading.slice(0, 500) } }]);
            else placed.push({ id: childId, position: [...trail, { level, value: String(i + 1) }] });
          });
        };
        walk(root, []);
        const orders = orderKeys(placed.length);
        for (const [i, { id, position }] of placed.entries()) {
          const node = tree.nodes[id]!;
          const heading = node.heading || position.map((p) => p.value).join('.');
          const url = `${CHABAD_LIBRARY}/${id}`;
          // The page's words, where the crawl kept them.
          const html = node.sha256 && text ? await text(node.sha256) : null;
          const version = html ? htmlToPageVersion(html, { id: 'he', language: 'he', links: true, credit: LIBRARY_CREDIT, licence, url }) : null;
          const words: PageText | null = version?.segments.length ? { profile: 'chabad-library', versions: [version] } : null;
          const body = words
            ? {
                body: words,
                bodySource: {
                  source: 'chabadlibrary',
                  via: 'chabadlibrary',
                  sourceId: String(id),
                  url,
                  ...(node.kept ? { copy: textUrl(node.sha256!, api) } : {}),
                  licence,
                  credit: LIBRARY_CREDIT,
                  rights: 'credit',
                },
              }
            : {};
          yield {
            key: `chabadlibrary-unit:${id}`,
            type: 'unit',
            path: joinPath(workPath(work.id).slice(1), ...position.map((p) => p.value)),
            data: {
              work: ref(`sichos-kodesh-work:${work.id}`),
              position,
              order: orders[i]!,
              label: { he: heading.slice(0, 500) },
              externalIds: { chabadlibrary: String(id) },
              ...body,
              editions: [{ source: 'chabadlibrary', sourceId: String(id), kind: 'text', licence, url, ...(words ? { credit: LIBRARY_CREDIT } : {}) }],
            },
          };
        }
      }
    },
  };
}
