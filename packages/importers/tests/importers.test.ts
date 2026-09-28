import { existsSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Catalog } from '@rebbehub/core';
import { idForKey, readSichosKodeshWorks, runImport, sichosKodeshWorksImporter, type SichosKodeshWorksInput } from '@rebbehub/importers';
import { freshCatalog } from '../../core/tests/helpers.js';

/** A tiny stand-in for Sichos-Kodesh's data/works, in its format. */
const input = (): SichosKodeshWorksInput => ({
  index: {
    authors: [{ id: 'alter-rebbe', name: { he: 'אדמו״ר הזקן', en: 'The Alter Rebbe' }, rebbe: 1 }],
    works: [
      {
        id: 'tanya',
        title: { he: 'תניא', en: 'Tanya' },
        authors: ['alter-rebbe'],
        genre: 'chassidus',
        levels: ['part', 'chapter'],
        sources: [
          { source: 'sefaria', sourceId: 'Tanya', kind: 'text', language: 'he', licence: 'cc-by-nc', rights: 'ship-with-credit', credit: 'Sefaria' },
          { source: 'chabadlibrary', sourceId: '3400000000', kind: 'text', language: 'he', licence: 'free-to-read', rights: 'link-only' },
        ],
      },
    ],
  },
  contents: [
    {
      workId: 'tanya',
      contents: [{ title: { he: 'ליקוטי אמרים', en: 'Likkutei Amarim' }, entries: [{ unitId: 'la-1' }, { unitId: 'la-2' }] }],
      units: [
        { id: 'la-1', label: 'ליקוטי אמרים, פרק א׳', labelEn: 'Likkutei Amarim, chapter 1', ref: 'Tanya, Part I; Likkutei Amarim 1', editions: [{ source: 0 }] },
        { id: 'la-2', label: 'ליקוטי אמרים, פרק ב׳', editions: [{ source: 0 }, { source: 1 }] },
      ],
    },
  ],
});

let catalog: Catalog;
beforeEach(async () => {
  ({ catalog } = await freshCatalog());
});

describe('runImport', () => {
  it('seeds sets, authors, works and units, with stable ids and paths', async () => {
    const result = await runImport(catalog, sichosKodeshWorksImporter(input()), { approveAs: 'shmuly' });
    expect(result).toMatchObject({ created: 5, updated: 0, unchanged: 0 });
    const tanya = await catalog.resolvePath('/tanya');
    expect(tanya?.id).toBe(await idForKey('sichos-kodesh-work:tanya'));
    const unit = await catalog.get((await catalog.resolvePath('/tanya/1/2'))!.id);
    expect(unit!.data).toMatchObject({
      work: tanya!.id,
      label: { he: 'ליקוטי אמרים, פרק ב׳' },
      position: [{ level: 'part', value: '1', label: { he: 'ליקוטי אמרים', en: 'Likkutei Amarim' } }, { level: 'chapter', value: '2' }],
      externalIds: { 'sichos-kodesh-unit': 'la-2' },
      editions: [
        { source: 'sefaria', sourceId: 'la-2', licence: 'cc-by-nc', credit: 'Sefaria' },
        { source: 'chabadlibrary', sourceId: 'la-2', licence: 'free-to-read' },
      ],
    });
    expect((await catalog.history(tanya!.id))[0]!.author).toBe('bot:sichos-kodesh-works');
  });

  it('changes nothing when run again on the same source', async () => {
    await runImport(catalog, sichosKodeshWorksImporter(input()), { approveAs: 'shmuly' });
    const head = await catalog.head();
    const again = await runImport(catalog, sichosKodeshWorksImporter(input()), { approveAs: 'shmuly' });
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 5, changesets: [] });
    expect(await catalog.head()).toBe(head);
  });

  it('keeps what people fixed when the source changes', async () => {
    await runImport(catalog, sichosKodeshWorksImporter(input()), { approveAs: 'shmuly' });
    const tanya = await idForKey('sichos-kodesh-work:tanya');
    const work = (await catalog.get(tanya))!;
    const fix = await catalog.createChangeset('mendy', { title: 'Better English title' });
    await catalog.putRevision(fix.id, 'mendy', { id: tanya, type: 'work', data: { ...(work.data as object), title: { he: 'תניא', en: 'Tanya (Likkutei Amarim)' } } });
    await catalog.submit(fix.id, 'mendy');
    await catalog.merge(fix.id, 'shmuly');

    const changed = input();
    changed.index.works[0]!.title = { he: 'ספר התניא', en: 'The Tanya' };
    const result = await runImport(catalog, sichosKodeshWorksImporter(changed), { approveAs: 'shmuly' });
    expect(result).toMatchObject({ updated: 1, keptHumanEdits: 1 });
    expect((await catalog.get(tanya))!.data).toMatchObject({ title: { he: 'ספר התניא', en: 'Tanya (Likkutei Amarim)' } });
  });

  it('leaves its suggestions for review when no one approves them, and never merges them itself', async () => {
    const result = await runImport(catalog, sichosKodeshWorksImporter(input()));
    expect(result.changesets).toHaveLength(1);
    const cs = await catalog.changeset(result.changesets[0]!);
    expect(cs.status).toBe('open');
    expect(cs.kind).toBe('import');
    expect(cs.checks.filter((c) => c.status === 'fail')).toEqual([]);
    await expect(catalog.merge(cs.id, 'bot:sichos-kodesh-works')).rejects.toThrow('bots never approve');
  });

  it('reports what it would do without writing', async () => {
    const head = await catalog.head();
    const result = await runImport(catalog, sichosKodeshWorksImporter(input()), { dryRun: true });
    expect(result).toMatchObject({ created: 5, changesets: [] });
    expect(await catalog.head()).toBe(head);
  });
});

// Against a real Sichos-Kodesh checkout, when one is given: every work it knows must import cleanly.
const checkout = process.env.SICHOS_KODESH_DIR;
describe.skipIf(!checkout || !existsSync(checkout))('a Sichos-Kodesh checkout', () => {
  it('imports every work and unit without a failed check', async () => {
    const data = await readSichosKodeshWorks(checkout!);
    const result = await runImport(catalog, sichosKodeshWorksImporter(data), { approveAs: 'shmuly', chunkSize: 2000 });
    const units = data.contents.reduce((n, c) => n + c.units.length, 0);
    expect(result.created).toBeGreaterThan(data.index.works.length + units * 0.99);
    expect(await catalog.resolvePath('/likkutei-sichos')).not.toBeNull();
  }, 600_000);
});
