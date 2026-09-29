import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type { Catalog } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';
import { createApp } from '../src/app.js';
import { add, freshCatalog } from '../../../packages/core/tests/helpers.js';

/** The organize routes (organize.ts): the tree, a preview that saves nothing, and one suggestion per plan. */

let app: Hono;
let catalog: Catalog;
let set: EntityId;
let sichos: EntityId;
let work: EntityId;

beforeEach(async () => {
  const fresh = await freshCatalog();
  catalog = fresh.catalog;
  set = fresh.set;
  sichos = await add(catalog, 'shmuly', 'shmuly', 'set', { name: { he: 'שיחות', en: 'Sichos' }, slug: 'sichos', policy: 'moderated', keepers: ['keeper'] }, '/sets/sichos');
  work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'חיבור', en: 'A work' }, slug: 'w', authors: [], genre: 'sichos', levels: ['sicha'], sets: [set] }, '/w');
  await add(catalog, 'mendy', 'keeper', 'unit', { work, position: [{ level: 'sicha', value: '1' }], order: 'V', label: { he: 'א' } }, '/w/1');
  app = createApp({ catalog, authenticate: (c) => c.req.header('X-Test-Account') ?? null });
});

const call = async (method: string, path: string, options: { as?: string; body?: unknown } = {}) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.as) headers['X-Test-Account'] = options.as;
  const response = await app.request(path, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  return { status: response.status, body: (await response.json()) as any };
};

describe('organizing over the API', () => {
  it('draws the tree from the top, from a set, and from a sefer', async () => {
    const top = await call('GET', '/v1/tree');
    expect(top.status).toBe(200);
    expect(top.body.children.map((n: { id: string }) => n.id).sort()).toEqual([set, sichos].sort());
    const one = await call('GET', `/v1/tree?root=${set}&depth=2`);
    expect(one.body.root).toMatchObject({ id: set, counts: { sets: 0, items: 1 } });
    expect(one.body.children[0]).toMatchObject({ id: work, counts: { units: 1 }, children: [{ path: '/w/1' }] });
    expect((await call('GET', '/v1/tree?root=nope')).status).toBe(400);
    expect((await call('GET', '/v1/tree?root=rh-zzzzzzzz')).status).toBe(404);
  });

  it('previews without saving, then makes one suggestion the keepers review', async () => {
    const plan = { operations: [{ op: 'move', items: [work], from: set, to: sichos }, { op: 'rename', item: work, slug: 'work' }] };
    const preview = await call('POST', '/v1/organize/preview', { body: plan });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ summary: [expect.stringMatching(/^Move חיבור/), expect.stringMatching(/^Rename/)] });
    expect(preview.body.revisions).toBeUndefined();
    expect(preview.body.redirects).toEqual(expect.arrayContaining([{ id: work, from: '/w', to: '/work' }, expect.objectContaining({ from: '/w/1', to: '/work/1' })]));
    expect((await catalog.get(work))!.path).toBe('/w');

    expect((await call('POST', '/v1/organize', { body: plan })).status).toBe(401);
    const made = await call('POST', '/v1/organize', { as: 'mendy', body: { ...plan, apply: true } });
    expect(made.status).toBe(201);
    // Not a steward: it waits for review, whatever `apply` says.
    expect(made.body).toMatchObject({ merged: false, mayApprove: false, suggestion: { status: 'open', author: 'mendy' } });
    expect((await call('POST', `/v1/suggestions/${made.body.suggestion.id}/approve`, { as: 'keeper' })).status).toBe(200);
    expect((await catalog.get(work))!.path).toBe('/work');
    expect((await call('GET', '/v1/resolve?path=/w/1')).body).toMatchObject({ redirected: true, path: '/work/1' });
  });

  it('applies at once for a steward who asks, and answers a merged item with where it went', async () => {
    const dup = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'חיבור' }, slug: 'dup', authors: [], genre: 'sichos', levels: ['sicha'], sets: [set] }, '/dup');
    const made = await call('POST', '/v1/organize', { as: 'shmuly', body: { operations: [{ op: 'merge', from: dup, into: work }], apply: true } });
    expect(made.body).toMatchObject({ merged: true, suggestion: { status: 'merged' }, preview: { forwards: [{ from: dup, to: work }] } });
    const gone = await call('GET', `/v1/entities/${dup}`);
    expect(gone).toMatchObject({ status: 404, body: { detail: { mergedInto: work } } });
    expect((await call('GET', '/v1/resolve?path=/dup')).body).toMatchObject({ id: work, redirected: true });
  });

  it('answers a bad plan plainly', async () => {
    expect((await call('POST', '/v1/organize/preview', { body: { nothing: true } })).status).toBe(400);
    const cycle = await call('POST', '/v1/organize/preview', { body: { operations: [{ op: 'move', items: [set], to: set }] } });
    expect(cycle).toMatchObject({ status: 422, body: { error: 'invalid' } });
    expect((await call('POST', '/v1/organize', { as: 'mendy', body: { operations: [{ op: 'move', items: [work], to: set }] } })).body.message).toMatch(/changes nothing/);
  });
});
