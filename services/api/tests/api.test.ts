import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type { EntityId } from '@rebbehub/model';
import { recordDerivation, registerFile, setRights } from '@rebbehub/core';
import { createApp, parseRange } from '../src/app.js';
import { add, freshCatalog, yudShvat } from '../../../packages/core/tests/helpers.js';

let app: Hono;
let set: EntityId;
let event: EntityId;
let catalog: Awaited<ReturnType<typeof freshCatalog>>['catalog'];

beforeEach(async () => {
  const fresh = await freshCatalog();
  catalog = fresh.catalog;
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

describe('browsing', () => {
  it('lists a parent\'s children in order, events by date, several items at once, and counts', async () => {
    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'חיבור' }, slug: 'w', authors: [], genre: 'sichos', levels: ['sicha'], sets: [set] });
    const second = await add(catalog, 'mendy', 'keeper', 'unit', { work, position: [{ level: 'sicha', value: '2' }], order: 'k', label: { he: 'ב' } });
    const first = await add(catalog, 'mendy', 'keeper', 'unit', { work, position: [{ level: 'sicha', value: '1' }], order: 'V', label: { he: 'א' } });
    const page1 = await call('GET', `/v1/entities/${work}/children?field=work&type=unit&limit=1`);
    expect(page1.body.items.map((i: { id: string }) => i.id)).toEqual([first]);
    const page2 = await call('GET', `/v1/entities/${work}/children?field=work&type=unit&after=${page1.body.next}`);
    expect(page2.body.items.map((i: { id: string }) => i.id)).toEqual([second]);

    const later = await add(catalog, 'mendy', 'keeper', 'event', { ...yudShvat(set), date: '5742-05-12', title: { he: 'י״ב שבט' } });
    const other = await add(catalog, 'mendy', 'keeper', 'event', { ...yudShvat(set), date: '5711-05-10', title: { he: 'יו״ד שבט תשי״א' } });
    expect((await call('GET', '/v1/events?within=5742-05')).body.items.map((i: { id: string }) => i.id)).toEqual([event, later]);
    expect((await call('GET', '/v1/events?within=5742')).body.items).toHaveLength(2);
    expect((await call('GET', '/v1/events?day=05-10')).body.items.map((i: { id: string }) => i.id)).toEqual([other, event]);
    expect(await call('GET', '/v1/events?within=spring')).toMatchObject({ status: 422 });

    expect((await call('GET', `/v1/entities/batch?ids=${later},rh-zzzzzzzz,${event}`)).body.items.map((i: { id: string }) => i.id)).toEqual([later, event]);
    expect((await call('GET', '/v1/stats')).body.counts).toMatchObject({ event: 3, unit: 2, work: 1, set: 1 });
  });
});

describe('the media proxy', () => {
  it('serves a file\'s bytes, and ranges of them, only while its rights allow', async () => {
    const bytes = new TextEncoder().encode('0123456789');
    const sha256 = 'c'.repeat(64);
    await registerFile(catalog.db, { sha256, bytes: bytes.length, mime: 'audio/mpeg', source: 'contribution', licence: 'cc0', held: true });
    const files = {
      async get(key: string, range?: { offset: number; length?: number }) {
        if (key !== `objects/${sha256}`) return null;
        const part = range ? bytes.slice(range.offset, range.length === undefined ? undefined : range.offset + range.length) : bytes;
        return { body: new Blob([part]).stream(), size: bytes.length };
      },
    };
    const proxy = createApp({ catalog, files });
    const whole = await proxy.request(`http://api.test/objects/${sha256}`);
    expect(whole.status).toBe(200);
    expect(await whole.text()).toBe('0123456789');
    const part = await proxy.request(`http://api.test/objects/${sha256}`, { headers: { Range: 'bytes=2-4' } });
    expect(part.status).toBe(206);
    expect(part.headers.get('content-range')).toBe('bytes 2-4/10');
    expect(await part.text()).toBe('234');
    expect((await proxy.request(`http://api.test/objects/${sha256}`, { headers: { Range: 'bytes=20-' } })).status).toBe(416);
    expect(await (await proxy.request(`http://api.test/v1/files/${sha256}`)).json()).toMatchObject({ url: `http://api.test/objects/${sha256}` });

    // A copy made from it (a scan's reading copy) is listed with it, and served under the same rights.
    const copy = 'd'.repeat(64);
    await recordDerivation(catalog.db, { src: sha256, profile: 'reading-copy', sha256: copy, bytes: 8, mime: 'audio/mpeg', encoder: 'test@1' });
    expect(await (await proxy.request(`http://api.test/v1/files/${sha256}`)).json()).toMatchObject({
      derivations: [{ profile: 'reading-copy', sha256: copy, bytes: 8, encoder: 'test@1', url: `http://api.test/objects/${copy}` }],
    });

    await setRights(catalog.db, 'shmuly', sha256, 'preserved', 'takedown');
    expect((await proxy.request(`http://api.test/objects/${sha256}`)).status).toBe(404);
    expect((await proxy.request(`http://api.test/objects/${copy}`)).status).toBe(404);
    expect(await (await proxy.request(`http://api.test/v1/files/${sha256}`)).json()).toMatchObject({ url: null });
  });

  it('serves the published manifests, and nothing else from the bucket', async () => {
    const manifest = JSON.stringify({ format: 'rebbehub-reading-copies', files: [] });
    const files = {
      async get(key: string) {
        return key === 'manifests/reading-copies/sichos-kodesh.json' ? { body: new Blob([manifest]).stream(), size: manifest.length } : null;
      },
    };
    const proxy = createApp({ catalog, files });
    const found = await proxy.request('http://api.test/manifests/reading-copies/sichos-kodesh.json');
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual({ format: 'rebbehub-reading-copies', files: [] });
    expect((await proxy.request('http://api.test/manifests/reading-copies/other.json')).status).toBe(404);
    expect((await proxy.request('http://api.test/manifests/..%2Fobjects/x.json')).status).toBe(404);
  });

  it('reads Range headers', () => {
    expect(parseRange('bytes=0-99')).toEqual({ offset: 0, length: 100 });
    expect(parseRange('bytes=100-')).toEqual({ offset: 100 });
    expect(parseRange('bytes=-10', 50)).toEqual({ offset: 40, length: 10 });
    expect(parseRange('bytes=1-2,5-6')).toBeNull();
    expect(parseRange(undefined)).toBeNull();
  });
});

describe('rights', () => {
  it('never serves the words of a text whose source forbids copies', async () => {
    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'חיבור' }, slug: 'w', authors: [], genre: 'sichos', levels: ['sicha'], sets: [set] });
    const unit = await add(catalog, 'mendy', 'keeper', 'unit', { work, position: [{ level: 'sicha', value: '1' }], order: 'V', label: { he: 'שיחה א' } });
    const closed = await add(catalog, 'mendy', 'keeper', 'text', { kind: 'hanacha', unit, language: 'he', licence: 'site-terms' });
    const segment = await add(catalog, 'mendy', 'keeper', 'segment', { text: closed, order: 'V', kind: 'paragraph', content: 'לא לפרסום', proofread: 0 });
    const served = await call('GET', `/v1/entities/${segment}`);
    expect(served.body).toMatchObject({ id: segment, data: { content: '' } });
    expect(served.body.withheld).toMatch(/site-terms/);
    expect(JSON.stringify((await call('GET', `/v1/revisions/${served.body.rev}`)).body)).not.toContain('לא לפרסום');
    expect(JSON.stringify((await call('GET', '/v1/commits?since=0&limit=100')).body)).not.toContain('לא לפרסום');
    expect(JSON.stringify((await call('GET', '/v1/entities?type=segment')).body)).not.toContain('לא לפרסום');
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
