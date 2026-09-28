import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type { EntityId } from '@rebbehub/model';
import { createApp } from '../src/app.js';
import { add, freshCatalog, yudShvat } from '../../../packages/core/tests/helpers.js';

let app: Hono;
let set: EntityId;
let event: EntityId;

beforeEach(async () => {
  const fresh = await freshCatalog();
  set = fresh.set;
  event = await add(fresh.catalog, 'mendy', 'keeper', 'event', yudShvat(set), '/events/5742-05-10');
  // Tests sign in with a header; a real deployment verifies a session.
  app = createApp({ catalog: fresh.catalog, authenticate: (c) => c.req.header('X-Test-Account') ?? null, reportSalt: 'test', reportsPerHour: 2 });
});

const call = async (method: string, path: string, options: { as?: string; body?: unknown; ip?: string } = {}) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.as) headers['X-Test-Account'] = options.as;
  if (options.ip) headers['CF-Connecting-IP'] = options.ip;
  const response = await app.request(path, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  return { status: response.status, body: (await response.json()) as any };
};

describe('reading', () => {
  it('serves items, paths, history, search and the schemas', async () => {
    expect((await call('GET', '/v1')).body).toMatchObject({ name: 'RebbeHub', docs: '/openapi.json' });
    expect((await call('GET', `/v1/entities/${event}`)).body).toMatchObject({ id: event, type: 'event', data: { date: '5742-05-10' } });
    expect((await call('GET', `/v1/entities/${event.toUpperCase()}`)).status).toBe(200); // ids are read forgivingly
    expect((await call('GET', '/v1/resolve?path=/events/5742-05-10')).body).toMatchObject({ id: event });
    expect((await call('GET', `/v1/entities/${event}/history`)).body.history).toHaveLength(1);
    const search = await call('GET', `/v1/search?q=${encodeURIComponent('י׳ שבט תשמ״ב')}`);
    expect(search.body.date).toMatchObject({ key: '5742-05-10', en: '10 Shevat 5742' });
    expect(search.body.results.map((r: { id: string }) => r.id)).toContain(event);
    expect((await call('GET', `/v1/entities?type=event&set=${set}`)).body.items).toHaveLength(1);
    expect((await call('GET', '/v1/types')).body.types.length).toBe(21);
    expect((await call('GET', '/openapi.json')).body.openapi).toBe('3.1.0');
  });

  it('answers mistakes plainly', async () => {
    expect(await call('GET', '/v1/entities/nope')).toMatchObject({ status: 400 });
    expect(await call('GET', '/v1/entities/rh-zzzzzzzz')).toMatchObject({ status: 404, body: { error: 'not-found' } });
    expect(await call('GET', '/v1/entities?type=spaceship')).toMatchObject({ status: 400 });
    expect(await call('GET', '/v1/nothing-here')).toMatchObject({ status: 404 });
  });
});

describe('reports', () => {
  it('need no account, and are rate limited per address', async () => {
    expect(await call('POST', '/v1/reports', { body: { entityId: event, reason: 'wrong-fact', note: 'wrong year' }, ip: '1.2.3.4' })).toMatchObject({ status: 201 });
    expect(await call('POST', '/v1/reports', { body: { entityId: event, reason: 'wrong-fact' }, ip: '1.2.3.4' })).toMatchObject({ status: 201 });
    expect(await call('POST', '/v1/reports', { body: { entityId: event, reason: 'wrong-fact' }, ip: '1.2.3.4' })).toMatchObject({ status: 429 });
    expect(await call('POST', '/v1/reports', { body: { reason: 'nonsense' } })).toMatchObject({ status: 400 });
    expect(await call('GET', `/v1/reports?set=${set}`)).toMatchObject({ status: 401 });
    expect((await call('GET', `/v1/reports?set=${set}`, { as: 'keeper' })).body.reports).toHaveLength(2);
  });
});

describe('suggestions', () => {
  it('go from draft to approval over the API', async () => {
    expect(await call('POST', '/v1/suggestions', { body: { title: 'x' } })).toMatchObject({ status: 401 });
    const created = await call('POST', '/v1/suggestions', { as: 'chaim', body: { title: 'Occasion for Yud Shvat' } });
    expect(created.status).toBe(201);
    const id = created.body.id;
    await call('PUT', `/v1/suggestions/${id}/items`, { as: 'chaim', body: { id: event, type: 'event', data: { ...yudShvat(set), occasion: 'yud-shvat' } } });
    const submitted = await call('POST', `/v1/suggestions/${id}/submit`, { as: 'chaim' });
    expect(submitted.body.status).toBe('open');
    const view = await call('GET', `/v1/suggestions/${id}`);
    expect(view.body.entries[0].changes).toEqual([{ path: '/occasion', after: 'yud-shvat' }]);
    expect(await call('POST', `/v1/suggestions/${id}/approve`, { as: 'chaim' })).toMatchObject({ status: 403 });
    expect((await call('POST', `/v1/suggestions/${id}/approve`, { as: 'keeper', body: {} })).status).toBe(200);
    expect((await call('GET', `/v1/entities/${event}`)).body.data.occasion).toBe('yud-shvat');
  });

  it('reports clashes as 409 with the choices', async () => {
    const a = (await call('POST', '/v1/suggestions', { as: 'chaim', body: { title: 'a' } })).body.id;
    const b = (await call('POST', '/v1/suggestions', { as: 'mendy', body: { title: 'b' } })).body.id;
    await call('PUT', `/v1/suggestions/${a}/items`, { as: 'chaim', body: { id: event, type: 'event', data: { ...yudShvat(set), date: '5742-05-11' } } });
    await call('PUT', `/v1/suggestions/${b}/items`, { as: 'mendy', body: { id: event, type: 'event', data: { ...yudShvat(set), date: '5742-05-12' } } });
    await call('POST', `/v1/suggestions/${a}/submit`, { as: 'chaim' });
    await call('POST', `/v1/suggestions/${b}/submit`, { as: 'mendy' });
    await call('POST', `/v1/suggestions/${a}/approve`, { as: 'keeper' });
    const clash = await call('POST', `/v1/suggestions/${b}/approve`, { as: 'keeper' });
    expect(clash.status).toBe(409);
    expect(clash.body.conflicts[0]).toMatchObject({ path: `${event}/date`, ours: '5742-05-11', theirs: '5742-05-12' });
    const settled = await call('POST', `/v1/suggestions/${b}/approve`, { as: 'keeper', body: { resolutions: { [event]: { '/date': { take: 'ours' } } } } });
    expect(settled.status).toBe(200);
  });
});
