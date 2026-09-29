import { describe, expect, it } from 'vitest';
import { CatalogError, sitemapChunks, sitemapPage } from '@rebbehub/core';
import { add, freshCatalog, yudShvat } from './helpers.js';

/**
 * Sitemaps: every item with a page, in pages of a bounded size, each with
 * when it last changed; items without a page of their own are not listed.
 * Tested with pages of two, so paging is seen without thousands of items.
 */
describe('sitemaps', () => {
  it('cuts each kind of item with a page into pages in id order, with when each page and each item last changed', async () => {
    const { catalog, set } = await freshCatalog();
    const events = [];
    for (let day = 10; day < 15; day++) events.push(await add(catalog, 'mendy', 'keeper', 'event', { ...yudShvat(set), date: `5742-05-${day}` }, `/events/5742-05-${day}`));
    const author = await add(catalog, 'shmuly', 'shmuly', 'author', { name: { he: 'הרבי', en: 'The Rebbe' }, kind: 'rebbe', rebbe: 7, sets: [set] }, '/authors/the-rebbe');
    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'ספר', en: 'Sefer' }, slug: 'sefer', authors: [author], genre: 'sichos', levels: ['sicha'], sets: [set] }, '/sefer');

    const chunks = await sitemapChunks(catalog.db, { size: 2 });
    const events_ = chunks.filter((c) => c.type === 'event');
    expect(events_.map((c) => [c.page, c.count])).toEqual([
      [1, 2],
      [2, 2],
      [3, 1],
    ]);
    expect(chunks.find((c) => c.type === 'work')).toMatchObject({ page: 1, count: 1 });
    expect(chunks.find((c) => c.type === 'set')).toMatchObject({ page: 1, count: 1 });
    expect(chunks.find((c) => c.type === 'author')).toMatchObject({ page: 1, count: 1 });
    // The catalog's own schemas are items too, but have no page worth finding.
    expect((await catalog.counts()).schema).toBeGreaterThan(0);
    expect(chunks.some((c) => c.type === 'schema')).toBe(false);
    for (const c of chunks) expect(c.lastmod).toMatch(/^\d{4}-\d\d-\d\dT/);

    const sorted = [...events].sort();
    const pages = await Promise.all([1, 2, 3].map((p) => sitemapPage(catalog.db, 'event', p, 2)));
    expect(pages.map((p) => p.map((i) => i.id))).toEqual([sorted.slice(0, 2), sorted.slice(2, 4), sorted.slice(4)]);
    expect(pages[0]![0]!.path).toMatch(/^\/events\/5742-05-1\d$/);
    expect(pages[0]![0]!.lastmod).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(await sitemapPage(catalog.db, 'event', 4, 2)).toEqual([]);
    expect((await sitemapPage(catalog.db, 'work', 1)).map((i) => i.id)).toEqual([work]);
    await expect(sitemapPage(catalog.db, 'segment', 1)).rejects.toBeInstanceOf(CatalogError);
  });
});
