import { beforeAll, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type { Json } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';
import { createApp } from '../src/app.js';
import { freshCatalog } from '../../../packages/core/tests/helpers.js';

/**
 * A bot's large Suggestion over the API, as the review page reads it: the
 * list says how many items each changes and that its author is a bot,
 * the review view gives a page of items at a time with `next`, and
 * Approve takes in every item, however few were read.
 */

const N = 60;
let app: Hono;
let catalog: Awaited<ReturnType<typeof freshCatalog>>['catalog'];
let bulk: number;
const ids: EntityId[] = [];

const call = async (method: string, path: string, options: { as?: string; body?: unknown } = {}) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.as) headers['X-Test-Account'] = options.as;
  const response = await app.request(path, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  return { status: response.status, body: (await response.json()) as any };
};

beforeAll(async () => {
  const fresh = await freshCatalog();
  catalog = fresh.catalog;
  app = createApp({ catalog, authenticate: (c) => c.req.header('X-Test-Account') ?? null, reportSalt: 'test' });
  const event = (i: number, url: string) => ({ kind: 'farbrengen', title: { he: `התוועדות ${i}` }, date: '5742-05-10', sets: [fresh.set], links: [{ kind: 'mugah', label: { he: 'מוגה' }, url }] }) as unknown as Json;
  const setup = await catalog.createChangeset('mendy', { title: 'Farbrengens' });
  for (let i = 0; i < N; i++) ids.push(await catalog.putRevision(setup.id, 'mendy', { type: 'event', data: event(i, `https://sichos-kodesh-media-proxy.shmuky.workers.dev/drive/f${i}`) }));
  await catalog.submit(setup.id, 'mendy');
  await catalog.merge(setup.id, 'keeper');
  await catalog.createAccount({ id: 'bot:relink-drive', displayName: 'Drive links (relink bot)', isBot: true });
  const cs = await catalog.createChangeset('bot:relink-drive', { title: `Drive links in place of the media proxy (1-${N})`, kind: 'import' });
  for (let i = 0; i < N; i++) await catalog.putRevision(cs.id, 'bot:relink-drive', { id: ids[i], type: 'event', data: event(i, `https://drive.google.com/file/d/f${i}/view`) });
  await catalog.submit(cs.id, 'bot:relink-drive');
  bulk = cs.id;
}, 120_000);

describe("a bot's large Suggestion over the API", () => {
  it('is listed with how many items it changes, and by a bot', async () => {
    const list = await call('GET', '/v1/suggestions?status=open');
    const row = list.body.suggestions.find((s: { id: number }) => s.id === bulk);
    expect(row).toMatchObject({ number: null, author: 'bot:relink-drive', kind: 'import', items: N });
    expect(list.body.people['bot:relink-drive']).toMatchObject({ name: 'Drive links (relink bot)', bot: true });
  });

  it('gives 25 items at a time, with the total, where the next page starts, and a summary of them all when asked', async () => {
    const first = await call('GET', `/v1/suggestions/${bulk}`, { as: 'keeper' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ total: N, offset: 0, limit: 25, next: 25, mayApprove: true });
    expect(first.body.entries).toHaveLength(25);
    expect(first.body.people['bot:relink-drive'].bot).toBe(true);
    // A page alone reads only its items; the summary of all of them reads them all, so it comes only when asked.
    expect(first.body.summary).toBeUndefined();
    const summarized = await call('GET', `/v1/suggestions/${bulk}?summary=1`, { as: 'keeper' });
    expect(summarized.body.entries).toHaveLength(25);
    expect(summarized.body.summary).toHaveLength(1);
    expect(summarized.body.summary[0]).toMatchObject({ type: 'event', count: N, fields: [{ path: '/links', before: 'link:sichos-kodesh-media-proxy.shmuky.workers.dev', after: 'link:drive.google.com' }] });
    const second = await call('GET', `/v1/suggestions/${bulk}?offset=${first.body.next}`);
    expect(second.body).toMatchObject({ offset: 25, next: 50 });
    const last = await call('GET', `/v1/suggestions/${bulk}?offset=50&limit=25`);
    expect(last.body.entries).toHaveLength(N - 50);
    expect(last.body.next).toBeNull();
    const seen = [...first.body.entries, ...second.body.entries, ...last.body.entries].map((e: { entityId: string }) => e.entityId);
    expect(new Set(seen).size).toBe(N);
    expect((await call('GET', `/v1/suggestions/${bulk}?limit=500`)).body.entries).toHaveLength(N); // at most 200 a page
    expect((await call('GET', `/v1/suggestions/${bulk}?offset=-1`)).status).toBe(400);
  });

  it('approves every item at once, having read one page', async () => {
    expect((await call('POST', `/v1/suggestions/${bulk}/approve`, { as: 'keeper', body: {} })).status).toBe(200);
    for (const id of [ids[0]!, ids[N - 1]!]) expect(JSON.stringify((await catalog.get(id))!.data)).toContain('drive.google.com');
  });
});
