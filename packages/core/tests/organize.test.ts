import { beforeEach, describe, expect, it } from 'vitest';
import { applyOrganize, catalogTree, keysBetween, previewOrganize, rekey, type Catalog, type OrganizePlan } from '@rebbehub/core';
import { isOrderKey, type EntityId } from '@rebbehub/model';
import { add, freshCatalog } from './helpers.js';

/**
 * Organizing the catalog (organize.ts): every operation becomes one
 * suggestion, paths follow, old paths redirect, and the tree stays a tree.
 */

let catalog: Catalog;
let farbrengens: EntityId;
let sichos: EntityId;
let likkutei: EntityId;
let units: EntityId[];

const work = (slug: string, sets: EntityId[], extra: Record<string, unknown> = {}) => ({ title: { he: slug, en: slug }, slug, authors: [], genre: 'sichos', levels: ['sicha'], sets, ...extra });
const unit = (w: EntityId, n: number, order: string) => ({ work: w, position: [{ level: 'sicha', value: String(n) }], order, label: { he: `סיחה ${n}` } });
const set = (slug: string, extra: Record<string, unknown> = {}) => ({ name: { he: slug, en: slug }, slug, policy: 'moderated', keepers: ['keeper'], ...extra });

/** Sends a plan as `by` and has a steward approve it, returning the merged suggestion. */
async function organize(plan: OrganizePlan, by = 'mendy') {
  const { suggestion, preview } = await applyOrganize(catalog, by, plan);
  const now = await catalog.changeset(suggestion.id);
  if (now.status === 'open') await catalog.merge(suggestion.id, by === 'shmuly' ? 'shmuly' : 'shmuly');
  return { suggestion: await catalog.changeset(suggestion.id), preview };
}

const data = async (id: EntityId) => (await catalog.get(id))!.data as Record<string, any>;

beforeEach(async () => {
  const fresh = await freshCatalog();
  catalog = fresh.catalog;
  farbrengens = fresh.set;
  sichos = await add(catalog, 'shmuly', 'shmuly', 'set', set('sichos'), '/sets/sichos');
  likkutei = await add(catalog, 'mendy', 'keeper', 'work', work('likkutei-sichos', [sichos]), '/likkutei-sichos');
  units = [];
  for (const [n, order] of [[1, 'V'], [2, 'k'], [3, 'r']] as const) units.push(await add(catalog, 'mendy', 'keeper', 'unit', unit(likkutei, n, order), `/likkutei-sichos/${n}`));
});

describe('sort keys', () => {
  it('spaces keys between neighbours and re-keys as few items as it can', () => {
    const keys = keysBetween('V', 'k', 5);
    expect(keys).toHaveLength(5);
    expect([...keys].sort()).toEqual(keys);
    expect(keys.every((k) => k > 'V' && k < 'k' && isOrderKey(k))).toBe(true);
    // One item moved to the front: only it changes.
    const moved = rekey([
      { id: 'c', order: 'r' },
      { id: 'a', order: 'V' },
      { id: 'b', order: 'k' },
    ]);
    expect([...moved.keys()]).toEqual(['c']);
    expect(moved.get('c')! < 'V').toBe(true);
    // Items without keys, or sharing one, are given keys in place.
    const fixed = rekey([
      { id: 'a', order: 'V' },
      { id: 'b', order: 'V' },
      { id: 'c', order: null },
    ]);
    expect(fixed.size).toBe(2);
    const final = ['a', 'b', 'c'].map((id) => fixed.get(id) ?? 'V');
    expect(final.every((k, i) => i === 0 || k > final[i - 1]!)).toBe(true);
  });
});

describe('moving', () => {
  it('moves a sefer from one set into another as one suggestion, and adds and removes sets', async () => {
    const { suggestion, preview } = await organize({ operations: [{ op: 'move', items: [likkutei], from: sichos, to: farbrengens }] });
    expect(suggestion.status).toBe('merged');
    expect(preview.title).toMatch(/Move likkutei-sichos/);
    expect((await data(likkutei)).sets).toEqual([farbrengens]);
    await organize({ operations: [{ op: 'move', items: [likkutei], to: sichos }] });
    expect((await data(likkutei)).sets).toEqual([farbrengens, sichos]);
    await organize({ operations: [{ op: 'move', items: [likkutei], to: null, from: farbrengens }] });
    expect((await data(likkutei)).sets).toEqual([sichos]);
    await expect(previewOrganize(catalog, { operations: [{ op: 'move', items: [likkutei], to: null }] })).rejects.toThrow(/which set/);
  });

  it('moves sets under sets, never under their own descendants', async () => {
    const child = await add(catalog, 'shmuly', 'shmuly', 'set', set('child', { parent: sichos }), '/sets/child');
    await expect(previewOrganize(catalog, { operations: [{ op: 'move', items: [sichos], to: child }] })).rejects.toThrow(/inside it/);
    await expect(previewOrganize(catalog, { operations: [{ op: 'move', items: [sichos], to: sichos }] })).rejects.toThrow(/inside itself/);
    await organize({ operations: [{ op: 'move', items: [child], to: farbrengens }] }, 'shmuly');
    expect((await data(child)).parent).toBe(farbrengens);
    await organize({ operations: [{ op: 'move', items: [child], to: null }] }, 'shmuly');
    expect((await data(child)).parent).toBeUndefined();
  });

  it('refuses a move into the wrong kind of item', async () => {
    const event = await add(catalog, 'mendy', 'keeper', 'event', { kind: 'farbrengen', title: { he: 'יו״ד שבט' }, date: '5742-05-10', sets: [farbrengens] });
    await expect(previewOrganize(catalog, { operations: [{ op: 'move', items: [units[0]!], to: event }] })).rejects.toThrow(/cannot go into a event; it moves into a work/);
    await expect(previewOrganize(catalog, { operations: [{ op: 'move', items: [units[0]!], to: null }] })).rejects.toThrow(/always belongs to its work/);
    await expect(previewOrganize(catalog, { operations: [{ op: 'move', items: ['rh-zzzzzzzz'], to: sichos }] })).rejects.toThrow(/not found/);
  });

  it('moves sichos to another sefer: at its end, their paths along, the old ones redirecting', async () => {
    const other = await add(catalog, 'mendy', 'keeper', 'work', work('igros', [sichos]), '/igros');
    const last = await add(catalog, 'mendy', 'keeper', 'unit', unit(other, 1, 'V'), '/igros/1');
    const { preview } = await organize({ operations: [{ op: 'move', items: [units[1]!, units[2]!], to: other }] });
    expect(preview.items).toHaveLength(2);
    const moved = await catalog.get(units[1]!);
    expect(moved!.path).toBe('/igros/2');
    expect((moved!.data as any).work).toBe(other);
    expect((moved!.data as any).order > 'V').toBe(true);
    expect((await data(units[2]!)).order > (moved!.data as any).order).toBe(true);
    expect(await catalog.resolvePath('/likkutei-sichos/2')).toMatchObject({ id: units[1], redirected: true, path: '/igros/2' });
    // Into a place between siblings: before the first.
    await organize({ operations: [{ op: 'move', items: [units[0]!], to: other, position: { before: last } }] });
    const children = await catalog.children(other, 'work', 'unit');
    expect(children.map((c) => c.id)).toEqual([units[0], last, units[1], units[2]]);
    // A path already taken there is not taken twice.
    expect((await catalog.get(units[0]!))!.path).toBe('/igros/1-2');
  });

  it('moves a sefer and a set up a level', async () => {
    const child = await add(catalog, 'shmuly', 'shmuly', 'set', set('child', { parent: sichos }), '/sets/child');
    const grandchild = await add(catalog, 'shmuly', 'shmuly', 'set', set('grandchild', { parent: child }), '/sets/grandchild');
    const deep = await add(catalog, 'mendy', 'keeper', 'work', work('deep', [child]), '/deep');
    await organize({ operations: [{ op: 'move-up', items: [deep] }] });
    expect((await data(deep)).sets).toEqual([sichos]);
    await organize({ operations: [{ op: 'move-up', items: [grandchild] }] }, 'shmuly');
    expect((await data(grandchild)).parent).toBe(sichos);
    await expect(previewOrganize(catalog, { operations: [{ op: 'move-up', items: [deep] }] })).rejects.toThrow(/top set/);
    await expect(previewOrganize(catalog, { operations: [{ op: 'move-up', items: [sichos] }] })).rejects.toThrow(/already at the top/);
    await expect(previewOrganize(catalog, { operations: [{ op: 'move-up', items: [units[0]!] }] })).rejects.toThrow(/sits in its work/);
  });
});

describe('renaming and ordering', () => {
  it('renames a sefer with a new path, moving its sichos\' paths along with redirects', async () => {
    const { preview } = await organize({ operations: [{ op: 'rename', item: likkutei, name: { he: 'לקוטי שיחות', en: 'Likkutei Sichos' }, slug: 'ls' }] });
    expect(preview.redirects.map((r) => [r.from, r.to])).toEqual(expect.arrayContaining([['/likkutei-sichos', '/ls'], ['/likkutei-sichos/1', '/ls/1'], ['/likkutei-sichos/3', '/ls/3']]));
    expect((await catalog.get(likkutei))).toMatchObject({ path: '/ls', data: { title: { he: 'לקוטי שיחות', en: 'Likkutei Sichos' }, slug: 'likkutei-sichos' } });
    expect((await catalog.get(units[2]!))!.path).toBe('/ls/3');
    expect(await catalog.resolvePath('/likkutei-sichos/3')).toMatchObject({ id: units[2], redirected: true });
    expect(await catalog.resolvePath('/likkutei-sichos')).toMatchObject({ id: likkutei, redirected: true });
    await expect(previewOrganize(catalog, { operations: [{ op: 'rename', item: likkutei, path: '/sets/sichos' }] })).rejects.toThrow(/taken/);
    await expect(previewOrganize(catalog, { operations: [{ op: 'rename', item: likkutei, slug: 'Not A Slug' }] })).rejects.toThrow(/slug/);
  });

  it('renames a set and its slug', async () => {
    await organize({ operations: [{ op: 'rename', item: sichos, name: { en: 'Talks' }, slug: 'talks' }] }, 'shmuly');
    expect(await catalog.get(sichos)).toMatchObject({ path: '/sets/talks', data: { slug: 'talks', name: { he: 'sichos', en: 'Talks' } } });
  });

  it('puts a whole list in a new order, changing as few items as it can', async () => {
    const { preview } = await organize({ operations: [{ op: 'reorder', items: [units[2]!, units[0]!, units[1]!] }] });
    expect(preview.items.map((i) => i.id)).toEqual([units[2]]);
    expect((await catalog.children(likkutei, 'work', 'unit')).map((c) => c.id)).toEqual([units[2], units[0], units[1]]);
    // Two swapped among the rest; and one to the end.
    await organize({ operations: [{ op: 'reorder', items: [units[1]!, units[0]!] }] });
    expect((await catalog.children(likkutei, 'work', 'unit')).map((c) => c.id)).toEqual([units[2], units[1], units[0]]);
    await organize({ operations: [{ op: 'reorder', items: [units[2]!], position: 'end' }] });
    expect((await catalog.children(likkutei, 'work', 'unit')).map((c) => c.id)).toEqual([units[1], units[0], units[2]]);
  });

  it('orders sefarim within a set, and sets under their parent', async () => {
    const b = await add(catalog, 'mendy', 'keeper', 'work', work('b', [sichos]), '/b');
    const c = await add(catalog, 'mendy', 'keeper', 'work', work('c', [sichos]), '/c');
    await organize({ operations: [{ op: 'reorder', items: [c, likkutei, b], parent: sichos }] });
    const tree = await catalogTree(catalog, { root: sichos, depth: 1 });
    expect(tree.children.map((n) => n.id)).toEqual([c, likkutei, b]);
    await expect(previewOrganize(catalog, { operations: [{ op: 'reorder', items: [c, units[0]!] }] })).rejects.toThrow(/not beside/);
  });
});

describe('sets', () => {
  it('makes a set with items in one suggestion, and removes it only once empty', async () => {
    const { preview } = await organize({ operations: [{ op: 'create-set', key: 'ls', name: { he: 'לקוטי שיחות' }, slug: 'ls-set', parent: sichos, items: [likkutei] }] }, 'shmuly');
    const made = preview.created.ls!;
    expect(await catalog.get(made)).toMatchObject({ path: '/sets/ls-set', data: { parent: sichos, keepers: ['keeper'], policy: 'moderated' } });
    expect((await data(likkutei)).sets).toEqual([sichos, made]);
    await expect(previewOrganize(catalog, { operations: [{ op: 'delete-set', item: made }] })).rejects.toThrow(/still holds 1 item/);
    // Emptied and removed in the same plan; its path leads to its parent.
    await organize({ operations: [{ op: 'move', items: [likkutei], from: made, to: null }, { op: 'delete-set', item: made }] }, 'shmuly');
    expect(await catalog.get(made)).toBeNull();
    expect(await catalog.resolvePath('/sets/ls-set')).toMatchObject({ id: sichos, redirected: true });
    // A new set referred to by its key later in the plan.
    const later = await previewOrganize(catalog, { operations: [{ op: 'create-set', key: 'x', name: { he: 'x' }, slug: 'x' }, { op: 'move', items: [likkutei], to: 'new:x' }] });
    expect(later.items.map((i) => i.id)).toContain(likkutei);
    await expect(previewOrganize(catalog, { operations: [{ op: 'move', items: [likkutei], to: 'new:nope' }] })).rejects.toThrow(/no set made earlier/);
  });
});

describe('merging and splitting', () => {
  it('merges a duplicate sefer: its sichos move over, lists are joined, its path leads to the one kept', async () => {
    const otzros = await add(catalog, 'shmuly', 'shmuly', 'set', set('otzros'), '/sets/otzros');
    const dup = await add(catalog, 'mendy', 'shmuly', 'work', work('ls-otzros', [otzros], { externalIds: { otzros: '17' }, description: { he: 'מאוצרות' } }), '/otzros/ls');
    const dupUnit = await add(catalog, 'mendy', 'shmuly', 'unit', unit(dup, 4, 'V'), '/otzros/ls/4');
    const publication = await add(catalog, 'mendy', 'shmuly', 'publication', { kind: 'book-volume', title: { he: 'כרך' }, work: dup });
    const { preview, suggestion } = await organize({ operations: [{ op: 'merge', from: dup, into: likkutei }] }, 'shmuly');
    expect(suggestion.status).toBe('merged');
    expect(preview.forwards).toEqual([{ from: dup, to: likkutei }]);
    expect(await catalog.get(dup)).toBeNull();
    expect(await data(likkutei)).toMatchObject({ sets: [sichos, otzros], externalIds: { otzros: '17' }, description: { he: 'מאוצרות' } });
    expect(await catalog.get(dupUnit)).toMatchObject({ path: '/likkutei-sichos/4', data: { work: likkutei } });
    expect((await catalog.children(likkutei, 'work', 'unit')).map((c) => c.id)).toEqual([...units, dupUnit]);
    expect((await data(publication)).work).toBe(likkutei);
    expect(await catalog.resolvePath('/otzros/ls')).toMatchObject({ id: likkutei, redirected: true });
    expect(await catalog.resolvePath('/otzros/ls/4')).toMatchObject({ id: dupUnit, redirected: true });
    expect(await catalog.forwardOf(dup)).toBe(likkutei);
    await expect(previewOrganize(catalog, { operations: [{ op: 'merge', from: units[0]!, into: likkutei }] })).rejects.toThrow(/only items of one type/);
  });

  it('merges sets, never into their own descendants', async () => {
    const child = await add(catalog, 'shmuly', 'shmuly', 'set', set('child', { parent: sichos }), '/sets/child');
    await expect(previewOrganize(catalog, { operations: [{ op: 'merge', from: sichos, into: child }] })).rejects.toThrow(/inside/);
    await organize({ operations: [{ op: 'merge', from: sichos, into: farbrengens }] }, 'shmuly');
    expect((await data(child)).parent).toBe(farbrengens);
    expect((await data(likkutei)).sets).toEqual([farbrengens]);
  });

  it('splits a range of a sefer\'s units into a new sefer', async () => {
    const { preview } = await organize({ operations: [{ op: 'split', work: likkutei, range: { from: units[1]!, to: units[2]! }, title: { he: 'חלק ב' }, slug: 'ls-2' }] });
    const made = preview.items.find((i) => i.isNew)!;
    expect(made).toMatchObject({ type: 'work', path: '/ls-2' });
    expect(await catalog.get(units[2]!)).toMatchObject({ path: '/ls-2/3', data: { work: made.id } });
    expect((await data(units[0]!)).work).toBe(likkutei);
  });
});

describe('plans', () => {
  it('previews without saving, and makes one suggestion of many items', async () => {
    const head = await catalog.head();
    const before = await catalog.listChangesets({});
    const preview = await previewOrganize(catalog, { title: 'Tidy', operations: [{ op: 'rename', item: likkutei, name: { en: 'LS' } }, { op: 'move', items: units, to: likkutei, position: 'start' }] });
    expect(preview.title).toBe('Tidy');
    expect(preview.summary).toHaveLength(2);
    expect(await catalog.head()).toBe(head);
    expect(await catalog.listChangesets({})).toHaveLength(before.length);
    const other = await add(catalog, 'mendy', 'keeper', 'work', work('other', [sichos]), '/other');
    const { suggestion, preview: sent } = await applyOrganize(catalog, 'mendy', { operations: [{ op: 'move', items: units, to: other }, { op: 'rename', item: other, name: { en: 'Other' } }] });
    expect(sent.items).toHaveLength(4);
    expect(suggestion.status).toBe('open');
    expect((await catalog.proposals(suggestion.id)).length).toBe(4);
    // The keeper of the set approves it like any suggestion.
    await catalog.merge(suggestion.id, 'keeper');
    expect((await catalog.children(other, 'work', 'unit')).length).toBe(3);
    await expect(previewOrganize(catalog, { operations: [] })).rejects.toThrow(/at least one/);
    await expect(previewOrganize(catalog, { operations: [{ op: 'fly' } as never] })).rejects.toThrow(/unknown operation/);
  });

  it('draws the tree: top sets, the sets and sefarim in them, and how much each holds', async () => {
    await add(catalog, 'shmuly', 'shmuly', 'set', set('child', { parent: sichos }), '/sets/child');
    const top = await catalogTree(catalog, { depth: 1 });
    expect(top.children.map((n) => n.path).sort()).toEqual(['/farbrengens', '/sets/sichos']);
    const node = top.children.find((n) => n.id === sichos)!;
    expect(node.counts).toEqual({ sets: 1, items: 1 });
    const deep = await catalogTree(catalog, { root: sichos, depth: 2 });
    expect(deep.children.map((n) => n.type)).toEqual(['set', 'work']);
    expect(deep.children[1]).toMatchObject({ id: likkutei, counts: { units: 3 } });
    expect(deep.children[1]!.children).toHaveLength(3);
  });
});
