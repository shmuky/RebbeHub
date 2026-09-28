import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import {
  SESSION_DAYS,
  addPasskey,
  cleanDisplayName,
  createPerson,
  endSession,
  findPasskey,
  getPerson,
  passkeyUsed,
  passkeysOf,
  saveChallenge,
  sessionPerson,
  startSession,
  takeChallenge,
  type Catalog,
} from '@rebbehub/core';

/**
 * Signing in with a passkey (docs/plans/rebbehub.md, section 7: a
 * Contributor signs in with a passkey, an email link or Google). The site
 * (rebbehub.org) passes /_/auth/* through to these routes, so the browser
 * talks to one address and the session cookie is the site's own:
 * HttpOnly, Secure, SameSite=Lax, holding a token of which only the hash
 * is kept. A request that changes anything must come from the site's own
 * pages (its Origin), so another site cannot act for a signed-in reader.
 */

export interface AuthOptions {
  /** The relying party: the site's domain (`rebbehub.org`), which passkeys are bound to. */
  rpId: string;
  rpName: string;
  /** The site's own addresses (`https://rebbehub.org`), where ceremonies may happen and changes may come from. */
  origins: string[];
  /** Replaces the WebAuthn verification, for tests; everything else runs as in production. */
  verify?: {
    registration: (input: { response: RegistrationResponseJSON; challenge: string }) => Promise<{ credentialId: string; publicKey: string; counter: number; transports: string[]; deviceType?: string; backedUp?: boolean } | null>;
    authentication: (input: { response: AuthenticationResponseJSON; challenge: string; publicKey: string; counter: number }) => Promise<{ counter: number } | null>;
  };
}

export const SESSION_COOKIE = '__Host-rh_session';

/** Sign-in for a site at `siteUrl`: its host is the passkeys' domain, its origin the only place sign-in happens. */
export function authFor(siteUrl: string): AuthOptions {
  const url = new URL(siteUrl);
  return { rpId: url.hostname, rpName: 'RebbeHub', origins: [url.origin] };
}

/** Plain `http://localhost` cannot keep a `__Host-` (Secure) cookie in every browser; local development uses a plain name. */
const cookieName = (c: Context) => (new URL(c.req.url).protocol === 'https:' || c.req.header('X-Forwarded-Proto') === 'https' ? SESSION_COOKIE : 'rh_session');

function readSession(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE) ?? getCookie(c, 'rh_session');
}

/** A change may come only from the site's own pages; a request without an Origin (not a browser's) carries no cookie of the site's. */
function fromOwnPages(c: Context, origins: string[]): boolean {
  if (c.req.method === 'GET' || c.req.method === 'HEAD') return true;
  const origin = c.req.header('Origin');
  return origin === undefined || origins.includes(origin);
}

/**
 * The account a request is signed in as, from the session cookie: the
 * person's id, with their catalog account (public.account) made again when
 * a rebuild of the catalog has dropped it.
 */
export function sessionAuthenticator(catalog: Catalog, auth: AuthOptions) {
  return async (c: Context): Promise<string | null> => {
    const token = readSession(c);
    if (!token || !fromOwnPages(c, auth.origins)) return null;
    const person = await sessionPerson(catalog.db, token);
    if (!person) return null;
    await catalog.createAccount({ id: person.id, displayName: person.displayName });
    return person.id;
  };
}

const defaultVerify = (auth: AuthOptions): NonNullable<AuthOptions['verify']> => ({
  async registration({ response, challenge }) {
    const result = await verifyRegistrationResponse({ response, expectedChallenge: challenge, expectedOrigin: auth.origins, expectedRPID: auth.rpId, requireUserVerification: false });
    if (!result.verified) return null;
    const { credential, credentialDeviceType, credentialBackedUp } = result.registrationInfo;
    return {
      credentialId: credential.id,
      publicKey: isoBase64URL.fromBuffer(credential.publicKey),
      counter: credential.counter,
      transports: credential.transports ?? [],
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
    };
  },
  async authentication({ response, challenge, publicKey, counter }) {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: auth.origins,
      expectedRPID: auth.rpId,
      credential: { id: response.id, publicKey: isoBase64URL.toBuffer(publicKey), counter },
      requireUserVerification: false,
    });
    return result.verified ? { counter: result.authenticationInfo.newCounter } : null;
  },
});

export function authRoutes(app: Hono, catalog: Catalog, auth: AuthOptions): void {
  const verify = auth.verify ?? defaultVerify(auth);
  const db = catalog.db;

  const refuse = (c: Context, status: 400 | 401 | 403, message: string) => c.json({ error: status === 403 ? 'forbidden' : 'bad-request', message }, status);

  const signIn = async (c: Context, personId: string) => {
    const token = await startSession(db, personId, c.req.header('User-Agent'));
    setCookie(c, cookieName(c), token, { httpOnly: true, secure: cookieName(c) === SESSION_COOKIE, sameSite: 'Lax', path: '/', maxAge: SESSION_DAYS * 86_400 });
  };

  // Every route here answers only this browser; nothing may be cached or shared.
  app.use('/v1/auth/*', async (c, next) => {
    if (!fromOwnPages(c, auth.origins)) return refuse(c, 403, "sign-in happens on the site's own pages");
    await next();
    c.header('Cache-Control', 'no-store');
  });

  app.get('/v1/auth/me', async (c) => {
    const token = readSession(c);
    const person = token ? await sessionPerson(db, token) : null;
    if (!person) return c.json({ person: null });
    return c.json({ person, passkeys: await passkeysOf(db, person.id) });
  });

  // A new account: the name they go by, and a passkey made on their device for this site.
  app.post('/v1/auth/passkey/register/options', async (c) => {
    const { name } = (await c.req.json().catch(() => ({}))) as { name?: unknown };
    const displayName = cleanDisplayName(name);
    if (!displayName) return refuse(c, 400, 'a name of 1 to 60 characters');
    const options = await generateRegistrationOptions({
      rpName: auth.rpName,
      rpID: auth.rpId,
      userName: displayName,
      userDisplayName: displayName,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    const challengeId = await saveChallenge(db, options.challenge, 'register');
    return c.json({ challengeId, options });
  });

  app.post('/v1/auth/passkey/register/verify', async (c) => {
    const input = (await c.req.json().catch(() => ({}))) as { challengeId?: string; name?: unknown; response?: RegistrationResponseJSON };
    const displayName = cleanDisplayName(input.name);
    if (!displayName || !input.challengeId || !input.response) return refuse(c, 400, 'give challengeId, name and response');
    const challenge = await takeChallenge(db, input.challengeId, 'register');
    if (!challenge) return refuse(c, 400, 'that request has expired; try again');
    const credential = await verify.registration({ response: input.response, challenge }).catch(() => null);
    if (!credential) return refuse(c, 400, 'the passkey could not be verified');
    if (await findPasskey(db, credential.credentialId)) return refuse(c, 400, 'this passkey already belongs to an account; sign in with it');
    const person = await createPerson(db, displayName);
    await addPasskey(db, { ...credential, personId: person.id });
    await signIn(c, person.id);
    return c.json({ person }, 201);
  });

  // Signing in: the browser offers the passkeys it holds for this site, and the person picks one.
  app.post('/v1/auth/passkey/sign-in/options', async (c) => {
    const options = await generateAuthenticationOptions({ rpID: auth.rpId, userVerification: 'preferred' });
    const challengeId = await saveChallenge(db, options.challenge, 'sign-in');
    return c.json({ challengeId, options });
  });

  app.post('/v1/auth/passkey/sign-in/verify', async (c) => {
    const input = (await c.req.json().catch(() => ({}))) as { challengeId?: string; response?: AuthenticationResponseJSON };
    if (!input.challengeId || !input.response?.id) return refuse(c, 400, 'give challengeId and response');
    const challenge = await takeChallenge(db, input.challengeId, 'sign-in');
    if (!challenge) return refuse(c, 400, 'that request has expired; try again');
    const passkey = await findPasskey(db, input.response.id);
    if (!passkey) return refuse(c, 401, 'this passkey is not known here; create an account with it');
    const result = await verify.authentication({ response: input.response, challenge, publicKey: passkey.publicKey, counter: passkey.counter }).catch(() => null);
    if (!result) return refuse(c, 401, 'the passkey could not be verified');
    await passkeyUsed(db, passkey.credentialId, result.counter);
    await signIn(c, passkey.personId);
    return c.json({ person: await getPerson(db, passkey.personId) });
  });

  app.post('/v1/auth/sign-out', async (c) => {
    const token = readSession(c);
    if (token) await endSession(db, token);
    deleteCookie(c, cookieName(c), { path: '/', secure: cookieName(c) === SESSION_COOKIE });
    return c.json({ signedOut: true });
  });
}
