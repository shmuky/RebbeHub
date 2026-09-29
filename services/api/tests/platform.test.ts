import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createPerson, type Catalog } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';
import { createApp } from '../src/app.js';
import { cursor, etagMatches, mayUseEdgeCache, memoryRateLimiter } from '../src/platform.js';
import { add, freshCatalog, yudShvat } from '../../../packages/core/tests/helpers.js';

/**
 * What every route shares (platform.ts): the error shape, cursors, ETags
 * and caching, CORS, rate limits; and personal API tokens (tokens.ts),
 * which act as their person under the site's own rules.
 */

let app: Hono;
let catalog: Catalog;
let set: EntityId;
let event: EntityId;
let clock = 0;

beforeEach(async () => {
  const fresh = await freshCatalog();
  catalog = fresh.catalog;
  set = fresh.set;
  event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set), '/events/5742-05-10');
  clock = 0;
  app = createApp({
    catalog,
    // The session in tests: a header; tokens are real.
    authenticate: (c) => c.req.header('X-Test-Account') ?? null,
    rateLimits: { ip: memoryRateLimiter(5, 60, () => clock), key: memoryRateLimiter(8, 60, () => clock), search: memoryRateLimiter(2, 60, () => clock), ipPerMinute: 5, keyPerMinute: 8, searchPerMinute: 2 },
  });
});

const call = async (method: string, path: string, options: { as?: string; token?: string; body?: unknown; ip?: string; headers?: Record<string, string> } = {}) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...options.headers };
  if (options.as) headers['X-Test-Account'] = options.as;
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.ip) headers['CF-Connecting-IP'] = options.ip;
  const response = await app.request(path, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? (JSON.parse(text) as any) : null };
};

describe('errors, CORS and caching', () => {
  it('answers every error in one shape, its code following its status', async () => {
    expect(await call('GET', '/v1/entities/nope')).toMatchObject({ status: 400, body: { error: 'bad-request', message: expect.any(String) } });
    expect(await call('GET', '/v1/follows')).toMatchObject({ status: 401, body: { error: 'unauthorized' } });
    expect(await call('GET', '/v1/entities/rh-zzzzzzzz')).toMatchObject({ status: 404, body: { error: 'not-found' } });
    expect(await call('GET', '/v1/nowhere')).toMatchObject({ status: 404, body: { error: 'not-found' } });
  });

  it("lets other sites' pages read and send a token, never cookies", async () => {
    const preflight = await app.request('/v1/suggestions/quick', { method: 'OPTIONS', headers: { Origin: 'https://example.test', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type' } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toMatch(/Authorization/);
    expect(preflight.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    const read = await call('GET', '/v1/stats');
    expect(read.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(read.headers.get('Access-Control-Expose-Headers')).toMatch(/ETag/);
  });

  it('tags JSON with an ETag and answers 304 when it has not changed; public for a minute, private when signed in', async () => {
    const first = await call('GET', `/v1/entities/${event}`);
    const etag = first.headers.get('ETag')!;
    expect(etag).toMatch(/^W\/"/);
    expect(first.headers.get('Cache-Control')).toMatch(/^public, max-age=60/);
    expect(first.headers.get('Vary')).toMatch(/Authorization/);
    const again = await app.request(`/v1/entities/${event}`, { headers: { 'If-None-Match': etag } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe('');
    const changed = await app.request(`/v1/entities/${event}`, { headers: { 'If-None-Match': 'W/"old"' } });
    expect(changed.status).toBe(200);
    expect((await call('GET', `/v1/entities/${event}`, { headers: { Cookie: 'a=b' } })).headers.get('Cache-Control')).toBe('private, no-cache');
    // A route's own caching stays its own.
    expect((await call('GET', '/openapi.json')).headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(etagMatches('W/"a", "b"', '"b"')).toBe(true);
  });

  it('keeps crawlers to the guides and the files: the routes are read through the site', async () => {
    const robots = await app.request('/robots.txt');
    expect(await robots.text()).toBe('User-agent: *\nAllow: /llms.txt\nAllow: /openapi.json\nAllow: /objects/\nDisallow: /\n');
    expect(robots.headers.get('Cache-Control')).toMatch(/^public, .*s-maxage=86400/);
  });

  it("is kept at Cloudflare's edge when anyone may have it: a few minutes for reads, longer for sums of the whole catalog", async () => {
    expect((await call('GET', `/v1/entities/${event}`)).headers.get('Cache-Control')).toMatch(/s-maxage=\d+/);
    expect((await call('GET', '/v1/stats')).headers.get('Cache-Control')).toMatch(/^public, .*s-maxage=600/);
    expect((await call('GET', '/v1/sitemap')).headers.get('Cache-Control')).toMatch(/^public, .*s-maxage=3600/);
    // What someone signed in reads never is.
    expect((await call('GET', `/v1/entities/${event}`, { as: 'mendy', headers: { Cookie: 'rh_session=x' } })).headers.get('Cache-Control')).toBe('private, no-cache');
    // The edge answers only reads from nobody in particular, and never sign-in, the MCP server or a part of a file.
    const request = (path: string, init: RequestInit = {}) => new Request(`https://api.rebbehub.test${path}`, init);
    expect(mayUseEdgeCache(request('/v1/entities/rh-7k2m9q4d'))).toBe(true);
    expect(mayUseEdgeCache(request('/v1/search?q=x', { method: 'HEAD' }))).toBe(true);
    expect(mayUseEdgeCache(request('/objects/abc'))).toBe(true);
    expect(mayUseEdgeCache(request('/v1/reports', { method: 'POST' }))).toBe(false);
    expect(mayUseEdgeCache(request('/v1/issues', { headers: { Authorization: 'Bearer rhp_x' } }))).toBe(false);
    expect(mayUseEdgeCache(request('/v1/issues', { headers: { Cookie: '__Host-rh_session=x' } }))).toBe(false);
    expect(mayUseEdgeCache(request('/v1/auth/me'))).toBe(false);
    expect(mayUseEdgeCache(request('/v1/entities/rh-7k2m9q4d', { headers: { 'Cache-Control': 'no-cache' } }))).toBe(false);
    expect(mayUseEdgeCache(request('/mcp'))).toBe(false);
    for (const path of ['/oauth/authorize?client_id=x', '/.well-known/oauth-authorization-server', '/.well-known/oauth-protected-resource/mcp', '/v1/oauth/requests/oar-x']) expect(mayUseEdgeCache(request(path)), path).toBe(false);
    expect(mayUseEdgeCache(request('/objects/abc', { headers: { Range: 'bytes=0-99' } }))).toBe(false);
  });
});

describe('sitemaps', () => {
  it('list every kind of item with a page, a page of items at a time, and nothing else', async () => {
    const index = await call('GET', '/v1/sitemap');
    expect(index.status).toBe(200);
    expect(index.body.pageSize).toBe(10_000);
    expect(index.body.sitemaps).toContainEqual({ type: 'event', page: 1, count: 1, lastmod: expect.stringMatching(/^\d{4}-/) });
    expect(index.body.sitemaps.some((s: { type: string }) => s.type === 'schema')).toBe(false);
    const page = await call('GET', '/v1/sitemap/event/1');
    expect(page.body.items).toEqual([{ id: event, path: '/events/5742-05-10', lastmod: expect.stringMatching(/^\d{4}-/) }]);
    expect((await call('GET', '/v1/sitemap/event/2')).status).toBe(404);
    expect((await call('GET', '/v1/sitemap/schema/1')).status).toBe(404);
  });
});

describe('cursors', () => {
  it('page through items, children, commits and suggestions to the end, and still read an older plain value', async () => {
    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'חיבור' }, slug: 'w', authors: [], genre: 'sichos', levels: ['sicha'], sets: [set] });
    const units: string[] = [];
    // Three units with one order: a cursor of order alone would skip two.
    for (const n of ['1', '2', '3']) units.push(await add(catalog, 'mendy', 'keeper', 'unit', { work, position: [{ level: 'sicha', value: n }], order: 'V', label: { he: n } }));
    const seen: string[] = [];
    let next: string | null = null;
    do {
      const page: { body: { items: Array<{ id: string }>; next: string | null }; headers: Headers } = await call('GET', `/v1/entities/${work}/children?field=work&type=unit&limit=2${next ? `&cursor=${next}` : ''}`);
      seen.push(...page.body.items.map((i) => i.id));
      if (page.body.next) expect(page.headers.get('Link')).toMatch(/rel="next"/);
      next = page.body.next;
    } while (next);
    expect(seen.sort()).toEqual([...units].sort());

    const all: string[] = [];
    next = null;
    do {
      const page: { body: { items: Array<{ id: string }>; next: string | null } } = await call('GET', `/v1/entities?limit=2${next ? `&cursor=${next}` : ''}`);
      all.push(...page.body.items.map((i) => i.id));
      next = page.body.next;
    } while (next);
    expect(all).toHaveLength(new Set(all).size);
    expect(all).toEqual(expect.arrayContaining([event, work, ...units]));
    // What `next` used to be (a path and an id) is still read, as `after`.
    const legacy = await call('GET', '/v1/entities?type=event&after=');
    expect(legacy.body.items.map((i: { id: string }) => i.id)).toEqual([event]);

    const commits = await call('GET', '/v1/commits?limit=2');
    expect(commits.body.commits).toHaveLength(2);
    const after = await call('GET', `/v1/commits?limit=2&cursor=${commits.body.next}`);
    expect(after.body.commits[0].seq).toBe(commits.body.commits[1].seq + 1);

    const s1 = await call('GET', '/v1/suggestions?status=merged&limit=3');
    const s2 = await call('GET', `/v1/suggestions?status=merged&limit=3&cursor=${s1.body.next}`);
    const ids = [...s1.body.suggestions, ...s2.body.suggestions].map((s: { id: number }) => s.id);
    expect(ids).toHaveLength(new Set(ids).size);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    expect(await call('GET', '/v1/suggestions?cursor=junk')).toMatchObject({ status: 400 });
    expect(cursor.decode(cursor.encode(['a', 1]))).toEqual(['a', 1]);
    expect(cursor.decode('/events/5742')).toBeNull();
  });
});

describe('rate limits', () => {
  it('count requests per address, answer 429 with Retry-After, and start again after a minute', async () => {
    for (let i = 0; i < 5; i++) expect((await call('GET', '/v1/stats', { ip: '203.0.113.9' })).status).toBe(200);
    const limited = await call('GET', '/v1/stats', { ip: '203.0.113.9' });
    expect(limited).toMatchObject({ status: 429, body: { error: 'rate-limited' } });
    expect(limited.headers.get('Retry-After')).toBe('60');
    expect(limited.headers.get('RateLimit-Policy')).toMatch(/"address";q=5;w=60/);
    // Another address, and requests from inside (no address: the site's own server) are not held back.
    expect((await call('GET', '/v1/stats', { ip: '203.0.113.10' })).status).toBe(200);
    expect((await call('GET', '/v1/stats')).status).toBe(200);
    clock += 60_000;
    expect((await call('GET', '/v1/stats', { ip: '203.0.113.9' })).status).toBe(200);
  });

  it("hold searching to its own smaller allowance per address, on top of the address's", async () => {
    for (let i = 0; i < 2; i++) expect((await call('GET', '/v1/search?q=shvat', { ip: '203.0.113.20' })).status).toBe(200);
    const limited = await call('GET', '/v1/search/moments?q=shvat', { ip: '203.0.113.20' });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('RateLimit-Policy')).toMatch(/"search";q=2;w=60/);
    // Reading an item from the same address is not searching; the site's own server (no address) is not held back.
    expect((await call('GET', `/v1/entities/${event}`, { ip: '203.0.113.20' })).status).toBe(200);
    expect((await call('GET', '/v1/search?q=shvat')).status).toBe(200);
  });
});

describe('personal API tokens', () => {
  const person = async (name: string) => (await createPerson(catalog.db, name)).id;

  it('are made on the account page, shown once, used as Bearer, and revoked at once', async () => {
    const me = await person('Mendy');
    const made = await call('POST', '/v1/tokens', { as: me, body: { name: 'my script', scopes: ['read', 'write'] } });
    expect(made).toMatchObject({ status: 201, body: { name: 'my script', scopes: ['read', 'write'], token: expect.stringMatching(/^rhp_[\w-]{43}$/) } });
    const token = made.body.token as string;
    const listed = await call('GET', '/v1/tokens', { as: me });
    expect(listed.body.tokens).toEqual([expect.objectContaining({ id: made.body.id, prefix: token.slice(0, 8) })]);
    expect(JSON.stringify(listed.body)).not.toContain(token);
    // Only its hash is kept.
    const { rows } = await catalog.db.query<{ token_hash: string }>('SELECT token_hash FROM auth.api_token');
    expect(rows[0]!.token_hash).not.toContain(token.slice(4));

    // It signs its person in: a suggestion made with it is theirs, and waits for review like any other.
    const fixed = await call('POST', '/v1/suggestions/quick', { token, body: { entityId: event, data: { ...yudShvat(set), title: { he: 'יו״ד שבט', en: 'Yud Shvat' } }, title: 'A shorter title' } });
    expect(fixed).toMatchObject({ status: 201, body: { author: me, status: 'open' } });
    expect((await call('GET', '/v1/follows', { token })).status).toBe(200);
    expect((await call('GET', '/v1/tokens', { as: me })).body.tokens[0].lastUsedAt).not.toBeNull();

    expect((await call('DELETE', `/v1/tokens/${made.body.id}`, { as: me })).status).toBe(200);
    expect(await call('GET', '/v1/follows', { token })).toMatchObject({ status: 401, body: { error: 'unauthorized' } });
    expect((await call('GET', '/v1/tokens', { as: me })).body.tokens[0].revokedAt).not.toBeNull();
  });

  it('keep to their scope and never open sign-in, tokens or stewards\' tools', async () => {
    const me = await person('Chaim');
    const reader = (await call('POST', '/v1/tokens', { as: me, body: { name: 'reader' } })).body.token as string;
    expect((await call('GET', '/v1/follows', { token: reader })).status).toBe(200);
    expect(await call('POST', '/v1/follows', { token: reader, body: { kind: 'entity', id: event } })).toMatchObject({ status: 403, body: { error: 'forbidden' } });
    const writer = (await call('POST', '/v1/tokens', { as: me, body: { name: 'writer', scopes: ['write'] } })).body.token as string;
    expect((await call('POST', '/v1/follows', { token: writer, body: { kind: 'entity', id: event } })).status).toBe(200);
    expect(await call('POST', '/v1/tokens', { token: writer, body: { name: 'another' } })).toMatchObject({ status: 403 });
    expect(await call('GET', '/v1/admin/people', { token: writer })).toMatchObject({ status: 403 });
    // Nonsense is refused outright, never read as nobody.
    expect(await call('GET', '/v1/stats', { token: 'rhp_nope' })).toMatchObject({ status: 401 });
    expect(await call('POST', '/v1/tokens', { as: me, body: { name: '' } })).toMatchObject({ status: 422 });
    expect(await call('POST', '/v1/tokens', { as: me, body: { name: 'x', scopes: ['admin'] } })).toMatchObject({ status: 422 });
  });

  it('expire, count against their own allowance, and stop when their person is suspended', async () => {
    const me = await person('Yossi');
    const token = (await call('POST', '/v1/tokens', { as: me, body: { name: 'bot', scopes: ['read', 'write'], expiresInDays: 30 } })).body.token as string;
    // A token's allowance is its own, larger than the address's.
    for (let i = 0; i < 8; i++) expect((await call('GET', '/v1/stats', { token, ip: '198.51.100.1' })).status).toBe(200);
    expect((await call('GET', '/v1/stats', { token, ip: '198.51.100.1' })).status).toBe(429);
    clock += 60_000;

    await catalog.db.query("UPDATE auth.api_token SET expires_at = now() - interval '1 second'");
    expect((await call('GET', '/v1/stats', { token })).status).toBe(401);
    await catalog.db.query('UPDATE auth.api_token SET expires_at = NULL');
    expect((await call('GET', '/v1/stats', { token })).status).toBe(200);

    await catalog.db.query("UPDATE auth.person SET steward = TRUE WHERE id = $1", [me]);
    const steward = me;
    const other = await person('Other');
    const theirs = (await call('POST', '/v1/tokens', { as: other, body: { name: 'x', scopes: ['write'] } })).body.token as string;
    await catalog.createAccount({ id: other, displayName: 'Other' });
    await catalog.db.query("UPDATE account SET is_steward = TRUE WHERE id = $1", [steward]);
    expect((await call('POST', `/v1/admin/people/${other}/suspend`, { as: steward, body: { on: true } })).status).toBe(200);
    expect((await call('GET', '/v1/stats', { token: theirs })).status).toBe(401);
  });
});

describe('conversations', () => {
  it('take part with a write token (issues, comments, reviews), never change a handle, and page by cursor', async () => {
    const me = (await createPerson(catalog.db, 'Levi')).id;
    const writer = (await call('POST', '/v1/tokens', { as: me, body: { name: 'agent', scopes: ['read', 'write'] } })).body.token as string;
    const reader = (await call('POST', '/v1/tokens', { as: me, body: { name: 'reader' } })).body.token as string;

    const opened = await call('POST', '/v1/issues', { token: writer, body: { title: 'The date is off by a day', body: 'See the printing.', type: 'wrong-fact', entityId: event } });
    expect(opened).toMatchObject({ status: 201, body: { number: expect.any(Number), author: me, private: false } });
    expect((await call('POST', `/v1/issues/${opened.body.number}/comments`, { token: writer, body: { body: 'Checked it again.' } })).status).toBe(201);
    expect(await call('POST', `/v1/issues/${opened.body.number}/comments`, { token: reader, body: { body: 'no' } })).toMatchObject({ status: 403, body: { error: 'forbidden' } });

    const fixed = await call('POST', '/v1/suggestions/quick', { token: writer, body: { entityId: event, data: { ...yudShvat(set), title: { he: 'יו״ד שבט', en: 'Yud Shvat' } }, title: `Fixes #${opened.body.number}` } });
    expect((await call('POST', `/v1/suggestions/${fixed.body.id}/comments`, { token: writer, body: { body: 'Ready.' } })).status).toBe(201);
    // Anyone may review with a comment; approving is for those who may merge.
    expect((await call('POST', `/v1/suggestions/${fixed.body.id}/reviews`, { token: writer, body: { verdict: 'comment', body: 'One more look.' } })).status).toBe(201);

    // Handles are changed on the site only.
    expect(await call('POST', '/v1/auth/username', { token: writer, body: { username: 'levi' } })).toMatchObject({ status: 403, body: { error: 'forbidden' } });

    for (let i = 0; i < 3; i++) await call('POST', '/v1/issues', { as: me, body: { title: `Issue ${i}`, type: 'other' } });
    const seen: number[] = [];
    let next: string | null = null;
    do {
      const page: { status: number; body: { items: Array<{ number: number }>; next: string | null } } = await call('GET', `/v1/issues?state=all&limit=2${next ? `&cursor=${next}` : ''}`, { as: me });
      expect(page.status).toBe(200);
      seen.push(...page.body.items.map((i) => i.number));
      next = page.body.next;
    } while (next);
    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);
    expect(await call('GET', '/v1/issues?cursor=junk')).toMatchObject({ status: 400, body: { error: 'bad-request' } });
    expect(await call('GET', '/v1/issues/999999')).toMatchObject({ status: 404, body: { error: 'not-found' } });
  });
});
