import { describe, expect, it } from 'vitest';
import { chabadLibraryImporter, crawlChabadLibrary, type LibraryTree } from '@rebbehub/importers';

/** A little library: a work with two parts, the first with two pages, the second with one. */
const SITE: Record<number, { type: string; data: unknown }> = {
  300000000: { type: 'children', data: [{ id: 1, heading: 'חלק ראשון' }, { id: 2, heading: 'חלק שני' }] },
  1: { type: 'children', data: [{ id: 11, heading: 'א' }, { id: 12, heading: 'ב' }] },
  2: { type: 'children', data: [{ id: 21, heading: 'הוספות' }] },
  11: { type: 'page', data: { text: 'not kept' } },
  12: { type: 'page', data: { text: 'not kept' } },
  21: { type: 'page', data: { text: 'not kept' } },
};

const fakeFetch = (asked: number[]) =>
  (async (url: string) => {
    const id = Number(/path=\/(\d+)/.exec(url)![1]);
    asked.push(id);
    return new Response(JSON.stringify({ content: SITE[id] }));
  }) as unknown as typeof fetch;

describe('chabadlibrary.org', () => {
  it('crawls the contents only, and continues where it stopped', async () => {
    const tree: LibraryTree = { nodes: {} };
    const asked: number[] = [];
    expect(await crawlChabadLibrary([300000000], tree, { fetch: fakeFetch(asked), pauseMs: 0, concurrency: 1, deadline: Date.now() - 1 })).toBe(false);
    expect(asked).toEqual([]);
    expect(await crawlChabadLibrary([300000000], tree, { fetch: fakeFetch(asked), pauseMs: 0 })).toBe(true);
    expect(tree.nodes[11]).toEqual({ heading: 'א', parent: 1, kind: 'page' });
    expect(JSON.stringify(tree)).not.toContain('not kept');
    const again: number[] = [];
    await crawlChabadLibrary([300000000], tree, { fetch: fakeFetch(again), pauseMs: 0 });
    expect(again).toEqual([]); // everything known: nothing asked again
  });

  it('makes a page for every chapter, linking to it in the library', async () => {
    const tree: LibraryTree = { nodes: {} };
    await crawlChabadLibrary([300000000], tree, { fetch: fakeFetch([]), pauseMs: 0 });
    const index = {
      works: [
        { id: 'keser-shem-tov', levels: ['chelek', 'siman'], sources: [{ source: 'chabadlibrary', sourceId: '300000000', licence: 'unknown', kind: 'text' }] },
        { id: 'tanya', levels: ['chapter'], sources: [{ source: 'chabadlibrary', sourceId: '3400000000', licence: 'unknown', kind: 'text' }] },
      ],
    };
    const records = [];
    for await (const r of chabadLibraryImporter({ index, withContents: new Set(['tanya']), tree }).records()) records.push(r);
    expect(records.map((r) => r.path)).toEqual(['/keser-shem-tov/1/1', '/keser-shem-tov/1/2', '/keser-shem-tov/2/1']);
    expect(records[0]!.data).toMatchObject({
      label: { he: 'א' },
      position: [{ level: 'chelek', value: '1', label: { he: 'חלק ראשון' } }, { level: 'siman', value: '1' }],
      editions: [{ source: 'chabadlibrary', sourceId: '11', url: 'https://chabadlibrary.org/books/11' }],
    });
  });
});
