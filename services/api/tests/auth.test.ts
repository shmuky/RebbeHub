import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createApp } from '../src/app.js';
import type { AuthOptions } from '../src/auth.js';
import { freshCatalog } from '../../../packages/core/tests/helpers.js';

/**
 * Passkey sign-in over the API. The WebAuthn verification is replaced by a
 * stand-in (a browser's authenticator cannot run here); everything around
 * it - challenges, accounts, passkeys, sessions, the cookie, the Origin
 * check - runs as in production.
 */

const SITE = 'https://rebbehub.test';
let app: Hono;
let catalog: Awaited<ReturnType<typeof freshCatalog>>['catalog'];

const verify: NonNullable<AuthOptions['verify']> = {
  // A registration "verifies" when the response names a credential; its public key is made up.
  registration: async ({ response }) => (response.id ? { credentialId: response.id, publicKey: 'pk', counter: 0, transports: ['internal'] } : null),
  // An assertion verifies when it says so, and moves the counter on.
  authentication: async ({ response, counter }) => ((response as { ok?: boolean }).ok ? { counter: counter + 1 } : null),
};

beforeEach(async () => {
  ({ catalog } = await freshCatalog());
  app = createApp({
    catalog,
    auth: {
      rpId: 'rebbehub.test',
      rpName: 'RebbeHub',
      origins: [SITE],
      verify,
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

  it('adds a passkey to the account signed in, and not without one', async () => {
    const { cookie, body } = await register('Mendy', 'cred-1');
    expect((await call('POST', '/v1/auth/passkey/add/options')).status).toBe(401);
    const options = await call('POST', '/v1/auth/passkey/add/options', { cookie });
    expect(options.body.options.excludeCredentials).toEqual([expect.objectContaining({ id: 'cred-1' })]);
    const added = await call('POST', '/v1/auth/passkey/add/verify', { cookie, body: { challengeId: options.body.challengeId, response: { id: 'cred-2' } } });
    expect(added.status).toBe(201);
    expect(added.body.passkeys).toHaveLength(2);
    const again = await call('POST', '/v1/auth/passkey/add/options', { cookie });
    expect((await call('POST', '/v1/auth/passkey/add/verify', { cookie, body: { challengeId: again.body.challengeId, response: { id: 'cred-2' } } })).status).toBe(400);

    const start = async () => (await call('POST', '/v1/auth/passkey/sign-in/options')).body.challengeId as string;
    const signedIn = await call('POST', '/v1/auth/passkey/sign-in/verify', { body: { challengeId: await start(), response: { id: 'cred-2', ok: true } } });
    expect(signedIn.body.person.id).toBe(body.person.id);
  });

  it('will not make a second account for someone signed in', async () => {
    const { cookie } = await register('Mendy');
    expect(await call('POST', '/v1/auth/passkey/register/options', { cookie, body: { name: 'Mendy' } })).toMatchObject({ status: 400, body: { message: 'you are signed in; add a passkey from your account page' } });
  });

  it('keeps a steward a steward when the catalog is rebuilt', async () => {
    const created = await register('Mendy');
    await catalog.db.query('UPDATE auth.person SET steward = TRUE WHERE id = $1', [created.body.person.id]);
    await catalog.db.query('DELETE FROM account WHERE id = $1', [created.body.person.id]);
    await call('POST', '/v1/suggestions', { body: { title: 'A fix' }, cookie: created.cookie });
    expect((await catalog.account(created.body.person.id))?.is_steward).toBe(true);
    expect((await call('GET', '/v1/auth/me', { cookie: created.cookie })).body.person.steward).toBe(true);
  });

  it('changes the name a person goes by', async () => {
    const { cookie } = await register('Mendy');
    expect((await call('POST', '/v1/auth/name', { body: { name: 'Menachem Mendel' } })).status).toBe(401);
    expect((await call('POST', '/v1/auth/name', { cookie, body: { name: ' ' } })).status).toBe(400);
    expect((await call('POST', '/v1/auth/name', { cookie, body: { name: '  Menachem   Mendel ' } })).body.person.displayName).toBe('Menachem Mendel');
    expect((await call('GET', '/v1/auth/me', { cookie })).body.person.displayName).toBe('Menachem Mendel');
  });

  it('lets a signed-in person make a suggestion, as the account the catalog knows them by', async () => {
    const created = await register('Mendy Cohen');
    const suggestion = await call('POST', '/v1/suggestions', { body: { title: 'A fix' }, cookie: created.cookie });
    expect(suggestion.status).toBe(201);
    expect(suggestion.body.author).toBe(created.body.person.id);
  });
});

/**
 * Google sign-in. Google itself is replaced by a stand-in token endpoint
 * that hands back an ID token for whichever code it is given; the state,
 * the cookie that ties it to the browser, PKCE, and the checks on the
 * token run as in production.
 */
describe('Google sign-in', () => {
  const CLIENT = 'client-1.apps.googleusercontent.com';
  let tokenRequests: URLSearchParams[];
  /** What Google says about whoever signs in next. */
  let claims: Record<string, unknown>;

  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

  beforeEach(async () => {
    tokenRequests = [];
    claims = {};
    const { catalog } = await freshCatalog();
    app = createApp({
      catalog,
      auth: {
        rpId: 'rebbehub.test',
        rpName: 'RebbeHub',
        origins: [SITE],
        verify,
        google: {
          clientId: CLIENT,
          clientSecret: 'secret',
          fetch: async (_url, init) => {
            const form = new URLSearchParams(String(init?.body));
            tokenRequests.push(form);
            if (form.get('code') !== 'good-code') return new Response('{}', { status: 400 });
            const payload = { iss: 'https://accounts.google.com', aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 600, sub: 'g-1', email: 'mendy@example.com', email_verified: true, name: 'Mendy Cohen', ...claims };
            return Response.json({ id_token: `${encode({ alg: 'RS256' })}.${encode(payload)}.sig` });
          },
        },
      },
    });
  });

  /** Leaves for Google and comes back with `code`, as a browser would. */
  async function viaGoogle(options: { code?: string; cookie?: string; tamper?: (nonce: string) => void } = {}) {
    const start = await app.request(`${SITE}/v1/auth/google/start?return=/events/5742-05-10`, { headers: options.cookie ? { Cookie: options.cookie } : {} });
    expect(start.status).toBe(302);
    const google = new URL(start.headers.get('Location')!);
    const state = google.searchParams.get('state')!;
    claims.nonce ??= google.searchParams.get('nonce');
    const stateCookie = start.headers.getSetCookie()[0]!.split(';')[0]!;
    const cookie = [stateCookie, options.cookie].filter(Boolean).join('; ');
    const back = await app.request(`${SITE}/v1/auth/google/callback?state=${state}&code=${options.code ?? 'good-code'}`, { headers: { Cookie: cookie } });
    const session = back.headers.getSetCookie().find((c) => c.startsWith('__Host-rh_session='));
    return { google, back, location: back.headers.get('Location'), cookie: session?.split(';')[0] };
  }

  it('sends the browser to Google with state, a nonce and PKCE, and says so in /me', async () => {
    const start = await app.request(`${SITE}/v1/auth/google/start`);
    const google = new URL(start.headers.get('Location')!);
    expect(google.origin + google.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(google.searchParams)).toMatchObject({ client_id: CLIENT, redirect_uri: `${SITE}/_/auth/google/callback`, response_type: 'code', scope: 'openid email profile', code_challenge_method: 'S256' });
    expect(start.headers.getSetCookie()[0]).toMatch(/^__Host-rh_google=[\w-]+;.*HttpOnly/);
    expect((await call('GET', '/v1/auth/me')).body.google).toBe(true);
  });

  it('makes an account named as on Google the first time, and signs the same one in after', async () => {
    const first = await viaGoogle();
    expect(first.location).toBe('/events/5742-05-10');
    expect(tokenRequests[0]!.get('code_verifier')).toMatch(/^[\w-]{43}$/);
    const me = (await call('GET', '/v1/auth/me', { cookie: first.cookie })).body;
    expect(me.person.displayName).toBe('Mendy Cohen');
    expect(me.googleAccounts).toEqual([expect.objectContaining({ email: 'mendy@example.com' })]);

    claims = {};
    const again = await viaGoogle();
    expect((await call('GET', '/v1/auth/me', { cookie: again.cookie })).body.person.id).toBe(me.person.id);
  });

  it('adds Google to the account already signed in', async () => {
    const created = await register('Mendy');
    const linked = await viaGoogle({ cookie: created.cookie });
    const me = (await call('GET', '/v1/auth/me', { cookie: linked.cookie })).body;
    expect(me.person.id).toBe(created.body.person.id);
    expect(me.googleAccounts).toHaveLength(1);
  });

  it('never switches a signed-in person to the account their Google account already belongs to', async () => {
    const first = await viaGoogle();
    const other = await register('Someone', 'cred-9');
    claims = {};
    const linking = await viaGoogle({ cookie: other.cookie });
    expect(linking.location).toBe('/account?error=google-taken');
    expect(linking.cookie).toBeUndefined();
    expect((await call('GET', '/v1/auth/me', { cookie: other.cookie })).body.googleAccounts).toEqual([]);
    expect((await call('GET', '/v1/auth/me', { cookie: first.cookie })).body.googleAccounts).toHaveLength(1);
  });

  it('refuses a code Google does not know, a token for another site or nonce, and a browser that did not start here', async () => {
    expect((await viaGoogle({ code: 'bad-code' })).location).toBe('/signin?error=google-failed');
    claims = { aud: 'someone-else' };
    expect((await viaGoogle()).location).toBe('/signin?error=google-failed');
    claims = { nonce: 'another' };
    expect((await viaGoogle()).location).toBe('/signin?error=google-failed');

    // Another person's link back from Google, opened in this browser, signs nobody in.
    const start = await app.request(`${SITE}/v1/auth/google/start`);
    const state = new URL(start.headers.get('Location')!).searchParams.get('state');
    const back = await app.request(`${SITE}/v1/auth/google/callback?state=${state}&code=good-code`);
    expect(back.headers.get('Location')).toBe('/signin?error=google-cancelled');
    expect(tokenRequests).toHaveLength(3);
  });

  it('is off without the keys, and never returns to another site', async () => {
    expect((await call('GET', '/v1/auth/me')).body.google).toBe(true);
    const start = await app.request(`${SITE}/v1/auth/google/start?return=//evil.test`);
    const state = new URL(start.headers.get('Location')!).searchParams.get('state')!;
    claims.nonce = new URL(start.headers.get('Location')!).searchParams.get('nonce');
    const back = await app.request(`${SITE}/v1/auth/google/callback?state=${state}&code=good-code`, { headers: { Cookie: start.headers.getSetCookie()[0]!.split(';')[0]! } });
    expect(back.headers.get('Location')).toBe('/account');

    const { catalog } = await freshCatalog();
    const without = createApp({ catalog, auth: { rpId: 'rebbehub.test', rpName: 'RebbeHub', origins: [SITE] } });
    expect((await without.request(`${SITE}/v1/auth/google/start`)).headers.get('Location')).toBe('/signin?error=google-off');
  });
});
