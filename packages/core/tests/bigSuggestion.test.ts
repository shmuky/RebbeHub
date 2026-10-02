import { beforeAll, describe, expect, it } from 'vitest';
import { Catalog, summarizeChanges, type ChangeEntry, type Json } from '@rebbehub/core';
import { measured, type Db } from '@rebbehub/db';
import type { EntityId } from '@rebbehub/model';
import { freshCatalog } from './helpers.js';

/**
 * A bot's Suggestion of 500 items (the relink bot's "Drive links in
 * place of the media proxy") read for review: a page of items at a time,
 * main's versions read in a few queries rather than a few per item, and
 * the items summed up by how they change.
 */

const PROXY = 'https://sichos-kodesh-media-proxy.shmuky.workers.dev/drive/';
const N = 500;

let catalog: Catalog;
let bulk: number;
const ids: EntityId[] = [];

/** Counts the queries a call makes. */
async function counting<T>(db: Db, run: () => Promise<T>): Promise<{ result: T; queries: number }> {
  const query = db.query.bind(db);
  let queries = 0;
  (db as { query: Db['query'] }).query = ((...args: Parameters<Db['query']>) => {
    queries++;
    return query(...args);
  }) as Db['query'];
  try {
    return { result: await run(), queries };
  } finally {
    (db as { query: Db['query'] }).query = query;
  }
}

beforeAll(async () => {
  const fresh = await freshCatalog();
  catalog = fresh.catalog;
  const event = (i: number, url: string) => ({ kind: 'farbrengen', title: { he: `התוועדות ${i}` }, date: '5742-05-10', sets: [fresh.set], links: [{ kind: 'mugah', label: { he: 'מוגה' }, url }] }) as unknown as Json;
  const setup = await catalog.createChangeset('mendy', { title: 'Farbrengens' });
  for (let i = 0; i < N; i++) ids.push(await catalog.putRevision(setup.id, 'mendy', { type: 'event', data: event(i, `${PROXY}file${i}`) }));
  await catalog.submit(setup.id, 'mendy');
  await catalog.merge(setup.id, 'keeper');
  await catalog.createAccount({ id: 'bot:relink-drive', displayName: 'Drive links (relink bot)', isBot: true });
  const cs = await catalog.createChangeset('bot:relink-drive', { title: `Drive links in place of the media proxy (1-${N})`, kind: 'import' });
  for (let i = 0; i < N; i++) await catalog.putRevision(cs.id, 'bot:relink-drive', { id: ids[i], type: 'event', data: event(i, `https://drive.google.com/file/d/drivefile${String(i).padStart(4, '0')}/view`) });
  await catalog.submit(cs.id, 'bot:relink-drive');
  bulk = cs.id;
}, 240_000);

describe("a bot's Suggestion of 500 items", () => {
  it('has no #number, and is open for review', async () => {
    const cs = await catalog.changeset(bulk);
    expect(cs.number).toBeNull();
    expect(cs.status).toBe('open');
    expect((await catalog.itemCounts([bulk])).get(bulk)).toBe(N);
  });

  it('is read a page at a time, with how many in all', async () => {
    const first = await catalog.review(bulk, { limit: 25 });
    expect(first.total).toBe(N);
    expect(first.offset).toBe(0);
    expect(first.entries).toHaveLength(25);
    const second = await catalog.review(bulk, { offset: 25, limit: 25 });
    expect(second.entries).toHaveLength(25);
    expect(second.entries[0]!.entityId).not.toBe(first.entries[0]!.entityId);
    const last = await catalog.review(bulk, { offset: N - 10, limit: 25 });
    expect(last.entries).toHaveLength(10);
    // Every item once, across the pages.
    const all = await catalog.review(bulk);
    expect(all.entries).toHaveLength(N);
    expect(new Set(all.entries.map((e) => e.entityId)).size).toBe(N);
    expect(all.entries.slice(25, 50).map((e) => e.entityId)).toEqual(second.entries.map((e) => e.entityId));
  });

  it("reads main's versions in a few queries, not a few per item, and quickly", async () => {
    const started = Date.now();
    const { result, queries } = await counting(catalog.db, () => catalog.review(bulk, { limit: 25 }));
    expect(queries).toBeLessThanOrEqual(6);
    expect(Date.now() - started).toBeLessThan(5_000);
    const entry = result.entries[0]!;
    expect(entry.conflicts).toEqual([]);
    expect(entry.changes).toHaveLength(1);
    expect(entry.changes[0]!.path).toBe('/links');
    expect(JSON.stringify(entry.before)).toContain(PROXY);
    expect(JSON.stringify(entry.after)).toContain('drive.google.com');
  });

  it('sums the 500 up as one change when asked: links on the media proxy became links on Drive', async () => {
    // A page alone is not compared whole: the summary comes only when asked for.
    expect((await catalog.review(bulk, { limit: 25 })).summary).toBeUndefined();
    const view = await catalog.review(bulk, { limit: 25, summary: true });
    expect(view.summary).toEqual([
      {
        type: 'event',
        kind: 'changed',
        count: N,
        fields: [{ path: '/links', before: 'link:sichos-kodesh-media-proxy.shmuky.workers.dev', after: 'link:drive.google.com' }],
        examples: view.summary![0]!.examples,
      },
    ]);
    expect(view.summary![0]!.examples).toHaveLength(3);
  });

  it('asks whether a keeper may approve it in a few queries too', async () => {
    const { result, queries } = await counting(catalog.db, () => catalog.mayApprove(bulk, 'keeper'));
    expect(result).toEqual({ ok: true });
    expect(queries).toBeLessThan(20);
  });

  it("asks whether a steward may approve it without reading its items at all", async () => {
    const { result, queries } = await counting(catalog.db, () => catalog.mayApprove(bulk, 'shmuly'));
    expect(result).toEqual({ ok: true });
    expect(queries).toBeLessThanOrEqual(2);
  });

  it('still finds clashes where main has moved on since', async () => {
    const cs = await catalog.createChangeset('chaim', { title: 'A new title' });
    const main = await catalog.get(ids[0]!);
    await catalog.putRevision(cs.id, 'chaim', { id: ids[0], type: 'event', data: { ...(main!.data as object), links: [] } as Json });
    await catalog.submit(cs.id, 'chaim');
    await catalog.merge(cs.id, 'keeper');
    const view = await catalog.review(bulk, { limit: 1 });
    const moved = (await catalog.review(bulk)).entries.find((e) => e.entityId === ids[0])!;
    expect(moved.conflicts.length).toBeGreaterThan(0);
    expect(view.total).toBe(N);
  });

  it('lands in a few dozen queries, not a few per item, with every link and Drive file recorded', async () => {
    // Counted with the transaction's statements, which a plain count of db.query misses.
    const cost = { statements: 0, ms: 0 };
    const result = await new Catalog(measured(catalog.db, cost)).merge(bulk, 'keeper', { '*': { '*': { take: 'theirs' } } });
    expect(result.commit).not.toBeNull();
    expect(cost.statements).toBeLessThan(60);
    expect((await catalog.changeset(bulk)).status).toBe('merged');
    const { rows } = await catalog.db.query<{ n: number }>('SELECT count(*)::int AS n FROM drive_file WHERE entity_id = ANY($1::text[])', [ids]);
    expect(rows[0]!.n).toBe(N);
    const refs = await catalog.db.query<{ n: number }>("SELECT count(*)::int AS n FROM entity_ref WHERE from_id = ANY($1::text[]) AND field = 'sets'", [ids]);
    expect(refs.rows[0]!.n).toBe(N);
    expect(JSON.stringify((await catalog.get(ids[1]!))!.data)).toContain('drive.google.com');
  });
});

describe('the summary of changes', () => {
  const entry = (id: string, before: Json | null, after: Json | null, changes: ChangeEntry['changes']): ChangeEntry => ({ entityId: id as EntityId, type: 'unit', before, after, changes, conflicts: [] });

  it('groups items changed the same way, and keeps apart those changed otherwise', () => {
    const groups = summarizeChanges([
      entry('rh-a', { label: 'a' }, { label: 'b' }, [{ path: '/label', before: 'a', after: 'b' }]),
      entry('rh-b', { label: 'c' }, { label: 'd' }, [{ path: '/label', before: 'c', after: 'd' }]),
      entry('rh-c', { date: null }, { date: '5742-05-10' }, [{ path: '/date', before: undefined, after: '5742-05-10' }]),
      entry('rh-d', null, { label: 'new' }, []),
    ]);
    expect(groups.map((g) => [g.kind, g.count, g.fields])).toEqual([
      ['changed', 2, [{ path: '/label', before: 'text', after: 'text' }]],
      ['changed', 1, [{ path: '/date', before: 'none', after: 'text' }]],
      ['new', 1, []],
    ]);
    expect(groups[0]!.examples).toEqual(['rh-a', 'rh-b']);
  });

  it("names a list's places alike, so the same field in different places groups", () => {
    const groups = summarizeChanges([
      entry('rh-a', {}, {}, [{ path: '/editions/0/url', before: 'https://a.test/1', after: 'https://b.test/1' }]),
      entry('rh-b', {}, {}, [{ path: '/editions/3/url', before: 'https://a.test/2', after: 'https://b.test/2' }]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.fields).toEqual([{ path: '/editions/*/url', before: 'link:a.test', after: 'link:b.test' }]);
  });
});
