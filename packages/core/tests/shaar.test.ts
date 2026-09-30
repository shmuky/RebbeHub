import { beforeEach, describe, expect, it } from 'vitest';
import { CatalogError, fillShaars, shaarFile, suggestShaar, type Catalog } from '@rebbehub/core';
import type { EntityId, WorkData } from '@rebbehub/model';
import { add, freshCatalog } from './helpers.js';

/** A sefer's shaar through the catalog: the file, a person's shaar for review, and one made from the catalog for every sefer. */
describe('a sefer’s shaar', () => {
  let catalog: Catalog;
  let set: EntityId;
  let rebbe: EntityId;
  let sefer: EntityId;

  beforeEach(async () => {
    ({ catalog, set } = await freshCatalog());
    rebbe = await add(catalog, 'shmuly', 'shmuly', 'author', { name: { he: 'כ"ק אדמו"ר', en: 'The Rebbe' }, kind: 'rebbe', rebbe: 7 });
    sefer = await add(catalog, 'shmuly', 'shmuly', 'work', { title: { he: 'ליקוטי שיחות', en: 'Likkutei Sichos' }, slug: 'likkutei-sichos', authors: [rebbe], genre: 'sichos', levels: ['volume', 'sicha'], description: { he: 'שיחות מוגהות' }, sets: [set] });
  });

  const work = async (id: EntityId) => (await catalog.get(id))!.data as unknown as WorkData;

  it('reads, for a sefer with none yet, as the catalog makes it, and says so', async () => {
    const file = await shaarFile(catalog, sefer);
    expect(file.machine).toBe(true);
    expect(file.text).toContain(`by: ${rebbe} (כ"ק אדמו"ר)`);
    expect(file.text).toContain('## על הספר | About\n\nשיחות מוגהות');
    expect(file.text).toContain('הספר מחולק לכרכים, וכל כרך לשיחות.');
  });

  it("takes a person's shaar for review, and it is theirs: no longer the catalog's", async () => {
    const { text } = await shaarFile(catalog, sefer);
    const edited = text.replace('genre: sichos', 'subtitle: כרך א-לט\ngenre: sichos') + '\n## הערות | Notes\n\nבדוק.\n';
    const made = await suggestShaar(catalog, 'mendy', { entity: sefer, text: edited, before: text });
    await catalog.merge(made.id, 'keeper');
    const after = await work(sefer);
    expect(after.shaar).toEqual({ subtitle: { he: 'כרך א-לט' }, sections: { about: 'שיחות מוגהות', structure: 'הספר מחולק לכרכים, וכל כרך לשיחות.', notes: 'בדוק.' } });
    expect((await shaarFile(catalog, sefer)).machine).toBe(false);
  });

  it('refuses a file it cannot read, naming each line, and one changed since it was opened', async () => {
    const { text } = await shaarFile(catalog, sefer);
    const bad = await suggestShaar(catalog, 'mendy', { entity: sefer, text: text.replace('genre: sichos', 'genre: poetry') }).catch((e: CatalogError) => e);
    expect(bad).toBeInstanceOf(CatalogError);
    expect((bad as CatalogError).code).toBe('invalid');
    expect((bad as CatalogError).detail).toMatchObject({ problems: [{ line: 6 }] });
    await expect(suggestShaar(catalog, 'mendy', { entity: sefer, text, before: text.replace('ליקוטי', 'לקוטי') })).rejects.toMatchObject({ code: 'conflict' });
    await expect(suggestShaar(catalog, 'mendy', { entity: sefer, text: text.replace(rebbe, 'rh-0000zzzz') })).rejects.toMatchObject({ code: 'invalid' });
    await expect(suggestShaar(catalog, 'mendy', { entity: set, text })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('gives every sefer without one a shaar made from the catalog, once', async () => {
    const recordings = await add(catalog, 'shmuly', 'shmuly', 'work', { title: { he: 'הקלטות' }, slug: 'recordings', authors: [], genre: 'recordings', levels: [], sets: [set] });
    expect(await fillShaars(catalog, { dryRun: true })).toBe(1);
    expect((await work(sefer)).shaar).toBeUndefined();
    expect(await fillShaars(catalog, { batch: 1 })).toBe(1);
    expect((await work(sefer)).shaar).toMatchObject({ sections: { about: 'שיחות מוגהות' }, origin: { by: 'catalog', checked: false } });
    expect((await work(recordings)).shaar).toBeUndefined();
    expect(await fillShaars(catalog)).toBe(0);
  });
});
