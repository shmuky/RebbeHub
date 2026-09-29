import { one, type Db } from '@rebbehub/db';
import { base64url, hashToken } from './auth.js';
import type { ApiTokenView, TokenGrant, TokenScope } from './tokens.js';

/**
 * Connecting an app with OAuth 2.1 (migration 0021, docs/developers/auth.md):
 * how Claude and other agents act as a person through the MCP server
 * without the person copying a token by hand. The app asks; the person
 * sees on the site which app it is, where it sends them back and what it
 * may do, and says yes or no; the app gets a short-lived access token and
 * a refresh token that act as them. Like a personal API token, a
 * connection is the person, no more: what it sends is a suggestion,
 * reviewed like any other.
 *
 * Public apps only prove themselves with PKCE (S256); an app that
 * registered with a secret must send it too. Access tokens are `rho_` and
 * last an hour; refresh tokens are `rhr_`, and each use gives a new one
 * (the old one stops working). Only their sha256 is kept.
 */

export const ACCESS_PREFIX = 'rho_';
export const REFRESH_PREFIX = 'rhr_';
/** How long each thing lasts, in seconds. */
export const ACCESS_SECONDS = 3600;
export const REFRESH_DAYS = 90;
export const REQUEST_MINUTES = 30;
export const CODE_MINUTES = 10;
/** How long an app's own description (a Client ID Metadata Document) is kept before it is read again. */
export const METADATA_HOURS = 24;

/** An OAuth error as RFC 6749 names it, with a sentence for people. */
export class OAuthError extends Error {
  constructor(
    readonly error: 'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unauthorized_client' | 'unsupported_grant_type' | 'invalid_scope' | 'invalid_target' | 'invalid_redirect_uri' | 'invalid_client_metadata' | 'access_denied' | 'unsupported_response_type',
    message: string,
    /** For the authorization endpoint: whether the error may go back to the app's redirect address (else the person is told on the site). */
    readonly redirectable = false,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

export interface OAuthClient {
  id: string;
  kind: 'registered' | 'metadata';
  name: string;
  uri: string | null;
  redirectUris: string[];
  /** Whether the app must send its secret to trade codes and refresh tokens. */
  confidential: boolean;
}

/** Reads an app's own description from its address; replaced in tests. */
export type MetadataFetch = (url: string) => Promise<Response>;

interface ClientRow {
  id: string;
  kind: 'registered' | 'metadata';
  name: string;
  uri: string | null;
  redirect_uris: string[];
  secret_hash: string | null;
  stale?: boolean;
}

const clientView = (row: ClientRow): OAuthClient => ({ id: row.id, kind: row.kind, name: row.name, uri: row.uri, redirectUris: row.redirect_uris, confidential: row.secret_hash !== null });

function random(bytes: number): string {
  const out = new Uint8Array(bytes);
  crypto.getRandomValues(out);
  return base64url(out);
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
const FORBIDDEN_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'about:', 'blob:', 'ftp:', 'ws:', 'wss:']);

/**
 * Whether an address may be a redirect address: https anywhere, http only
 * on this computer (an app listening on localhost), or an app's own scheme
 * (`cursor://…`, RFC 8252); never a fragment, never a scheme that runs
 * something in the browser.
 */
export function redirectUriProblem(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000) return 'a redirect address is a URL of at most 2000 characters';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return `"${value}" is not a URL`;
  }
  if (url.hash || value.includes('#')) return 'a redirect address has no #fragment';
  if (FORBIDDEN_SCHEMES.has(url.protocol)) return `${url.protocol} addresses cannot be redirect addresses`;
  if (url.protocol === 'http:' && !LOOPBACK.has(url.hostname)) return 'http redirect addresses are only for this computer (localhost); use https';
  return null;
}

/**
 * Whether the redirect address asked for is one the app registered: the
 * same string, except that an app on this computer may listen on any port
 * (RFC 8252, section 7.3).
 */
export function redirectMatches(registered: readonly string[], asked: string): boolean {
  if (registered.includes(asked)) return true;
  let url: URL;
  try {
    url = new URL(asked);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname)) return false;
  return registered.some((r) => {
    try {
      const known = new URL(r);
      return known.protocol === 'http:' && known.hostname === url.hostname && known.pathname === url.pathname && known.search === url.search;
    } catch {
      return false;
    }
  });
}

/** Whether every redirect address is on this computer (the consent page warns: anyone's program there could claim to be the app). */
export const onlyLoopback = (uris: readonly string[]): boolean => uris.every((u) => u.startsWith('http://') && LOOPBACK.has(new URL(u).hostname));

const cleanName = (value: unknown): string | null => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 200) : '') || null;

function cleanUri(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Registers an app (RFC 7591), with no account: what it says about itself
 * is shown to people as what it says, beside the address it sends them
 * back to. An app that asks for `client_secret_post` or
 * `client_secret_basic` gets a secret, shown this once.
 */
export async function registerClient(db: Db, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const uris = input.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 20) throw new OAuthError('invalid_redirect_uri', 'give redirect_uris: 1 to 20 addresses');
  for (const uri of uris) {
    const problem = redirectUriProblem(uri);
    if (problem) throw new OAuthError('invalid_redirect_uri', problem);
  }
  const method = input.token_endpoint_auth_method ?? 'none';
  if (method !== 'none' && method !== 'client_secret_post' && method !== 'client_secret_basic') throw new OAuthError('invalid_client_metadata', 'token_endpoint_auth_method is none, client_secret_post or client_secret_basic');
  const grants = (input.grant_types as unknown[] | undefined) ?? ['authorization_code', 'refresh_token'];
  if (!Array.isArray(grants) || !grants.every((g) => g === 'authorization_code' || g === 'refresh_token')) throw new OAuthError('invalid_client_metadata', 'grant_types are authorization_code and refresh_token');
  const responses = (input.response_types as unknown[] | undefined) ?? ['code'];
  if (!Array.isArray(responses) || !responses.every((r) => r === 'code')) throw new OAuthError('invalid_client_metadata', 'response_types is code');

  const id = `rhc-${random(12)}`;
  const secret = method === 'none' ? null : `rhs_${random(32)}`;
  const name = cleanName(input.client_name) ?? 'An app with no name';
  const uri = cleanUri(input.client_uri);
  const row = await one<{ created_at: Date | string }>(
    db,
    `INSERT INTO auth.oauth_client (id, kind, name, uri, redirect_uris, secret_hash) VALUES ($1, 'registered', $2, $3, $4, $5) RETURNING created_at`,
    [id, name, uri, [...new Set(uris as string[])], secret ? await hashToken(secret) : null],
  );
  return {
    client_id: id,
    client_id_issued_at: Math.floor(new Date(row!.created_at).getTime() / 1000),
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_name: name,
    ...(uri ? { client_uri: uri } : {}),
    redirect_uris: [...new Set(uris as string[])],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: method,
  };
}

/** Whether a client id is the address of the app's own description (a Client ID Metadata Document). */
export function isMetadataClientId(id: string): boolean {
  try {
    const url = new URL(id);
    return url.protocol === 'https:' && url.pathname.length > 1 && !url.hash && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Addresses never fetched: this computer, private networks, and addresses by number. */
function privateHost(host: string): boolean {
  return LOOPBACK.has(host) || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || /^[\d.]+$/.test(host) || host.startsWith('[') || !host.includes('.');
}

/**
 * Reads an app's own description from its address (draft-ietf-oauth-client-id-metadata-document):
 * JSON of at most 5 KB whose client_id is that address, with its name and
 * redirect addresses. It is kept for a day.
 */
async function fetchMetadataClient(db: Db, id: string, fetcher: MetadataFetch): Promise<OAuthClient> {
  const url = new URL(id);
  if (privateHost(url.hostname)) throw new OAuthError('invalid_client', 'an app described at a private address cannot be used');
  let doc: Record<string, unknown>;
  try {
    const response = await fetcher(id);
    if (!response.ok) throw new Error(`answered ${response.status}`);
    const text = await response.text();
    if (text.length > 5 * 1024) throw new Error('the description is larger than 5 KB');
    doc = JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    throw new OAuthError('invalid_client', `could not read the app's description at ${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!doc || typeof doc !== 'object' || doc.client_id !== id) throw new OAuthError('invalid_client', "the app's description does not name its own address as client_id");
  const uris = doc.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > 20 || uris.some((u) => redirectUriProblem(u) !== null)) throw new OAuthError('invalid_client', "the app's description has no usable redirect_uris");
  const method = doc.token_endpoint_auth_method ?? 'none';
  if (method !== 'none') throw new OAuthError('invalid_client', 'an app known by its description authenticates with PKCE alone (token_endpoint_auth_method none)');
  const name = cleanName(doc.client_name) ?? url.hostname;
  const row = await one<ClientRow>(
    db,
    `INSERT INTO auth.oauth_client (id, kind, name, uri, redirect_uris, fetched_at) VALUES ($1, 'metadata', $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, uri = EXCLUDED.uri, redirect_uris = EXCLUDED.redirect_uris, fetched_at = now()
     RETURNING id, kind, name, uri, redirect_uris, secret_hash`,
    [id, name, cleanUri(doc.client_uri), [...new Set(uris as string[])]],
  );
  return clientView(row!);
}

/** An app by its client id, reading its description again when it is an address and a day has passed. */
export async function getClient(db: Db, id: unknown, fetcher?: MetadataFetch): Promise<OAuthClient> {
  if (typeof id !== 'string' || !id || id.length > 2000) throw new OAuthError('invalid_client', 'give client_id');
  const row = await one<ClientRow>(db, `SELECT id, kind, name, uri, redirect_uris, secret_hash, (fetched_at IS NOT NULL AND fetched_at < now() - make_interval(hours => ${METADATA_HOURS})) AS stale FROM auth.oauth_client WHERE id = $1`, [id]);
  if (row && !row.stale) return clientView(row);
  if (isMetadataClientId(id)) {
    if (!fetcher) throw new OAuthError('invalid_client', 'apps known by the address of their description are not accepted here');
    return fetchMetadataClient(db, id, fetcher);
  }
  if (row) return clientView(row);
  throw new OAuthError('invalid_client', `no app is registered as ${id}; register it first (the registration_endpoint)`);
}

/** Checks an app's secret, when it has one: from the form (client_secret_post) or the Authorization header (client_secret_basic). */
export async function authenticateClient(db: Db, client: OAuthClient, secret: string | undefined): Promise<void> {
  if (!client.confidential) return;
  const row = await one<{ ok: boolean }>(db, 'SELECT secret_hash = $2 AS ok FROM auth.oauth_client WHERE id = $1', [client.id, secret ? await hashToken(secret) : '']);
  if (!row?.ok) throw new OAuthError('invalid_client', "the app's secret is missing or wrong");
}

/** Scopes as asked (`read write`): the ones RebbeHub has; unknown ones (openid…) are passed over; none asked, both. */
export function parseScopes(value: unknown): TokenScope[] {
  const asked = typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : [];
  const known = (['read', 'write'] as const).filter((s) => asked.includes(s));
  if (known.includes('write') && !known.includes('read')) return ['read', 'write'];
  return known.length ? [...known] : ['read', 'write'];
}

export interface AuthorizeInput {
  responseType?: string;
  redirectUri?: string;
  scope?: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  resource?: string;
}

/**
 * Starts an authorization (RFC 6749, 4.1.1): checks the app and where it
 * sends the person back first (a mistake there is shown to the person,
 * never sent to an address we cannot trust), then the rest (sent back to
 * the app as an error). Returns the asking's id, for the consent page.
 */
export async function startAuthorization(db: Db, client: OAuthClient, input: AuthorizeInput, resources: { allowed: readonly string[]; fallback: string }): Promise<{ id: string; redirectUri: string }> {
  let redirectUri = input.redirectUri;
  if (!redirectUri) {
    if (client.redirectUris.length !== 1) throw new OAuthError('invalid_request', 'give redirect_uri: this app registered several');
    redirectUri = client.redirectUris[0]!;
  }
  if (!redirectMatches(client.redirectUris, redirectUri)) throw new OAuthError('invalid_request', `${redirectUri} is not one of the app's registered redirect addresses`);
  if (input.responseType !== 'code') throw new OAuthError('unsupported_response_type', 'response_type is code', true);
  if (!input.codeChallenge || !/^[A-Za-z0-9_-]{43,128}$/.test(input.codeChallenge)) throw new OAuthError('invalid_request', 'PKCE is needed: give code_challenge', true);
  if (input.codeChallengeMethod !== 'S256') throw new OAuthError('invalid_request', 'code_challenge_method is S256', true);
  const resource = input.resource ? canonicalResource(input.resource) : resources.fallback;
  if (!resource || !resources.allowed.includes(resource)) throw new OAuthError('invalid_target', `resource is one of ${resources.allowed.join(', ')}`, true);
  if (input.state !== undefined && input.state.length > 2000) throw new OAuthError('invalid_request', 'state is at most 2000 characters', true);
  const id = `oar-${random(18)}`;
  await db.query(
    `INSERT INTO auth.oauth_request (id, client_id, redirect_uri, scopes, state, code_challenge, resource, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now() + make_interval(mins => ${REQUEST_MINUTES}))`,
    [id, client.id, redirectUri, parseScopes(input.scope), input.state ?? null, input.codeChallenge, resource],
  );
  // Old askings nobody answered are cleared as new ones come.
  await db.query("DELETE FROM auth.oauth_request WHERE expires_at < now() - interval '1 day' AND (code_expires_at IS NULL OR code_expires_at < now() - interval '1 day')");
  return { id, redirectUri };
}

/** A resource's address as RFC 8707 compares it: lower-case scheme and host, no trailing slash, no fragment. */
export function canonicalResource(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.hash) return null;
    // URL lower-cases the scheme and host already.
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}${url.search}`;
  } catch {
    return null;
  }
}

/** What the consent page shows: the app as it names itself, where the person goes back to, and what it asks. */
export interface AuthorizationView {
  id: string;
  client: { id: string; name: string; uri: string | null; kind: 'registered' | 'metadata'; host: string | null };
  redirectUri: string;
  redirectHost: string;
  /** Every redirect address is on the person's own computer: any program there could claim to be this app. */
  loopback: boolean;
  scopes: TokenScope[];
  resource: string;
  expiresAt: string;
}

const hostOf = (value: string): string => {
  try {
    const url = new URL(value);
    return url.host || `${url.protocol}//`;
  } catch {
    return value;
  }
};

/** An asking still waiting for the person's answer, or null. */
export async function authorizationRequest(db: Db, id: string): Promise<AuthorizationView | null> {
  const row = await one<{ id: string; redirect_uri: string; scopes: TokenScope[]; resource: string; expires_at: Date | string; client_id: string; name: string; uri: string | null; kind: 'registered' | 'metadata' }>(
    db,
    `SELECT r.id, r.redirect_uri, r.scopes, r.resource, r.expires_at, c.id AS client_id, c.name, c.uri, c.kind
     FROM auth.oauth_request r JOIN auth.oauth_client c ON c.id = r.client_id
     WHERE r.id = $1 AND r.decided_at IS NULL AND r.expires_at > now()`,
    [id],
  );
  if (!row) return null;
  return {
    id: row.id,
    client: { id: row.client_id, name: row.name, uri: row.uri, kind: row.kind, host: row.kind === 'metadata' ? hostOf(row.client_id) : row.uri ? hostOf(row.uri) : null },
    redirectUri: row.redirect_uri,
    redirectHost: hostOf(row.redirect_uri),
    loopback: onlyLoopback([row.redirect_uri]),
    scopes: row.scopes,
    resource: row.resource,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

/** The app's redirect address with the answer's parameters added (and `iss`, RFC 9207). */
function withParams(redirectUri: string, params: Record<string, string | null | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined) url.searchParams.set(key, value);
  return url.toString();
}

/**
 * The person's answer. Yes: a one-time code for the scopes they allowed
 * (never more than were asked); no: `access_denied`. Either way, the
 * address to send the browser to.
 */
export async function decideAuthorization(db: Db, id: string, personId: string, input: { approve: boolean; scopes?: unknown }, issuer: string): Promise<{ redirect: string }> {
  const row = await one<{ redirect_uri: string; scopes: TokenScope[]; state: string | null }>(
    db,
    'SELECT redirect_uri, scopes, state FROM auth.oauth_request WHERE id = $1 AND decided_at IS NULL AND expires_at > now()',
    [id],
  );
  if (!row) throw new OAuthError('invalid_request', 'this request to connect is over (answered, or older than half an hour); start again from the app');
  if (!input.approve) {
    await db.query('UPDATE auth.oauth_request SET decided_at = now(), person_id = $2 WHERE id = $1', [id, personId]);
    return { redirect: withParams(row.redirect_uri, { error: 'access_denied', error_description: 'the person said no', state: row.state, iss: issuer }) };
  }
  let scopes = row.scopes;
  if (Array.isArray(input.scopes)) {
    scopes = row.scopes.filter((s) => (input.scopes as unknown[]).includes(s));
    if (!scopes.includes('read')) scopes = ['read', ...scopes];
  }
  const code = random(32);
  await db.query(
    `UPDATE auth.oauth_request SET decided_at = now(), person_id = $2, scopes = $3, code_hash = $4, code_expires_at = now() + make_interval(mins => ${CODE_MINUTES}) WHERE id = $1`,
    [id, personId, scopes, await hashToken(code)],
  );
  return { redirect: withParams(row.redirect_uri, { code, state: row.state, iss: issuer }) };
}

export interface TokenAnswer {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

async function newTokens(): Promise<{ access: string; refresh: string; accessHash: string; refreshHash: string }> {
  const access = `${ACCESS_PREFIX}${random(32)}`;
  const refresh = `${REFRESH_PREFIX}${random(32)}`;
  return { access, refresh, accessHash: await hashToken(access), refreshHash: await hashToken(refresh) };
}

const answer = (tokens: { access: string; refresh: string }, scopes: TokenScope[]): TokenAnswer => ({ access_token: tokens.access, token_type: 'Bearer', expires_in: ACCESS_SECONDS, refresh_token: tokens.refresh, scope: scopes.join(' ') });

/** PKCE (RFC 7636): the verifier's sha256, base64url, is the challenge. */
async function pkceMatches(verifier: string, challenge: string): Promise<boolean> {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return base64url(digest) === challenge;
}

/**
 * Trades a code for tokens (RFC 6749, 4.1.3): the same app, the same
 * redirect address, the verifier whose challenge was sent, within ten
 * minutes, once. A code used a second time ends the connection it made:
 * someone else may have it.
 */
export async function exchangeCode(db: Db, client: OAuthClient, input: { code?: string; redirectUri?: string; verifier?: string; resource?: string }): Promise<TokenAnswer> {
  if (!input.code) throw new OAuthError('invalid_request', 'give code');
  if (!input.verifier) throw new OAuthError('invalid_request', 'give code_verifier (PKCE)');
  const row = await one<{ id: string; client_id: string; redirect_uri: string; scopes: TokenScope[]; code_challenge: string; resource: string; person_id: string; used_at: Date | null; connection_id: string | null; live: boolean }>(
    db,
    `SELECT id, client_id, redirect_uri, scopes, code_challenge, resource, person_id, used_at, connection_id, code_expires_at > now() AS live
     FROM auth.oauth_request WHERE code_hash = $1`,
    [await hashToken(input.code)],
  );
  if (!row) throw new OAuthError('invalid_grant', 'this code is not known');
  if (row.used_at) {
    if (row.connection_id) await db.query('UPDATE auth.oauth_connection SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1', [row.connection_id]);
    throw new OAuthError('invalid_grant', 'this code was used already; the connection made with it is ended');
  }
  if (!row.live) throw new OAuthError('invalid_grant', 'this code is older than ten minutes; start again');
  if (row.client_id !== client.id) throw new OAuthError('invalid_grant', 'this code was given to another app');
  if (input.redirectUri !== undefined && input.redirectUri !== row.redirect_uri) throw new OAuthError('invalid_grant', 'redirect_uri is not the one the code was asked with');
  if (!(await pkceMatches(input.verifier, row.code_challenge))) throw new OAuthError('invalid_grant', 'code_verifier does not match the code_challenge');
  if (input.resource !== undefined && canonicalResource(input.resource) !== row.resource) throw new OAuthError('invalid_target', `this code was given for ${row.resource}`);

  const tokens = await newTokens();
  const connectionId = `oac-${random(12)}`;
  const used = await one<{ id: string }>(db, 'UPDATE auth.oauth_request SET used_at = now() WHERE id = $1 AND used_at IS NULL RETURNING id', [row.id]);
  if (!used) throw new OAuthError('invalid_grant', 'this code was used already');
  await db.query(
    `INSERT INTO auth.oauth_connection (id, person_id, client_id, scopes, resource, access_hash, access_expires_at, refresh_hash, refresh_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(secs => ${ACCESS_SECONDS}), $7, now() + make_interval(days => ${REFRESH_DAYS}))`,
    [connectionId, row.person_id, client.id, row.scopes, row.resource, tokens.accessHash, tokens.refreshHash],
  );
  await db.query('UPDATE auth.oauth_request SET connection_id = $2 WHERE id = $1', [row.id, connectionId]);
  return answer(tokens, row.scopes);
}

/**
 * A refresh token for new tokens (RFC 6749, section 6): both are turned
 * over, and the old refresh token stops working (OAuth 2.1 for public
 * apps). Scopes may be narrowed, never widened.
 */
export async function refreshTokens(db: Db, client: OAuthClient, input: { refreshToken?: string; scope?: string; resource?: string }): Promise<TokenAnswer> {
  if (!input.refreshToken?.startsWith(REFRESH_PREFIX)) throw new OAuthError('invalid_grant', 'this refresh token is not known');
  const row = await one<{ id: string; client_id: string; scopes: TokenScope[]; resource: string }>(
    db,
    'SELECT id, client_id, scopes, resource FROM auth.oauth_connection WHERE refresh_hash = $1 AND revoked_at IS NULL AND refresh_expires_at > now()',
    [await hashToken(input.refreshToken)],
  );
  if (!row) throw new OAuthError('invalid_grant', 'this refresh token is not valid: unknown, used, revoked or expired');
  if (row.client_id !== client.id) throw new OAuthError('invalid_grant', 'this refresh token was given to another app');
  if (input.resource !== undefined && canonicalResource(input.resource) !== row.resource) throw new OAuthError('invalid_target', `this connection was given for ${row.resource}`);
  let scopes = row.scopes;
  if (input.scope) {
    const asked = input.scope.split(/\s+/).filter(Boolean);
    if (asked.some((s) => !row.scopes.includes(s as TokenScope))) throw new OAuthError('invalid_scope', `this connection may only ${row.scopes.join(' and ')}`);
    scopes = row.scopes.filter((s) => asked.includes(s));
    if (!scopes.includes('read')) scopes = ['read', ...scopes];
  }
  const tokens = await newTokens();
  const updated = await one<{ id: string }>(
    db,
    `UPDATE auth.oauth_connection SET scopes = $2, access_hash = $3, access_expires_at = now() + make_interval(secs => ${ACCESS_SECONDS}), refresh_hash = $4, refresh_expires_at = now() + make_interval(days => ${REFRESH_DAYS})
     WHERE id = $1 AND refresh_hash = $5 AND revoked_at IS NULL RETURNING id`,
    [row.id, scopes, tokens.accessHash, tokens.refreshHash, await hashToken(input.refreshToken)],
  );
  if (!updated) throw new OAuthError('invalid_grant', 'this refresh token was used already');
  return answer(tokens, scopes);
}

/**
 * Revocation (RFC 7009): an access or refresh token ends its whole
 * connection. An unknown token is no error; neither is another app's
 * (nothing is revoked then).
 */
export async function revokeOAuthToken(db: Db, token: string | undefined, clientId?: string): Promise<void> {
  if (!token || !(token.startsWith(ACCESS_PREFIX) || token.startsWith(REFRESH_PREFIX))) return;
  const hash = await hashToken(token);
  await db.query(
    `UPDATE auth.oauth_connection SET revoked_at = coalesce(revoked_at, now())
     WHERE (access_hash = $1 OR refresh_hash = $1) AND ($2::text IS NULL OR client_id = $2)`,
    [hash, clientId ?? null],
  );
}

/** Who an access token signs in, or null when it is unknown, revoked or expired. Its last use is kept to the minute. */
export async function oauthGrant(db: Db, token: string): Promise<TokenGrant | null> {
  if (!/^rho_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await one<{ id: string; person_id: string; display_name: string; scopes: TokenScope[]; resource: string; client_id: string; client_name: string; stale: boolean }>(
    db,
    `SELECT t.id, t.person_id, p.display_name, t.scopes, t.resource, t.client_id, c.name AS client_name,
            (t.last_used_at IS NULL OR t.last_used_at < now() - interval '1 minute') AS stale
     FROM auth.oauth_connection t JOIN auth.person p ON p.id = t.person_id JOIN auth.oauth_client c ON c.id = t.client_id
     WHERE t.access_hash = $1 AND t.revoked_at IS NULL AND t.access_expires_at > now()`,
    [await hashToken(token)],
  );
  if (!row) return null;
  if (row.stale) await db.query('UPDATE auth.oauth_connection SET last_used_at = now() WHERE id = $1', [row.id]);
  return { tokenId: row.id, name: row.client_name, personId: row.person_id, displayName: row.display_name, scopes: row.scopes, resource: row.resource, client: { id: row.client_id, name: row.client_name } };
}

/** A person's connected apps, as the account page lists them beside their tokens. */
export async function listConnections(db: Db, personId: string): Promise<ApiTokenView[]> {
  const { rows } = await db.query<{ id: string; scopes: TokenScope[]; created_at: Date | string; last_used_at: Date | string | null; refresh_expires_at: Date | string; revoked_at: Date | string | null; client_id: string; name: string; uri: string | null; redirect_uris: string[] }>(
    `SELECT t.id, t.scopes, t.created_at, t.last_used_at, t.refresh_expires_at, t.revoked_at, c.id AS client_id, c.name, c.uri, c.redirect_uris
     FROM auth.oauth_connection t JOIN auth.oauth_client c ON c.id = t.client_id
     WHERE t.person_id = $1 ORDER BY t.created_at DESC, t.id`,
    [personId],
  );
  const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());
  return rows.map((r) => ({
    id: r.id,
    kind: 'oauth' as const,
    name: r.name,
    prefix: ACCESS_PREFIX,
    scopes: r.scopes,
    createdAt: iso(r.created_at)!,
    lastUsedAt: iso(r.last_used_at),
    expiresAt: iso(r.refresh_expires_at),
    revokedAt: iso(r.revoked_at),
    client: { id: r.client_id, name: r.name, uri: r.uri, host: r.client_id.startsWith('https://') ? hostOf(r.client_id) : hostOf(r.redirect_uris[0] ?? '') },
  }));
}

/** Ends one of a person's connections; its tokens stop working at once. */
export async function revokeConnection(db: Db, personId: string, id: string): Promise<boolean> {
  const row = await one<{ id: string }>(db, 'UPDATE auth.oauth_connection SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1 AND person_id = $2 RETURNING id', [id, personId]);
  return Boolean(row);
}
