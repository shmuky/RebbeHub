import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { joinPath, orderKeys, type LocalName } from '@rebbehub/model';
import { ref, type ImportRecord, type Importer } from './importer.js';
import { workPath } from './sichosKodeshWorks.js';

/**
 * The seforim of chabadlibrary.org (ספריית ליובאוויטש), a page on RebbeHub
 * for every chapter, letter and sicha, each linking to that exact page of
 * the library. Only the table of contents is kept - the titles and ids its
 * own API lists (`books/api/main?path=/<id>`), bibliographic facts - never
 * its text: Sichos-Kodesh's rights decision for the library is link-only.
 *
 * The contents are crawled politely, a few requests at a time, into a
 * file that later runs continue from (.github/workflows/import.yml keeps
 * it between runs), since the whole library is tens of thousands of pages.
 * The works themselves are Sichos-Kodesh's (its registry names each one's
 * id in the library); a work Sichos-Kodesh already has chapters for keeps
 * those.
 */

export const CHABAD_LIBRARY = 'https://chabadlibrary.org/books';

export interface LibraryNode {
  heading: string;
  parent: number;
  /** A section lists pages or more sections; a page is one text. Unset until the crawl reaches it. */
  kind?: 'section' | 'page';
  children?: number[];
}

/** The crawled contents, by id. */
export interface LibraryTree {
  nodes: Record<string, LibraryNode>;
}

interface ApiContent {
  type: string;
  data: Array<{ id: number; heading: string }> | unknown;
}

/**
 * Crawls the contents under `roots` into `tree`, continuing where an
 * earlier crawl stopped, until everything is known or `deadline` (ms since
 * the epoch) passes. Returns whether everything under the roots is known.
 */
export async function crawlChabadLibrary(
  roots: number[],
  tree: LibraryTree,
  options: { fetch?: typeof fetch; concurrency?: number; pauseMs?: number; deadline?: number; log?: (line: string) => void; save?: (tree: LibraryTree) => Promise<void> } = {},
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
    if (node?.kind === 'page') return;
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
}

/** The works that are in the library, with their ids there. */
export function libraryWorks(index: WorksIndex, withContents: Set<string>): Array<{ work: WorksIndex['works'][number]; root: number; licence: string }> {
  return index.works.flatMap((work) => {
    if (withContents.has(work.id)) return [];
    const source = work.sources.find((s) => s.source === 'chabadlibrary' && /^\d+$/.test(s.sourceId));
    return source ? [{ work, root: Number(source.sourceId), licence: source.licence }] : [];
  });
}

/** Reads the registry from a Sichos-Kodesh checkout, and the crawled contents from `treeFile`. */
export async function readChabadLibrary(root: string, treeFile: string): Promise<ChabadLibraryInput> {
  const dir = root.endsWith('works') ? root : join(root, 'apps/mobile/src/catalog/data/works');
  const index = JSON.parse(await readFile(join(dir, 'works.json'), 'utf8')) as WorksIndex;
  const withContents = new Set((await readdir(join(dir, 'contents'))).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5)));
  const tree = JSON.parse(await readFile(treeFile, 'utf8')) as LibraryTree;
  return { index, withContents, tree };
}

export function chabadLibraryImporter(input: ChabadLibraryInput | (() => Promise<ChabadLibraryInput>)): Importer {
  return {
    id: 'chabadlibrary',
    bot: { id: 'bot:chabadlibrary', displayName: 'Chabad Library contents importer' },
    async *records(): AsyncIterable<ImportRecord> {
      const { index, withContents, tree } = typeof input === 'function' ? await input() : input;
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
          const heading = tree.nodes[id]!.heading || position.map((p) => p.value).join('.');
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
              editions: [{ source: 'chabadlibrary', sourceId: String(id), kind: 'text', licence, url: `${CHABAD_LIBRARY}/${id}` }],
            },
          };
        }
      }
    },
  };
}
