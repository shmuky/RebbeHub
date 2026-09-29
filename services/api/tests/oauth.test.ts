import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createPerson, type Catalog } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';
import { createApp } from '../src/app.js';
import { add, freshCatalog, yudShvat } from '../../../packages/core/tests/helpers.js';

/**
 * Connecting an app with OAuth (oauth.ts): the metadata an MCP client
 * finds its way by, registering, the person's yes or no, PKCE, codes and
 * refresh tokens, revoking, and that a connected agent's fix is a
 * suggestion under its person's name, reviewed like any other.
 */

const API = 'https://api.rebbehub.test';
const SITE = 'https://rebbehub.test';
const CALLBACK = 'https://claude.ai/api/mcp/auth_callback';
const CIMD = 'https://client.example.test/oauth/client.json';

let app: Hono;
let catalog: Catalog;
let event: EntityId;
let me: string;
let fetched: string[];

beforeEach(async () => {
  const fresh = await freshCatalog();
  catalog = fresh.catalog;
  event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(fresh.set), '/events/5742-05-10');
  me = (await createPerson(catalog.db, 'Shmuly')).id;
  fetched = [];
  app = createApp({
    catalog,
    authenticate: (c) => c.req.header('X-Test-Account') ?? null,
    siteUrl: SITE,
    // An app known by its own description: read from "its" address, here made up.
    fetchClientMetadata: async (url) => {
      fetched.push(url);
      if (url !== CIMD) return new Response('not here', { status: 404 });
      return Response.json({ client_id: CIMD, client_name: 'Example Agent', client_uri: 'https://client.example.test', redirect_uris: ['http://127.0.0.1:3000/callback'], token_endpoint_auth_method: 'none' });
    },
  });
});

const request = (path: string, init: RequestInit = {}) => app.request(`${API}${path}`, init);
const json = async (path: string, init: RequestInit = {}) => {
  const response = await request(path, init);
  const text = await response.text();
  return { status: response.status, headers: response.headers, body: text ? (JSON.parse(text) as any) : null };
};
const form = (fields: Record<string, string>) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields).toString() });

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

async function register(extra: Record<string, unknown> = {}) {
  const made = await json('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'Claude', redirect_uris: [CALLBACK], ...extra }) });
  expect(made.status).toBe(201);
  return made.body as { client_id: string; client_secret?: string };
}

/** The app sends the person to /oauth/authorize; answers where they were sent. */
async function authorize(params: Record<string, string>): Promise<URL> {
  const response = await request(`/oauth/authorize?${new URLSearchParams(params)}`);
  expect(response.status).toBe(302);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  return new URL(response.headers.get('Location')!);
}

/** The whole way to a code: authorize, the person says yes on the consent page, the browser goes back to the app. */
async function codeFor(clientId: string, options: { scope?: string; resource?: string; redirect?: string; allow?: string[] } = {}) {
  const { verifier, challenge } = await pkce();
  const consent = await authorize({ response_type: 'code', client_id: clientId, redirect_uri: options.redirect ?? CALLBACK, scope: options.scope ?? 'read write', state: 'xyz', code_challenge: challenge, code_challenge_method: 'S256', resource: options.resource ?? `${API}/mcp` });
  expect(consent.origin + consent.pathname).toBe(`${SITE}/oauth/consent`);
  const id = consent.searchParams.get('request')!;
  const decided = await json(`/v1/oauth/requests/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Test-Account': me }, body: JSON.stringify({ approve: true, ...(options.allow ? { scopes: options.allow } : {}) }) });
  expect(decided.status).toBe(200);
  const back = new URL(decided.body.redirect);
  expect(back.searchParams.get('state')).toBe('xyz');
  expect(back.searchParams.get('iss')).toBe(API);
  return { code: back.searchParams.get('code')!, verifier };
}

async function tokensFor(clientId: string, options: Parameters<typeof codeFor>[1] = {}) {
  const { code, verifier } = await codeFor(clientId, options);
  const answer = await json('/oauth/token', form({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id: clientId, redirect_uri: options.redirect ?? CALLBACK, resource: options.resource ?? `${API}/mcp` }));
  expect(answer.status).toBe(200);
  return answer.body as { access_token: string; refresh_token: string; scope: string; expires_in: number };
}

const mcp = async (token: string, method: string, params?: unknown) =>
  json('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }) });

describe('OAuth for MCP clients', () => {
  it('says where to connect: the MCP server\'s 401, its resource metadata, and the authorization server\'s', async () => {
    // Reading needs nothing; a tool that writes asks for the person.
    expect((await request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"jsonrpc":"2.0","id":1,"method":"initialize"}' })).status).toBe(200);
    const refused = await request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'open_issue', arguments: { title: 'x' } } }) });
    expect(refused.status).toBe(401);
    expect(refused.headers.get('WWW-Authenticate')).toBe(`Bearer resource_metadata="${API}/.well-known/oauth-protected-resource/mcp", scope="read write"`);

    const resource = await json('/.well-known/oauth-protected-resource/mcp');
    expect(resource.body).toMatchObject({ resource: `${API}/mcp`, authorization_servers: [API], scopes_supported: ['read', 'write'], bearer_methods_supported: ['header'] });
    expect((await json('/.well-known/oauth-protected-resource')).body).toMatchObject({ resource: API, authorization_servers: [API] });

    const server = await json('/.well-known/oauth-authorization-server');
    expect(server.body).toMatchObject({
      issuer: API,
      authorization_endpoint: `${API}/oauth/authorize`,
      token_endpoint: `${API}/oauth/token`,
      registration_endpoint: `${API}/oauth/register`,
      revocation_endpoint: `${API}/oauth/revoke`,
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      client_id_metadata_document_supported: true,
    });
  });

  it('registers apps, and refuses redirect addresses that could be anyone\'s', async () => {
    const client = await register();
    expect(client).toMatchObject({ client_id: expect.stringMatching(/^rhc-/), token_endpoint_auth_method: 'none', redirect_uris: [CALLBACK] });
    expect(client.client_secret).toBeUndefined();
    for (const bad of [['http://evil.example/cb'], ['javascript:alert(1)'], ['https://x.example/cb#frag'], []]) {
      const refused = await json('/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: 'x', redirect_uris: bad }) });
      expect(refused, JSON.stringify(bad)).toMatchObject({ status: 400, body: { error: 'invalid_redirect_uri' } });
    }
    // An app on the person's computer, and an app's own scheme, are fine.
    await register({ redirect_uris: ['http://localhost:33418/callback', 'cursor://anysphere.cursor-retrieval/oauth/callback'] });
  });

  it('connects with PKCE: the person says yes, the code is traded once for tokens, and a fix is a suggestion as them', async () => {
    const { client_id } = await register();
    const tokens = await tokensFor(client_id);
    expect(tokens).toMatchObject({ access_token: expect.stringMatching(/^rho_[\w-]{43}$/), refresh_token: expect.stringMatching(/^rhr_[\w-]{43}$/), scope: 'read write', expires_in: 3600 });

    expect((await mcp(tokens.access_token, 'initialize', { protocolVersion: '2025-11-25' })).body.result.serverInfo.name).toBe('rebbehub');
    const fixed = await mcp(tokens.access_token, 'tools/call', { name: 'suggest_fix', arguments: { id: event, changes: { title: { he: 'יו״ד שבט', en: 'Yud Shvat' } }, title: 'Shorter title' } });
    expect(fixed.body.result.isError).toBe(false);
    const suggestion = await catalog.changeset(fixed.body.result.structuredContent.suggestion);
    expect(suggestion.author).toBe(me);
    // ...sent by the app for them, not typed by them.
    expect(suggestion.via).toMatchObject({ kind: 'oauth', name: 'Claude', id: expect.stringMatching(/^oac-/), client: client_id });
    // Nothing changed on main until a keeper approves.
    expect((await catalog.get(event))!.data).toMatchObject({ title: { en: 'Yud Shvat 5742' } });

    // The account page lists it with the app's name, and revoking it there ends it.
    const listed = await json('/v1/tokens', { headers: { 'X-Test-Account': me } });
    const connection = listed.body.tokens.find((t: any) => t.kind === 'oauth');
    expect(connection).toMatchObject({ name: 'Claude', scopes: ['read', 'write'], client: { name: 'Claude', host: 'claude.ai' }, lastUsedAt: expect.any(String) });
    expect(JSON.stringify(listed.body)).not.toContain(tokens.access_token);
    expect((await json(`/v1/tokens/${connection.id}`, { method: 'DELETE', headers: { 'X-Test-Account': me } })).status).toBe(200);
    expect((await mcp(tokens.access_token, 'ping')).status).toBe(401);
    expect((await json('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id }))).body.error).toBe('invalid_grant');
  });

  it('refuses a wrong verifier, a wrong redirect address, another app, and a code used twice (which ends its connection)', async () => {
    const { client_id } = await register();
    const other = await register({ client_name: 'Other' });

    const first = await codeFor(client_id);
    const trade = (fields: Record<string, string>) => json('/oauth/token', form({ grant_type: 'authorization_code', client_id, redirect_uri: CALLBACK, code: first.code, code_verifier: first.verifier, ...fields }));
    expect((await trade({ code_verifier: (await pkce()).verifier })).body).toMatchObject({ error: 'invalid_grant', error_description: expect.stringContaining('code_verifier') });
    expect((await trade({ redirect_uri: 'https://claude.ai/elsewhere' })).body.error).toBe('invalid_grant');
    expect((await trade({ client_id: other.client_id })).body.error).toBe('invalid_grant');
    expect((await trade({ resource: 'https://elsewhere.example/mcp' })).body.error).toBe('invalid_target');
    expect((await trade({ client_id: 'rhc-nobody' })).status).toBe(401);
    const good = await trade({});
    expect(good.status).toBe(200);
    const again = await trade({});
    expect(again.body.error).toBe('invalid_grant');
    // Someone else may have the code: the connection made with it is ended.
    expect((await mcp(good.body.access_token, 'ping')).status).toBe(401);

    // An authorization without PKCE, or with plain PKCE, goes back to the app as an error.
    const noPkce = await authorize({ response_type: 'code', client_id, redirect_uri: CALLBACK, state: 's' });
    expect(noPkce.origin + noPkce.pathname).toBe(CALLBACK);
    expect(noPkce.searchParams.get('error')).toBe('invalid_request');
    expect(noPkce.searchParams.get('state')).toBe('s');
    const plain = await authorize({ response_type: 'code', client_id, redirect_uri: CALLBACK, code_challenge: 'a'.repeat(43), code_challenge_method: 'plain' });
    expect(plain.searchParams.get('error')).toBe('invalid_request');
    // A redirect address the app never registered is never redirected to: the person is told on the site.
    const wrong = await authorize({ response_type: 'code', client_id, redirect_uri: 'https://evil.example/cb', code_challenge: (await pkce()).challenge, code_challenge_method: 'S256' });
    expect(wrong.toString()).toBe(`${SITE}/oauth/consent?error=invalid_redirect`);
    expect((await authorize({ response_type: 'code', client_id: 'rhc-nobody', ui_locales: 'en' })).toString()).toBe(`${SITE}/oauth/consent?error=invalid_client&lang=en`);
  });

  it('lets the person say no, or allow reading only', async () => {
    const { client_id } = await register();
    const { challenge } = await pkce();
    const consent = await authorize({ response_type: 'code', client_id, redirect_uri: CALLBACK, state: 'st', code_challenge: challenge, code_challenge_method: 'S256' });
    const id = consent.searchParams.get('request')!;
    // Only the person on the site's own pages sees the request: never nobody, never a token.
    expect((await json(`/v1/oauth/requests/${id}`)).status).toBe(401);
    const shown = await json(`/v1/oauth/requests/${id}`, { headers: { 'X-Test-Account': me } });
    expect(shown.body).toMatchObject({ client: { name: 'Claude', kind: 'registered' }, redirectHost: 'claude.ai', scopes: ['read', 'write'], loopback: false });
    const denied = await json(`/v1/oauth/requests/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Test-Account': me }, body: JSON.stringify({ approve: false }) });
    const back = new URL(denied.body.redirect);
    expect(back.origin + back.pathname).toBe(CALLBACK);
    expect(back.searchParams.get('error')).toBe('access_denied');
    expect(back.searchParams.get('state')).toBe('st');
    expect(back.searchParams.get('code')).toBeNull();
    // Answered once: it is over.
    expect((await json(`/v1/oauth/requests/${id}`, { headers: { 'X-Test-Account': me } })).status).toBe(404);

    const reader = await tokensFor(client_id, { allow: ['read'] });
    expect(reader.scope).toBe('read');
    const refused = await mcp(reader.access_token, 'tools/call', { name: 'suggest_fix', arguments: { id: event, changes: { note: 'x' }, title: 'x' } });
    expect(refused.status).toBe(403);
    expect(refused.headers.get('WWW-Authenticate')).toContain('error="insufficient_scope"');
    expect((await mcp(reader.access_token, 'tools/call', { name: 'get_item', arguments: { id: event } })).body.result.isError).toBe(false);
  });

  it('turns over refresh tokens, each good once, and revokes a whole connection', async () => {
    const { client_id } = await register();
    const first = await tokensFor(client_id);
    const refreshed = await json('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id, resource: `${API}/mcp` }));
    expect(refreshed.status).toBe(200);
    expect(refreshed.headers.get('Cache-Control')).toBe('no-store');
    expect(refreshed.body.refresh_token).not.toBe(first.refresh_token);
    expect((await mcp(first.access_token, 'ping')).status).toBe(401);
    expect((await mcp(refreshed.body.access_token, 'ping')).status).toBe(200);
    expect((await json('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id }))).body.error).toBe('invalid_grant');
    // Narrowed, never widened.
    const narrowed = await json('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: refreshed.body.refresh_token, client_id, scope: 'read' }));
    expect(narrowed.body.scope).toBe('read');
    expect((await json('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: narrowed.body.refresh_token, client_id, scope: 'read write' }))).body.error).toBe('invalid_scope');

    // Expired access tokens are refused; the refresh token still works.
    await catalog.db.query("UPDATE auth.oauth_connection SET access_expires_at = now() - interval '1 second'");
    expect((await mcp(narrowed.body.access_token, 'ping')).status).toBe(401);

    const revoked = await request('/oauth/revoke', form({ token: narrowed.body.refresh_token, client_id }));
    expect(revoked.status).toBe(200);
    expect((await json('/oauth/token', form({ grant_type: 'refresh_token', refresh_token: narrowed.body.refresh_token, client_id }))).body.error).toBe('invalid_grant');
    // Unknown tokens are no error.
    expect((await request('/oauth/revoke', form({ token: 'nothing' }))).status).toBe(200);
  });

  it('keeps a token given for the MCP server to it, and a connection for the whole API opens the API', async () => {
    const { client_id } = await register();
    const forMcp = await tokensFor(client_id);
    expect((await json('/v1/follows', { headers: { Authorization: `Bearer ${forMcp.access_token}` } })).status).toBe(401);
    const whole = await tokensFor(client_id, { resource: API });
    expect((await json('/v1/follows', { headers: { Authorization: `Bearer ${whole.access_token}` } })).status).toBe(200);
    // Never sign-in, tokens, stewards' tools, or answering another app's request.
    expect((await json('/v1/tokens', { headers: { Authorization: `Bearer ${whole.access_token}` } })).status).toBe(403);
    expect((await json('/v1/oauth/requests/oar-x', { headers: { Authorization: `Bearer ${whole.access_token}` } })).status).toBe(403);
  });

  it('checks the secret of an app that registered with one', async () => {
    const client = await register({ token_endpoint_auth_method: 'client_secret_basic' });
    expect(client.client_secret).toMatch(/^rhs_/);
    const { code, verifier } = await codeFor(client.client_id);
    const fields = { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: CALLBACK };
    expect((await json('/oauth/token', form({ ...fields, client_id: client.client_id }))).status).toBe(401);
    const basic = `Basic ${btoa(`${client.client_id}:${client.client_secret}`)}`;
    const good = await json('/oauth/token', { ...form(fields), headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basic } });
    expect(good.status).toBe(200);
  });

  it('knows an app by the address of its own description (Client ID Metadata Document), any port on this computer', async () => {
    const tokens = await tokensFor(CIMD, { redirect: 'http://127.0.0.1:54321/callback' });
    expect(tokens.access_token).toMatch(/^rho_/);
    expect(fetched).toEqual([CIMD]);
    const { challenge } = await pkce();
    const consent = await authorize({ response_type: 'code', client_id: CIMD, redirect_uri: 'http://127.0.0.1:1/callback', code_challenge: challenge, code_challenge_method: 'S256' });
    const shown = await json(`/v1/oauth/requests/${consent.searchParams.get('request')}`, { headers: { 'X-Test-Account': me } });
    // Anyone's program on the person's computer could claim this name: the page says so.
    expect(shown.body).toMatchObject({ client: { name: 'Example Agent', kind: 'metadata', host: 'client.example.test' }, loopback: true, redirectHost: '127.0.0.1:1' });
    expect((await authorize({ response_type: 'code', client_id: 'https://client.example.test/other.json' })).searchParams.get('error')).toBe('invalid_client');
    expect((await authorize({ response_type: 'code', client_id: 'https://localhost/client.json' })).searchParams.get('error')).toBe('invalid_client');
  });

  it("ends a suspended person's connections", async () => {
    const { client_id } = await register();
    const tokens = await tokensFor(client_id);
    const steward = (await createPerson(catalog.db, 'Steward')).id;
    await catalog.db.query('UPDATE auth.person SET steward = true WHERE id = $1', [steward]);
    await catalog.createAccount({ id: steward, displayName: 'Steward' });
    await catalog.db.query('UPDATE account SET is_steward = true WHERE id = $1', [steward]);
    const suspended = await json(`/v1/admin/people/${me}/suspend`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Test-Account': steward }, body: JSON.stringify({ on: true, reason: 'test' }) });
    expect(suspended.status).toBe(200);
    expect((await mcp(tokens.access_token, 'ping')).status).toBe(401);
  });
});
