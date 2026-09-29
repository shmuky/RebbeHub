import type { Context, Hono, MiddlewareHandler } from 'hono';
import { actingVia, createApiToken, listApiTokens, looksLikeToken, revokeApiToken, tokenGrant, type Catalog, type TokenGrant, type Via } from '@rebbehub/core';
import { HttpError } from './app.js';
import { SEARCH_PATHS, callerAddress, type RateLimits } from './platform.js';
import { mcpChallenge, mcpResource } from './oauth.js';

/**
 * Personal API tokens (packages/core/src/tokens.ts): made and revoked on
 * the account page, sent as `Authorization: Bearer rhp_…`. A token acts as
 * its person under the same rules as the site: what it sends is a
 * suggestion like any other, reviewed like any other.
 *
 * What a token may not do, whatever its scopes: sign in or manage sign-in
 * (/v1/auth), make or revoke tokens (/v1/tokens), or use the stewards'
 * tools (/v1/admin), or answer an app's request to connect (/v1/oauth).
 * Those need the person on the site's own pages.
 *
 * An app connected with OAuth (oauth.ts) sends its access token (`rho_…`)
 * the same way. A token given for the MCP server alone (RFC 8707) opens
 * only /mcp, and the calls the MCP server's tools make for it.
 */

/** What a change sent with this token is marked as sent through (packages/core/src/via.ts). */
export const viaOf = (grant: TokenGrant): Via =>
  grant.client ? { kind: 'oauth', id: grant.tokenId, name: grant.name, client: grant.client.id } : { kind: 'token', id: grant.tokenId, name: grant.name };

/** Who each request's token signed in, while the request lasts. */
const grants = new WeakMap<Request, TokenGrant>();

export const tokenGrantOf = (c: Context): TokenGrant | undefined => grants.get(c.req.raw);

/** Paths a token never opens. */
const SITE_ONLY = /^\/v1\/(auth|tokens|admin|oauth)(\/|$)/;

/**
 * The requests the MCP server's tools make to the API's own routes for an
 * agent (mcp.ts): they carry the agent's token, and a token given for the
 * MCP server alone may make them. Only this process can put a request here.
 */
export const mcpInnerCalls = new WeakSet<Request>();

const isMcp = (path: string) => path === '/mcp';

/**
 * Reads the bearer token, if any, before anything else: a bad token is
 * refused outright (never quietly read as nobody), a read-only token may not
 * change anything, and requests are counted against the token's allowance,
 * or the caller's address when there is no token.
 */
export function tokenGate(catalog: Catalog, limits: RateLimits | undefined): MiddlewareHandler {
  const tooMany = (c: Context) => {
    c.header('Retry-After', '60');
    throw new HttpError(429, 'too many requests; wait a minute, or send a token for a larger allowance');
  };
  return async (c, next) => {
    if (c.req.method === 'OPTIONS') return next();
    const header = c.req.header('Authorization');
    const ip = callerAddress(c);
    const policy: string[] = [];
    if (limits?.ip) policy.push(`"address";q=${limits.ipPerMinute ?? 0};w=60`);
    if (limits?.key) policy.push(`"token";q=${limits.keyPerMinute ?? 0};w=60`);
    const searching = SEARCH_PATHS.test(c.req.path);
    if (searching && limits?.search) policy.push(`"search";q=${limits.searchPerMinute ?? 0};w=60`);
    if (policy.length) c.header('RateLimit-Policy', policy.join(', '));

    if (header !== undefined && /^bearer\s/i.test(header)) {
      const token = header.replace(/^bearer\s+/i, '').trim();
      const grant = looksLikeToken(token) ? await tokenGrant(catalog.db, token) : null;
      if (!grant) {
        // Failed tries count against the address, so guessing tokens is slow.
        if (ip && limits?.ip && !(await limits.ip.limit({ key: ip })).success) tooMany(c);
        // An MCP client that is told why (RFC 6750) refreshes its token or connects again.
        if (isMcp(c.req.path)) c.header('WWW-Authenticate', mcpChallenge(c, { code: 'invalid_token', description: 'unknown, revoked or expired' }));
        throw new HttpError(401, 'this API token is not valid: unknown, revoked or expired');
      }
      if (grant.resource === mcpResource(c) && !isMcp(c.req.path) && !mcpInnerCalls.has(c.req.raw)) {
        throw new HttpError(401, 'this token was given for the MCP server (/mcp) alone; connect for the whole API to use it here');
      }
      if (SITE_ONLY.test(c.req.path)) throw new HttpError(403, 'API tokens cannot sign in, manage tokens or use stewards\' tools; do that on the site');
      const reads = c.req.method === 'GET' || c.req.method === 'HEAD' || isMcp(c.req.path) || c.req.path === '/oai';
      if (!reads && !grant.scopes.includes('write')) throw new HttpError(403, 'this token may only read; make one with the write scope to send suggestions');
      if (limits?.key && !(await limits.key.limit({ key: grant.tokenId })).success) tooMany(c);
      // The person's catalog account, made again if a rebuild of the catalog dropped it (as a session does).
      await catalog.createAccount({ id: grant.personId, displayName: grant.displayName });
      grants.set(c.req.raw, grant);
    } else if (ip && limits?.ip && !c.req.path.startsWith('/objects/')) {
      // A file's bytes are asked for in many small ranges while it plays; they are not counted.
      if (!(await limits.ip.limit({ key: ip })).success) tooMany(c);
    }
    // Searches from an address count twice: against its allowance, and against the smaller one for searching (a token's own allowance covers its searches).
    if (searching && ip && limits?.search && !tokenGrantOf(c) && !(await limits.search.limit({ key: ip })).success) tooMany(c);
    // Everything the request writes is marked as the token's work for its person, not their own hands.
    const grant = tokenGrantOf(c);
    await actingVia(grant ? viaOf(grant) : null, () => next());
  };
}

export function tokenRoutes(app: Hono, catalog: Catalog, signedIn: (c: Context) => Promise<string>): void {
  app.get('/v1/tokens', async (c) => c.json({ tokens: await listApiTokens(catalog.db, await signedIn(c)) }, 200, { 'Cache-Control': 'no-store' }));

  app.post('/v1/tokens', async (c) => {
    const by = await signedIn(c);
    const input = (await c.req.json().catch(() => ({}))) as { name?: unknown; scopes?: unknown; expiresInDays?: unknown };
    const made = await createApiToken(catalog.db, by, input);
    // The token itself, this once; only its prefix is ever shown again.
    return c.json({ token: made.token, ...made.view }, 201, { 'Cache-Control': 'no-store' });
  });

  app.delete('/v1/tokens/:id', async (c) => {
    const by = await signedIn(c);
    await revokeApiToken(catalog.db, by, c.req.param('id'));
    return c.json({ ok: true });
  });
}
