import { readFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createPerson, type Catalog } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';
import { createApp } from '../../../services/api/src/app.js';
import { add, freshCatalog, yudShvat } from '../../core/tests/helpers.js';
import { RebbeHub, RebbeHubError } from '../src/index.js';
import { generate } from '../scripts/generate.js';

/**
 * The typed client (packages/client): generated from the OpenAPI document
 * and kept so, and working against the API itself.
 */

describe('the generated client', () => {
  it('is what the generator writes from the OpenAPI document now (run `npm run generate -w @rebbehub/client` after changing the API)', async () => {
    const kept = await readFile(new URL('../src/generated.ts', import.meta.url), 'utf8');
    expect(kept).toBe(generate());
  });
});

describe('the client against the API', () => {
  let app: Hono;
  let catalog: Catalog;
  let set: EntityId;
  let event: EntityId;

  beforeEach(async () => {
    const fresh = await freshCatalog();
    catalog = fresh.catalog;
    set = fresh.set;
    event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set), '/events/5742-05-10');
    app = createApp({ catalog, authenticate: (c) => c.req.header('X-Test-Account') ?? null });
  });

  const client = (token?: string) => new RebbeHub({ baseUrl: 'https://api.test', token, fetch: async (url, init) => app.request(url, init) });

  it('reads, searches and resolves, typed', async () => {
    const rh = client();
    expect((await rh.about()).name).toBe('RebbeHub');
    const item = await rh.getItem({ id: event });
    expect(item).toMatchObject({ id: event, type: 'event' });
    expect((await rh.resolvePath({ path: '/events/5742-05-10' })).id).toBe(event);
    const { results, date } = await rh.search({ q: 'יו״ד שבט תשמ״ב', limit: 5 });
    expect(results.map((r) => r.id)).toContain(event);
    expect(date?.key).toBe('5742-05-10');
  });

  it('walks every page of a list', async () => {
    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'חיבור' }, slug: 'w', authors: [], genre: 'sichos', levels: ['sicha'], sets: [set] });
    const units = [];
    for (const [n, order] of [['1', 'V'], ['2', 'k'], ['3', 'z']] as const) units.push(await add(catalog, 'mendy', 'keeper', 'unit', { work, position: [{ level: 'sicha', value: n }], order, label: { he: n } }));
    const seen: string[] = [];
    for await (const unit of client().all('listChildren', { id: work, field: 'work', type: 'unit', limit: 2 })) seen.push(unit.id);
    expect(seen).toEqual(units);
  });

  it('throws the API\'s errors with their code, and suggests with a token', async () => {
    const error = await client().getItem({ id: 'rh-zzzzzzzz' }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RebbeHubError);
    expect(error).toMatchObject({ status: 404, code: 'not-found' });
    await expect(client().suggestFix({ body: { entityId: event, data: {} } })).rejects.toMatchObject({ status: 401, code: 'unauthorized' });

    const me = (await createPerson(catalog.db, 'Script owner')).id;
    const made = (await (await app.request('/v1/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Test-Account': me }, body: JSON.stringify({ name: 'script', scopes: ['write'] }) })).json()) as { token: string };
    const suggestion = await client(made.token).suggestFix({ body: { entityId: event, data: { ...yudShvat(set), note: 'Checked against the recording' }, title: 'Add a note' } });
    expect(suggestion).toMatchObject({ author: me, status: 'open' });
  });
});
