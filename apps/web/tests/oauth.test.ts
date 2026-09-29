import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ServerBuild } from 'react-router';
import { createPerson } from '@rebbehub/core';
import { createApp } from '../../../services/api/src/app.js';
import { add, freshCatalog, yudShvat } from '../../../packages/core/tests/helpers.js';
import { edgeCacheable } from '../server/cachePolicy.js';
import { createSiteHandler } from '../server/handler.js';

/**
 * The consent page (routes/oauth-consent.tsx), where a person says yes or
 * no to an app connecting to their account, and its passage to the API
 * (/_/oauth/requests/…), through the built site as in production.
 */

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://rebbehub.test';
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
let handle: (request: Request) => Promise<Response>;
let api: ReturnType<typeof createApp>;
let me: string;
let event: string;
let set: string;

beforeAll(async () => {
  if (!existsSync(`${webRoot}/build/server/index.js`)) execFileSync('npx', ['react-router', 'build'], { cwd: webRoot, stdio: 'ignore' });
  const build = (await import(`${webRoot}/build/server/index.js`)) as ServerBuild;
  const fresh = await freshCatalog();
  const catalog = fresh.catalog;
  set = fresh.set;
  event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(fresh.set), '/events/5742-05-10');
  me = (await createPerson(catalog.db, 'Shmuly', 'shmuly')).id;
  // The session in this test: a cookie naming the person (the real one is auth.ts's).
  api = createApp({ catalog, siteUrl: SITE, authenticate: (c) => /(?:^|;\s*)rh_session=(u-[\w-]+)/.exec(c.req.header('Cookie') ?? '')?.[1] ?? null });
  handle = createSiteHandler(build, { apiUrl: 'http://api.test', siteUrl: SITE, fetch: (input, init) => Promise.resolve(api.request(input, init)) });
}, 120_000);

async function asking(): Promise<string> {
  const made = await api.request('http://api.test/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CALLBACK] }) });
  const { client_id } = (await made.json()) as { client_id: string };
  const params = new URLSearchParams({ response_type: 'code', client_id, redirect_uri: CALLBACK, scope: 'read write', state: 'abc', code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256' });
  const sent = await api.request(`http://api.test/oauth/authorize?${params}`);
  const to = new URL(sent.headers.get('Location')!);
  expect(to.origin + to.pathname).toBe(`${SITE}/oauth/consent`);
  return to.searchParams.get('request')!;
}

describe('the consent page', () => {
  it('renders for anyone, kept out of search engines and the edge cache', async () => {
    const id = await asking();
    const request = new Request(`${SITE}/oauth/consent?request=${id}&lang=en`);
    expect(edgeCacheable(request)).toBe(false);
    const page = await handle(request);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('noindex');
    expect(html).toContain('Connect an app');
  });

  it('explains a request it cannot show, in both languages', async () => {
    const en = await (await handle(new Request(`${SITE}/oauth/consent?error=invalid_redirect&lang=en`))).text();
    expect(en).toContain('is not one it registered');
    const he = await (await handle(new Request(`${SITE}/oauth/consent?error=invalid_client`))).text();
    expect(he).toContain('האפליקציה לא מוכרת כאן');
  });

  it('shows the request to the person signed in, and their no goes back to the app', async () => {
    const id = await asking();
    const session = { Cookie: `rh_session=${me}`, 'Content-Type': 'application/json', Origin: SITE };
    expect((await handle(new Request(`${SITE}/_/oauth/requests/${id}`))).status).toBe(401);
    expect((await handle(new Request(`${SITE}/_/oauth/other`, { headers: session }))).status).toBe(404);
    const shown = await handle(new Request(`${SITE}/_/oauth/requests/${id}`, { headers: session }));
    expect(shown.headers.get('Cache-Control')).toBe('no-store');
    expect(await shown.json()).toMatchObject({ client: { name: 'Claude' }, redirectHost: 'claude.ai', scopes: ['read', 'write'] });

    const denied = await handle(new Request(`${SITE}/_/oauth/requests/${id}`, { method: 'POST', headers: session, body: JSON.stringify({ approve: false }) }));
    expect(denied.status).toBe(200);
    const back = new URL(((await denied.json()) as { redirect: string }).redirect);
    expect(back.origin + back.pathname).toBe(CALLBACK);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('state')).toBe('abc');
    expect(back.searchParams.has('code')).toBe(false);
  });
});

describe("an agent's work, on the site", () => {
  it("shows a suggestion sent with a token as the agent's, for the person, in both languages", async () => {
    const json = { 'Content-Type': 'application/json' };
    const made = await api.request('http://api.test/v1/tokens', { method: 'POST', headers: { ...json, Cookie: `rh_session=${me}` }, body: JSON.stringify({ name: 'Claude', scopes: ['read', 'write'] }) });
    const { token } = (await made.json()) as { token: string };
    const data = { ...yudShvat(set as never), title: { he: 'יו״ד שבט', en: 'Yud Shvat' } };
    const sent = await api.request('http://api.test/v1/suggestions/quick', { method: 'POST', headers: { ...json, Authorization: `Bearer ${token}` }, body: JSON.stringify({ entityId: event, data, title: 'A shorter title' }) });
    expect(sent.status).toBe(201);
    const { number } = (await sent.json()) as { number: number };

    const en = await (await handle(new Request(`${SITE}/suggestions/${number}?lang=en`))).text();
    expect(en).toContain('agent-mark');
    expect(en).toContain('No person has reviewed it yet');
    const he = await (await handle(new Request(`${SITE}/suggestions/${number}`))).text();
    expect(he).toContain('agent-mark');
    expect(he).toContain('בשביל');
    const list = await (await handle(new Request(`${SITE}/suggestions?lang=en`))).text();
    expect(list).toContain('agent-mark');
  });
});
