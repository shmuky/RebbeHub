import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createPerson, setPersonRole, type Catalog } from '@rebbehub/core';
import { createApp } from '../src/app.js';
import { keyFrom, keyOf, lockOf, opens, unlocked } from '../src/lock.js';
import { freshCatalog } from '../../../packages/core/tests/helpers.js';

/**
 * RebbeHub is private for now (src/lock.ts): the key opens everything; without
 * it, only an owner's token (a platform admin, or an account named as owner),
 * and connecting an app so his MCP connector can connect again.
 */

let catalog: Catalog;
let owner: string;
let someone: string;
let ownerToken: string;
let otherToken: string;

const appFor = (owners: string[] = []): Hono => createApp({ catalog, authenticate: (c) => c.req.header('X-Test-Account') ?? null, privateTo: { owners } });

async function tokenOf(person: string): Promise<string> {
  const open = createApp({ catalog, authenticate: (c) => c.req.header('X-Test-Account') ?? null });
  const made = await open.request('/v1/tokens', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Test-Account': person }, body: JSON.stringify({ name: 'mcp', scopes: ['read', 'write'] }) });
  return ((await made.json()) as { token: string }).token;
}

beforeEach(async () => {
  catalog = (await freshCatalog()).catalog;
  owner = (await createPerson(catalog.db, 'Shmuly', 'shmuly')).id;
  someone = (await createPerson(catalog.db, 'Someone', 'someone')).id;
  await setPersonRole(catalog.db, owner, { admin: true });
  ownerToken = await tokenOf(owner);
  otherToken = await tokenOf(someone);
});

describe('the lock', () => {
  it('opens with the key made from the password, never the password itself', async () => {
    const lock = (await lockOf({ LOCK_PASSWORD: 'abcde-fghjk' }))!;
    const key = await keyOf('abcde-fghjk');
    expect(await opens(key, lock)).toBe(true);
    expect(await opens(await keyOf('abcde-fghjx'), lock)).toBe(false);
    expect(await opens('abcde-fghjk', lock)).toBe(false);
    expect(await lockOf({ LOCK_KEY_HASH: lock.toUpperCase() })).toBe(lock);
    expect(await lockOf({})).toBeNull();
  });

  it('reads the key from the header or the cookie', () => {
    const key = 'a'.repeat(64);
    expect(keyFrom(new Request('https://x/', { headers: { 'x-rebbehub-key': key } }))).toBe(key);
    expect(keyFrom(new Request('https://x/', { headers: { cookie: `a=b; __Secure-rh_lock=${key}` } }))).toBe(key);
    expect(keyFrom(new Request('https://x/'))).toBeNull();
  });
});

describe('the API while private', () => {
  it('turns away anyone without a token, and tells an MCP client how to connect', async () => {
    const app = appFor();
    expect((await app.request('/v1')).status).toBe(401);
    const mcp = await app.request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    expect(mcp.status).toBe(401);
    expect(mcp.headers.get('WWW-Authenticate')).toMatch(/resource_metadata=/);
    expect(mcp.headers.get('Cache-Control')).toBe('no-store');
  });

  it("answers a platform admin's token, and refuses anyone else's", async () => {
    const app = appFor();
    expect((await app.request('/v1', { headers: { Authorization: `Bearer ${ownerToken}` } })).status).toBe(200);
    expect((await app.request('/v1', { headers: { Authorization: `Bearer ${otherToken}` } })).status).toBe(403);
  });

  it('answers an account named as owner', async () => {
    expect((await appFor([someone]).request('/v1', { headers: { Authorization: `Bearer ${otherToken}` } })).status).toBe(200);
  });

  it('answers whoever showed the key at the door', async () => {
    const request = new Request('http://localhost/v1');
    unlocked.add(request);
    expect((await appFor().fetch(request)).status).toBe(200);
  });

  it('keeps connecting an app open', async () => {
    expect((await appFor().request('/.well-known/oauth-protected-resource/mcp')).status).toBe(200);
  });
});
