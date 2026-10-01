import { beforeEach, describe, expect, it } from 'vitest';
import { additionOf, additionsByKind, additionsOf, applyOrganize, catalogTree, isOfficial, linkedPage, previewOrganize, seferOf, type Catalog } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';
import { add, freshCatalog } from './helpers.js';

/**
 * The catalog's tree is built of the official sefarim; every other book is
 * an addition to one (WorkData.addition). A shelf lists its official
 * sefarim only, a sefer's additions are found from it in one statement,
 * search puts a sefer named by the query first and an official sefer
 * before an addition, and organizing marks and unmarks additions as
 * suggestions like any other change.
 */

let catalog: Catalog;
let shelf: EntityId;
let tanya: EntityId;
let kadisha: EntityId;
let index: EntityId;
let loose: EntityId;

const work = (he: string, slug: string, extra: Record<string, unknown> = {}) => ({ title: { he, en: slug }, slug, authors: [], genre: 'chassidus', levels: ['chapter'], sets: [shelf], ...extra });

beforeEach(async () => {
  const fresh = await freshCatalog();
  catalog = fresh.catalog;
  shelf = await add(catalog, 'shmuly', 'shmuly', 'set', { name: { he: 'אדמו״ר הזקן' }, slug: 'alter-rebbe', policy: 'moderated', keepers: ['keeper'] }, '/sets/alter-rebbe');
  // The title as printed, with its niqqud: the search finds it by its plain letters.
  tanya = await add(catalog, 'mendy', 'keeper', 'work', work('תַּנְיָא', 'tanya', { title: { he: 'תַּנְיָא', en: 'Tanya' } }), '/tanya');
  kadisha = await add(catalog, 'mendy', 'keeper', 'work', work('תניא קדישא', 'tanya-kadisha'), '/tanya-kadisha');
  index = await add(catalog, 'mendy', 'keeper', 'work', work('תניא - מפתחות', 'tanya-index', { addition: { kind: 'index', to: tanya } }), '/tanya-index');
  loose = await add(catalog, 'mendy', 'keeper', 'work', work('ליקוט מאמרים', 'likkut', { addition: { kind: 'collection' } }), '/likkut');
  // Forty chapters that name it, more than a page of results.
  for (let n = 1; n <= 40; n++) await add(catalog, 'mendy', 'keeper', 'unit', { work: tanya, position: [{ level: 'chapter', value: String(n) }], order: `a${String(n).padStart(2, '0')}`, label: { he: `תניא פרק ${n}` } });
});

describe('a shelf and its additions', () => {
  it('lists a shelf without the additions that belong on a sefer, and keeps those that belong to none', async () => {
    const all = (await catalog.list({ set: shelf, type: 'work' })).map((w) => w.id);
    expect(all).toEqual(expect.arrayContaining([tanya, kadisha, index, loose]));
    const onShelf = (await catalog.list({ set: shelf, type: 'work', shelf: true })).map((w) => w.id);
    expect(onShelf.sort()).toEqual([tanya, kadisha, loose].sort());
  });

  it('tells an official sefer from an addition, and finds the sefer each stands for', async () => {
    const [t, i, l] = (await Promise.all([tanya, index, loose].map((id) => catalog.get(id)))).map((v) => v!);
    expect([t!, i!, l!].map((v) => isOfficial(v))).toEqual([true, false, false]);
    expect(additionOf(i!)).toEqual({ kind: 'index', to: tanya });
    expect((await seferOf(catalog, t!))?.id).toBe(tanya);
    expect((await seferOf(catalog, i!))?.id).toBe(tanya);
    expect(await seferOf(catalog, l!)).toBeNull();
    expect((await additionsOf(catalog, tanya)).items.map((x) => x.id)).toEqual([index]);
    expect([...additionsByKind([i!, l!]).keys()]).toEqual(['index', 'collection']);
    // The same, as lists: only the official sefarim, only the additions, the additions to one sefer.
    expect((await catalog.list({ type: 'work', official: true })).map((w) => w.id).sort()).toEqual([tanya, kadisha].sort());
    expect((await catalog.list({ type: 'work', official: false })).map((w) => w.id).sort()).toEqual([index, loose].sort());
    expect((await catalog.list({ additionsOf: tanya })).map((w) => w.id)).toEqual([index]);
  });

  it("finds a sefer's additions in one statement, through addition.to", async () => {
    const page = await linkedPage(catalog.db, tanya, { field: 'addition.to', type: 'work' });
    expect(page.items.map((w) => w.id)).toEqual([index]);
    expect(page.total).toBe(1);
  });

  it('refuses an addition of no known kind, to itself, to another addition or to what is not a sefer', async () => {
    const failed = async (id: EntityId | undefined, data: Record<string, unknown>) => {
      const cs = await catalog.createChangeset('mendy', { title: 'Bad' });
      await catalog.putRevision(cs.id, 'mendy', { id, type: 'work', data: data as never });
      const sent = await catalog.submit(cs.id, 'mendy');
      return sent.checks.filter((c) => c.status === 'fail').map((c) => c.message).join('; ');
    };
    expect(await failed(undefined, work('x', 'x1', { addition: { kind: 'translation' } }))).toMatch(/addition/);
    expect(await failed(kadisha, work('תניא קדישא', 'tanya-kadisha', { addition: { kind: 'about', to: kadisha } }))).toMatch(/not an addition to itself/);
    expect(await failed(undefined, work('x', 'x2', { addition: { kind: 'about', to: index } }))).toMatch(/itself an addition/);
    expect(await failed(undefined, work('x', 'x3', { addition: { kind: 'about', to: shelf } }))).toMatch(/should be a work/);
  });
});

describe('search', () => {
  it("puts the sefer named by the query first, then those named starting with it, an official one before an addition, then what mentions it", async () => {
    const found = (await catalog.search('תניא', { limit: 5 })).map((r) => r.id);
    expect(found.slice(0, 3)).toEqual([tanya, kadisha, index]);
    expect(found).toHaveLength(5);
    expect((await catalog.search('tanya', { limit: 3 }))[0]!.id).toBe(tanya);
  });
});

describe('organizing additions', () => {
  it('marks a sefer as an addition to an official one, and makes it official again, each as a suggestion', async () => {
    const { suggestion, preview } = await applyOrganize(catalog, 'mendy', { operations: [{ op: 'addition', item: kadisha, to: tanya, kind: 'commentary' }] });
    expect(preview.summary).toEqual(['Mark תניא קדישא / tanya-kadisha as an addition (commentary) to תַּנְיָא / Tanya']);
    expect(preview.items.map((i) => i.changes.map((c) => c.path).join())).toEqual(['/addition']);
    await catalog.merge(suggestion.id, 'shmuly');
    expect((await catalog.get(kadisha))!.data).toMatchObject({ addition: { kind: 'commentary', to: tanya } });

    const back = await previewOrganize(catalog, { operations: [{ op: 'official', item: kadisha }] });
    expect(back.summary).toEqual(['Make תניא קדישא / tanya-kadisha an official sefer']);
    expect((back.revisions[0]!.data as Record<string, unknown>).addition).toBeUndefined();
  });

  it('hangs an addition only on an official sefer, never on itself, another addition or a set', async () => {
    await expect(previewOrganize(catalog, { operations: [{ op: 'addition', item: kadisha, to: index, kind: 'about' }] })).rejects.toThrow(/itself an addition/);
    await expect(previewOrganize(catalog, { operations: [{ op: 'addition', item: kadisha, to: kadisha, kind: 'about' }] })).rejects.toThrow(/not an addition to itself/);
    await expect(previewOrganize(catalog, { operations: [{ op: 'addition', item: kadisha, to: shelf, kind: 'about' }] })).rejects.toThrow(/belongs to a sefer/);
    await expect(previewOrganize(catalog, { operations: [{ op: 'addition', item: shelf, kind: 'about' }] })).rejects.toThrow(/only a sefer/);
    await expect(previewOrganize(catalog, { operations: [{ op: 'addition', item: kadisha, kind: 'translation' as never }] })).rejects.toThrow(/what kind/);
    await expect(previewOrganize(catalog, { operations: [{ op: 'official', item: tanya }] })).rejects.toThrow(/already an official sefer/);
    // Marking a sefer that has additions of its own says they now hang on an addition.
    const warned = await previewOrganize(catalog, { operations: [{ op: 'addition', item: tanya, kind: 'other' }] });
    expect(warned.warnings[0]).toMatch(/1 addition to .* now hang on an addition/);
  });

  it('keeps each side of a merge official or an addition as it was', async () => {
    const preview = await previewOrganize(catalog, { operations: [{ op: 'merge', from: index, into: kadisha }] });
    // The kept official sefer takes nothing of the addition's `addition`.
    const kept = preview.revisions.find((r) => r.id === kadisha)?.data as Record<string, unknown> | undefined;
    expect(kept?.addition).toBeUndefined();
    expect(preview.forwards).toEqual([{ from: index, to: kadisha }]);
  });

  it("shows the tree's official sefarim first, then the additions, each marked", async () => {
    const tree = await catalogTree(catalog, { root: shelf, depth: 1 });
    const works = tree.children.filter((n) => n.type === 'work');
    expect(works.slice(-2).map((n) => n.id).sort()).toEqual([index, loose].sort());
    expect(works.find((n) => n.id === index)!.addition).toEqual({ kind: 'index', to: tanya });
    expect(works.find((n) => n.id === tanya)!.addition).toBeUndefined();
  });
});
