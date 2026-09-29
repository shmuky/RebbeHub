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
  CatalogError,
  checkUsername,
  setUsername,
  suggestUsername,
  unreadCount,
  usernameMessage,
  addEmail,
  addPasskey,
  cleanDisplayName,
  cleanEmail,
  emailsOf,
  notificationSetting,
  peekEmailLink,
  personByEmail,
  setNotifications,
  signInMessage,
  startEmailLink,
  takeEmailLink,
  unsubscribe,
  type Mailer,
  type NotificationMode,
  createPerson,
  endSession,
  findPasskey,
  getPerson,
  googleAccountsOf,
  googleSignedIn,
  linkGoogle,
  passkeyUsed,
  passkeysOf,
  renamePerson,
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
  /** Signing in with Google, once the site has a Google sign-in client (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET); without it, only passkeys. */
  google?: GoogleOptions;
  /** Sends sign-in links by email, once the site can send email (RESEND_API_KEY); without it, no email sign-in and no notifications. */
  mailer?: Mailer;
  /** Replaces the WebAuthn verification, for tests; everything else runs as in production. */
  verify?: {
    registration: (input: { response: RegistrationResponseJSON; challenge: string }) => Promise<{ credentialId: string; publicKey: string; counter: number; transports: string[]; deviceType?: string; backedUp?: boolean } | null>;
    authentication: (input: { response: AuthenticationResponseJSON; challenge: string; publicKey: string; counter: number }) => Promise<{ counter: number } | null>;
  };
}

export interface GoogleOptions {
  clientId: string;
  clientSecret: string;
  /** Reaches Google's token endpoint; replaced in tests. */
  fetch?: typeof fetch;
}

export const SESSION_COOKIE = '__Host-rh_session';
/** Holds a Google sign-in's state between leaving for Google and coming back, so only the browser that left can come back signed in. */
export const GOOGLE_COOKIE = '__Host-rh_google';

const GOOGLE_AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';

/** Sign-in for a site at `siteUrl`: its host is the passkeys' domain, its origin the only place sign-in happens. */
export function authFor(siteUrl: string, google?: { clientId?: string; clientSecret?: string }, mailer?: Mailer): AuthOptions {
  const url = new URL(siteUrl);
  const withGoogle = google?.clientId && google.clientSecret ? { google: { clientId: google.clientId, clientSecret: google.clientSecret } } : {};
  return { rpId: url.hostname, rpName: 'RebbeHub', origins: [url.origin], ...withGoogle, ...(mailer ? { mailer } : {}) };
}

/** Plain `http://localhost` cannot keep a `__Host-` (Secure) cookie in every browser; local development uses a plain name. */
const secure = (c: Context) => new URL(c.req.url).protocol === 'https:' || c.req.header('X-Forwarded-Proto') === 'https';
const cookieName = (c: Context) => (secure(c) ? SESSION_COOKIE : 'rh_session');
const googleCookieName = (c: Context) => (secure(c) ? GOOGLE_COOKIE : 'rh_google');

function readSession(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE) ?? getCookie(c, 'rh_session');
}

/** Only an address on the site may be returned to after signing in. */
function safeReturn(value: string | undefined): string {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/account';
}

function randomText(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return isoBase64URL.fromBuffer(b);
}

async function sha256(text: string): Promise<string> {
  return isoBase64URL.fromBuffer(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

/** What Google says about the person, from the ID token its token endpoint gave us. */
interface GoogleClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
}

/**
 * Trades the code Google sent back for the person's ID token. The token
 * comes straight from Google over TLS, in answer to our own secret, so its
 * signature need not be checked again (OpenID Connect Core, 3.1.3.7); its
 * audience, issuer, expiry and nonce still are.
 */
async function googleClaims(google: GoogleOptions, input: { code: string; verifier: string; nonce: string; redirectUri: string }): Promise<GoogleClaims | null> {
  const response = await (google.fetch ?? fetch)(GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      code_verifier: input.verifier,
      client_id: google.clientId,
      client_secret: google.clientSecret,
      redirect_uri: input.redirectUri,
    }),
  });
  if (!response.ok) return null;
  const { id_token } = (await response.json().catch(() => ({}))) as { id_token?: string };
  const payload = id_token?.split('.')[1];
  if (!payload) return null;
  const claims = JSON.parse(new TextDecoder().decode(isoBase64URL.toBuffer(payload))) as GoogleClaims & { aud?: string; iss?: string; exp?: number; nonce?: string };
  const fresh = typeof claims.exp === 'number' && claims.exp * 1000 > Date.now();
  const fromGoogle = claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
  if (!fresh || !fromGoogle || claims.aud !== google.clientId || claims.nonce !== input.nonce || !claims.sub) return null;
  return claims;
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
    // The person's steward mark is the one that counts; their catalog account follows it.
    await catalog.db.query('UPDATE account SET is_steward = $2 WHERE id = $1 AND is_steward <> $2', [person.id, Boolean(person.steward)]);
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
    const google = Boolean(auth.google);
    const email = Boolean(auth.mailer);
    if (!person) return c.json({ person: null, google, email });
    // Trust is the catalog's (earned by approved suggestions); a person who has not yet done anything there is a contributor.
    const account = await catalog.account(person.id);
    return c.json({
      person,
      trust: account?.trust ?? 'contributor',
      // Lines waiting in their inbox, for the count beside their name.
      unread: await unreadCount(db, person.id),
      passkeys: await passkeysOf(db, person.id),
      googleAccounts: await googleAccountsOf(db, person.id),
      emails: await emailsOf(db, person.id),
      notifications: await notificationSetting(db, person.id),
      google,
      email,
    });
  });

  /**
   * Whether a handle can be had, and a free one suggested from a name: what
   * the sign-up form and the account page ask while the person types.
   * Signed in, their own handle (and old ones) count as free for them.
   */
  app.get('/v1/auth/username', async (c) => {
    const current = await signedIn(c);
    const name = (c.req.query('name') ?? '').trim().replace(/^@/, '');
    const suggestion = await suggestUsername(db, cleanDisplayName(c.req.query('from')) ?? current?.displayName ?? name ?? '', current?.id);
    if (!name) return c.json({ name: null, available: false, message: null, suggestion });
    const refusal = await checkUsername(db, name, current?.id);
    return c.json({ name, available: refusal === null, reason: refusal, message: refusal ? usernameMessage(refusal) : null, suggestion });
  });

  // A signed-in person's new handle; the old one keeps leading to them.
  app.post('/v1/auth/username', async (c) => {
    const person = await signedIn(c);
    if (!person) return refuse(c, 401, 'sign in first');
    const { username } = (await c.req.json().catch(() => ({}))) as { username?: unknown };
    if (typeof username !== 'string') return refuse(c, 400, 'give the username');
    try {
      const kept = await setUsername(db, person.id, username.replace(/^@/, ''));
      return c.json({ person: { ...person, username: kept } });
    } catch (error) {
      if (error instanceof CatalogError) return refuse(c, 400, error.message);
      throw error;
    }
  });

  /** A handle given at sign-up: checked now, so the device's prompt is not wasted on one that cannot be had. */
  const chosenUsername = async (value: unknown): Promise<{ ok: true; username?: string } | { ok: false; message: string }> => {
    if (value === undefined || value === null || value === '') return { ok: true };
    if (typeof value !== 'string') return { ok: false, message: 'a username is text' };
    const name = value.trim().replace(/^@/, '');
    const refusal = await checkUsername(db, name);
    return refusal ? { ok: false, message: usernameMessage(refusal) } : { ok: true, username: name };
  };

  // A new account: the name they go by, and a passkey made on their device for this site.
  app.post('/v1/auth/passkey/register/options', async (c) => {
    // Signed in already, a new passkey goes on this account (passkey/add), never on a second one.
    const token = readSession(c);
    if (token && (await sessionPerson(db, token))) return refuse(c, 400, 'you are signed in; add a passkey from your account page');
    const { name, username } = (await c.req.json().catch(() => ({}))) as { name?: unknown; username?: unknown };
    const displayName = cleanDisplayName(name);
    if (!displayName) return refuse(c, 400, 'a name of 1 to 60 characters');
    const handle = await chosenUsername(username);
    if (!handle.ok) return refuse(c, 400, handle.message);
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
    const input = (await c.req.json().catch(() => ({}))) as { challengeId?: string; name?: unknown; username?: unknown; response?: RegistrationResponseJSON };
    const displayName = cleanDisplayName(input.name);
    if (!displayName || !input.challengeId || !input.response) return refuse(c, 400, 'give challengeId, name and response');
    const handle = await chosenUsername(input.username);
    if (!handle.ok) return refuse(c, 400, handle.message);
    const challenge = await takeChallenge(db, input.challengeId, 'register');
    if (!challenge) return refuse(c, 400, 'that request has expired; try again');
    const credential = await verify.registration({ response: input.response, challenge }).catch(() => null);
    if (!credential) return refuse(c, 400, 'the passkey could not be verified');
    if (await findPasskey(db, credential.credentialId)) return refuse(c, 400, 'this passkey already belongs to an account; sign in with it');
    const person = await createPerson(db, displayName, handle.username);
    await addPasskey(db, { ...credential, personId: person.id });
    await signIn(c, person.id);
    return c.json({ person }, 201);
  });

  // A signed-in person adds a passkey (say, after coming in with Google, or for another device).
  const signedIn = async (c: Context) => {
    const token = readSession(c);
    return token ? sessionPerson(db, token) : null;
  };

  app.post('/v1/auth/passkey/add/options', async (c) => {
    const person = await signedIn(c);
    if (!person) return refuse(c, 401, 'sign in first');
    const existing = await passkeysOf(db, person.id);
    const options = await generateRegistrationOptions({
      rpName: auth.rpName,
      rpID: auth.rpId,
      userName: person.displayName,
      userDisplayName: person.displayName,
      userID: new TextEncoder().encode(person.id),
      attestationType: 'none',
      excludeCredentials: existing.map((p) => ({ id: p.credentialId })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
    });
    const challengeId = await saveChallenge(db, options.challenge, 'register');
    return c.json({ challengeId, options });
  });

  app.post('/v1/auth/passkey/add/verify', async (c) => {
    const person = await signedIn(c);
    if (!person) return refuse(c, 401, 'sign in first');
    const input = (await c.req.json().catch(() => ({}))) as { challengeId?: string; response?: RegistrationResponseJSON };
    if (!input.challengeId || !input.response) return refuse(c, 400, 'give challengeId and response');
    const challenge = await takeChallenge(db, input.challengeId, 'register');
    if (!challenge) return refuse(c, 400, 'that request has expired; try again');
    const credential = await verify.registration({ response: input.response, challenge }).catch(() => null);
    if (!credential) return refuse(c, 400, 'the passkey could not be verified');
    if (await findPasskey(db, credential.credentialId)) return refuse(c, 400, 'this passkey already belongs to an account');
    await addPasskey(db, { ...credential, personId: person.id });
    return c.json({ passkeys: await passkeysOf(db, person.id) }, 201);
  });

  // The name a person goes by, next to their suggestions and fixes.
  app.post('/v1/auth/name', async (c) => {
    const person = await signedIn(c);
    if (!person) return refuse(c, 401, 'sign in first');
    const { name } = (await c.req.json().catch(() => ({}))) as { name?: unknown };
    const displayName = cleanDisplayName(name);
    if (!displayName) return refuse(c, 400, 'a name of 1 to 60 characters');
    await renamePerson(db, person.id, displayName);
    await catalog.createAccount({ id: person.id, displayName });
    return c.json({ person: { id: person.id, displayName } });
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

  // Google: the browser goes to Google and comes back to the site's /_/auth/google/callback with a code.
  const redirectUri = `${auth.origins[0]}/_/auth/google/callback`;
  const googleSignIn = auth.google;
  const backToSignIn = (c: Context, error: string) => c.redirect(`/signin?error=${error}`, 302);

  app.get('/v1/auth/google/start', async (c) => {
    if (!googleSignIn) return backToSignIn(c, 'google-off');
    const verifier = randomText(32);
    const nonce = randomText(16);
    const state = await saveChallenge(db, JSON.stringify({ verifier, nonce, returnTo: safeReturn(c.req.query('return')) }), 'google');
    setCookie(c, googleCookieName(c), state, { httpOnly: true, secure: secure(c), sameSite: 'Lax', path: '/', maxAge: 600 });
    const url = new URL(GOOGLE_AUTHORIZE);
    url.search = new URLSearchParams({
      client_id: googleSignIn.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: await sha256(verifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return c.redirect(url.toString(), 302);
  });

  app.get('/v1/auth/google/callback', async (c) => {
    if (!googleSignIn) return backToSignIn(c, 'google-off');
    const state = c.req.query('state');
    const code = c.req.query('code');
    const cookieState = getCookie(c, GOOGLE_COOKIE) ?? getCookie(c, 'rh_google');
    deleteCookie(c, googleCookieName(c), { path: '/', secure: secure(c) });
    // A person who says no at Google, or a browser that did not start here, is sent back to try again.
    if (!state || !code || state !== cookieState) return backToSignIn(c, 'google-cancelled');
    const saved = await takeChallenge(db, state, 'google');
    if (!saved) return backToSignIn(c, 'google-expired');
    const { verifier, nonce, returnTo } = JSON.parse(saved) as { verifier: string; nonce: string; returnTo: string };
    const claims = await googleClaims(googleSignIn, { code, verifier, nonce, redirectUri }).catch(() => null);
    if (!claims) return backToSignIn(c, 'google-failed');
    const email = claims.email && claims.email_verified !== false ? claims.email : null;

    // Known: sign in as its person. New, while signed in: add it to this account. New otherwise: a new account, named as on Google.
    const token = readSession(c);
    const current = token ? await sessionPerson(db, token) : null;
    let person = await googleSignedIn(db, claims.sub, email);
    // Linking a Google account that is already another account's never switches accounts behind the person's back.
    if (person && current && person.id !== current.id) return c.redirect('/account?error=google-taken', 302);
    if (!person) {
      // One person, one account: a Google account whose (verified) email already signs someone in joins their account.
      const byEmail = email ? await personByEmail(db, email.toLowerCase()) : null;
      if (byEmail && current && byEmail.id !== current.id) return c.redirect('/account?error=google-taken', 302);
      person = current ?? byEmail ?? (await createPerson(db, cleanDisplayName(claims.name) ?? cleanDisplayName(email?.split('@')[0]) ?? 'Reader'));
      await linkGoogle(db, claims.sub, person.id, email);
    }
    await signIn(c, person.id);
    return c.redirect(returnTo, 302);
  });

  // Email: a link sent to the address signs its person in, or (asked for while signed in) adds the address to the account.
  const mailer = auth.mailer;
  const emailOff = (c: Context) => refuse(c, 400, 'signing in by email is not switched on here');
  const langOf = (value: unknown): 'he' | 'en' => (value === 'en' ? 'en' : 'he');

  app.post('/v1/auth/email/start', async (c) => {
    if (!mailer) return emailOff(c);
    const input = (await c.req.json().catch(() => ({}))) as { email?: unknown; return?: string; lang?: unknown };
    const email = cleanEmail(input.email);
    if (!email) return refuse(c, 400, 'an email address, like name@example.com');
    const current = await signedIn(c);
    const started = await startEmailLink(db, { email, personId: current?.id });
    if ('refused' in started) {
      if (started.refused === 'taken') return refuse(c, 400, 'that address already signs into another account');
      return c.json({ error: 'too-many', message: 'too many links for this address in the last hour; please try again later' }, 429);
    }
    await mailer.send(signInMessage({ to: email, siteUrl: auth.origins[0]!, token: started.token, lang: langOf(input.lang), adding: Boolean(current), returnTo: safeReturn(input.return) }));
    // The same answer whether or not the address has an account here: nobody learns who does.
    return c.json({ sent: true });
  });

  // What a link is for, without using it: the page shows it, and asks a new person their name.
  app.post('/v1/auth/email/check', async (c) => {
    if (!mailer) return emailOff(c);
    const { token } = (await c.req.json().catch(() => ({}))) as { token?: unknown };
    const link = typeof token === 'string' ? await peekEmailLink(db, token) : null;
    if (!link) return refuse(c, 400, 'this link has been used or has expired; ask for a new one');
    const adding = link.personId ? await getPerson(db, link.personId) : null;
    return c.json({ email: link.email, known: Boolean(link.known), adding: adding ? { displayName: adding.displayName } : null, suggestedName: cleanDisplayName(link.email.split('@')[0]) });
  });

  app.post('/v1/auth/email/verify', async (c) => {
    if (!mailer) return emailOff(c);
    const input = (await c.req.json().catch(() => ({}))) as { token?: unknown; name?: unknown; username?: unknown };
    if (typeof input.token !== 'string') return refuse(c, 400, 'give the token from the link');
    const handle = await chosenUsername(input.username);
    if (!handle.ok) return refuse(c, 400, handle.message);
    const peeked = await peekEmailLink(db, input.token);
    if (!peeked) return refuse(c, 400, 'this link has been used or has expired; ask for a new one');
    const current = await signedIn(c);
    const name = cleanDisplayName(input.name);
    // A new person is asked their name before the link is used up.
    if (!peeked.personId && !peeked.known && !current && !name) return refuse(c, 400, 'a name of 1 to 60 characters');
    const link = await takeEmailLink(db, input.token);
    if (!link) return refuse(c, 400, 'this link has been used or has expired; ask for a new one');

    // Adding an address to the account that asked for it: never switches who this browser is signed in as.
    if (link.personId) {
      if (link.known && link.known.id !== link.personId) return refuse(c, 400, 'that address already signs into another account');
      if (current && current.id !== link.personId) return refuse(c, 400, 'this link adds the address to another account; sign out first');
      await addEmail(db, link.personId, link.email);
      return c.json({ added: link.email, person: await getPerson(db, link.personId) });
    }
    // Signing in: the address's own account; signed in already, the address joins that account; else a new one.
    if (link.known && current && link.known.id !== current.id) return refuse(c, 400, 'that address signs into another account; sign out first');
    const person = link.known ?? current ?? (await createPerson(db, name!, handle.username));
    await addEmail(db, person.id, link.email);
    await signIn(c, person.id);
    return c.json({ person: await getPerson(db, person.id), created: !link.known && !current }, !link.known && !current ? 201 : 200);
  });

  // Notifications by email of what the person follows: off, a daily digest, or at once.
  app.post('/v1/auth/notifications', async (c) => {
    const person = await signedIn(c);
    if (!person) return refuse(c, 401, 'sign in first');
    if (!mailer) return emailOff(c);
    const input = (await c.req.json().catch(() => ({}))) as { mode?: NotificationMode; email?: unknown; lang?: unknown };
    try {
      const setting = await setNotifications(catalog, person.id, { mode: input.mode as NotificationMode, email: cleanEmail(input.email), lang: langOf(input.lang) });
      return c.json({ notifications: setting });
    } catch (error) {
      return refuse(c, 400, error instanceof Error ? error.message : String(error));
    }
  });

  // The link in every notification: stops them, with no sign-in (and mail programs' one-click unsubscribe).
  app.post('/v1/auth/email/unsubscribe', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { token?: unknown };
    const token = typeof body.token === 'string' ? body.token : (c.req.query('token') ?? '');
    return c.json({ stopped: await unsubscribe(db, token) });
  });

  app.post('/v1/auth/sign-out', async (c) => {
    const token = readSession(c);
    if (token) await endSession(db, token);
    deleteCookie(c, cookieName(c), { path: '/', secure: cookieName(c) === SESSION_COOKIE });
    return c.json({ signedOut: true });
  });
}
