import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createApp } from '../src/app.js';
import { freshCatalog } from '../../../packages/core/tests/helpers.js';

/**
 * Passkey sign-in over the API. The WebAuthn verification is replaced by a
 * stand-in (a browser's authenticator cannot run here); everything around
 * it - challenges, accounts, passkeys, sessions, the cookie, the Origin
 * check - runs as in production.
 */

const SITE = 'https://rebbehub.test';
let app: Hono;

beforeEach(async () => {
  const { catalog } = await freshCatalog();
  app = createApp({
    catalog,
    auth: {
      rpId: 'rebbehub.test',
      rpName: 'RebbeHub',
      origins: [SITE],
      verify: {
        // A registration "verifies" when the response names a credential; its public key is made up.
        registration: async ({ response }) => (response.id ? { credentialId: response.id, publicKey: 'pk', counter: 0, transports: ['internal'] } : null),
        // An assertion verifies when it says so, and moves the counter on.
        authentication: async ({ response, counter }) => ((response as { ok?: boolean }).ok ? { counter: counter + 1 } : null),
      },
    },
  });
});

const call = async (method: string, path: string, options: { body?: unknown; cookie?: string; origin?: string | null } = {}) => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.origin !== null) headers.Origin = options.origin ?? SITE;
  if (options.cookie) headers.Cookie = options.cookie;
  const response = await app.request(`${SITE}${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) });
  const setCookie = response.headers.get('Set-Cookie');
  return { status: response.status, body: (await response.json()) as any, cookie: setCookie?.split(';')[0], setCookie };
};

async function register(name = 'Mendy', credential = 'cred-1') {
  const { body } = await call('POST', '/v1/auth/passkey/register/options', { body: { name } });
  return call('POST', '/v1/auth/passkey/register/verify', { body: { challengeId: body.challengeId, name, response: { id: credential } } });
}

describe('passkey sign-in', () => {
  it('makes an account with a passkey and signs it in, with a secure cookie', async () => {
    const options = await call('POST', '/v1/auth/passkey/register/options', { body: { name: '  Mendy   Cohen ' } });
    expect(options.status).toBe(200);
    expect(options.body.options).toMatchObject({ rp: { id: 'rebbehub.test', name: 'RebbeHub' }, user: { name: 'Mendy Cohen' } });

    const created = await call('POST', '/v1/auth/passkey/register/verify', { body: { challengeId: options.body.challengeId, name: 'Mendy Cohen', response: { id: 'cred-1' } } });
    expect(created.status).toBe(201);
    expect(created.body.person).toMatchObject({ displayName: 'Mendy Cohen' });
    expect(created.body.person.id).toMatch(/^u-[0-9a-z]{10}$/);
    expect(created.setCookie).toMatch(/^__Host-rh_session=[\w-]{43};/);
    expect(created.setCookie).toMatch(/HttpOnly/);
    expect(created.setCookie).toMatch(/Secure/);
    expect(created.setCookie).toMatch(/SameSite=Lax/);

    const me = await call('GET', '/v1/auth/me', { cookie: created.cookie });
    expect(me.body.person).toEqual(created.body.person);
    expect(me.body.passkeys).toHaveLength(1);
  });

  it('refuses a name that is empty or too long, and a challenge answered twice', async () => {
    expect((await call('POST', '/v1/auth/passkey/register/options', { body: { name: ' ' } })).status).toBe(400);
    expect((await call('POST', '/v1/auth/passkey/register/options', { body: { name: 'x'.repeat(61) } })).status).toBe(400);
    const { body } = await call('POST', '/v1/auth/passkey/register/options', { body: { name: 'Mendy' } });
    const answer = { challengeId: body.challengeId, name: 'Mendy', response: { id: 'cred-1' } };
    expect((await call('POST', '/v1/auth/passkey/register/verify', { body: answer })).status).toBe(201);
    expect(await call('POST', '/v1/auth/passkey/register/verify', { body: answer })).toMatchObject({ status: 400, body: { message: 'that request has expired; try again' } });
  });

  it('will not give one passkey two accounts', async () => {
    await register('Mendy', 'cred-1');
    expect(await register('Someone else', 'cred-1')).toMatchObject({ status: 400 });
  });

  it('signs in with a known passkey, and not with an unknown or unverified one', async () => {
    const created = await register();
    const start = async () => (await call('POST', '/v1/auth/passkey/sign-in/options')).body.challengeId as string;

    const unknown = await call('POST', '/v1/auth/passkey/sign-in/verify', { body: { challengeId: await start(), response: { id: 'cred-9', ok: true } } });
    expect(unknown.status).toBe(401);
    const unverified = await call('POST', '/v1/auth/passkey/sign-in/verify', { body: { challengeId: await start(), response: { id: 'cred-1', ok: false } } });
    expect(unverified.status).toBe(401);

    const signedIn = await call('POST', '/v1/auth/passkey/sign-in/verify', { body: { challengeId: await start(), response: { id: 'cred-1', ok: true } } });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.person.id).toBe(created.body.person.id);
    expect(signedIn.cookie).not.toBe(created.cookie); // a new session, not the old one again
    expect((await call('GET', '/v1/auth/me', { cookie: signedIn.cookie })).body.person.id).toBe(created.body.person.id);
  });

  it('signs out: the session ends and the cookie goes', async () => {
    const { cookie } = await register();
    const out = await call('POST', '/v1/auth/sign-out', { cookie });
    expect(out.setCookie).toMatch(/Max-Age=0/);
    expect((await call('GET', '/v1/auth/me', { cookie })).body.person).toBeNull();
  });

  it('takes changes only from the site’s own pages', async () => {
    expect((await call('POST', '/v1/auth/passkey/register/options', { body: { name: 'Mendy' }, origin: 'https://elsewhere.test' })).status).toBe(403);
    const { cookie } = await register();
    // Another site's page cannot make a suggestion in a signed-in reader's name.
    expect((await call('POST', '/v1/suggestions', { body: { title: 'x' }, cookie, origin: 'https://elsewhere.test' })).status).toBe(401);
  });

  it('lets a signed-in person make a suggestion, as the account the catalog knows them by', async () => {
    const created = await register('Mendy Cohen');
    const suggestion = await call('POST', '/v1/suggestions', { body: { title: 'A fix' }, cookie: created.cookie });
    expect(suggestion.status).toBe(201);
    expect(suggestion.body.author).toBe(created.body.person.id);
  });
});
