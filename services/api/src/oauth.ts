import type { Context, Hono } from 'hono';
import {
  OAuthError,
  authenticateClient,
  authorizationRequest,
  canonicalResource,
  decideAuthorization,
  exchangeCode,
  getClient,
  refreshTokens,
  registerClient,
  revokeOAuthToken,
  startAuthorization,
  type Catalog,
  type MetadataFetch,
  type OAuthClient,
} from '@rebbehub/core';
import { HttpError } from './app.js';

/**
 * The API as an OAuth 2.1 authorization server (docs/developers/auth.md),
 * so Claude and other MCP clients can connect as a person the way the MCP
 * authorization spec (2025-06-18, 2025-11-25) says: they find this server
 * from the MCP server's Protected Resource Metadata (RFC 9728), read its
 * metadata (RFC 8414), register (RFC 7591) or name the address of their
 * own description (a Client ID Metadata Document), send the person to
 * /oauth/authorize with PKCE (S256) and a resource (RFC 8707), and trade
 * the code at /oauth/token.
 *
 * The person decides on the site's own page (/oauth/consent), signed in
 * as they are there; the page asks and answers through /v1/oauth/requests,
 * which only the site's session opens (never a token). Nothing here is
 * ever cached: worker.ts sends none of it to the edge cache, and every
 * answer says no-store.
 */

export interface OAuthServerOptions {
  /** The site's address, where the person says yes or no. */
  siteUrl: string;
  /** Reads an app's own description from its https address; unset, `fetch` with a five-second limit and no redirects. */
  fetchClientMetadata?: MetadataFetch;
}

export const OAUTH_SCOPES = ['read', 'write'] as const;
const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

const defaultFetch: MetadataFetch = (url) => fetch(url, { headers: { accept: 'application/json' }, redirect: 'manual', signal: AbortSignal.timeout(5000) });

/** Where this API is, as its callers reach it: the issuer, and the base of every endpoint. */
export const apiOrigin = (c: Context): string => new URL(c.req.url).origin;

/** The MCP server's address: what access tokens are for, and what Protected Resource Metadata names. */
export const mcpResource = (c: Context): string => `${apiOrigin(c)}/mcp`;

/** Where the MCP server's Protected Resource Metadata is (RFC 9728, section 3.1: the resource's path after the well-known part). */
export const mcpResourceMetadata = (c: Context): string => `${apiOrigin(c)}/.well-known/oauth-protected-resource/mcp`;

/** What a 401 from the MCP server says (RFC 9728, section 5.1; RFC 6750, section 3), so a client knows where to sign in. */
export function mcpChallenge(c: Context, error?: { code: 'invalid_token' | 'insufficient_scope'; description: string }): string {
  const parts = [`resource_metadata="${mcpResourceMetadata(c)}"`, `scope="${OAUTH_SCOPES.join(' ')}"`];
  if (error) parts.push(`error="${error.code}"`, `error_description="${error.description.replace(/"/g, "'")}"`);
  return `Bearer ${parts.join(', ')}`;
}

/** Resources a token may be given for: the MCP server, or the whole API. */
const resourcesOf = (c: Context) => ({ allowed: [mcpResource(c), apiOrigin(c)], fallback: apiOrigin(c) });

function oauthFailure(c: Context, error: OAuthError): Response {
  const status = error.error === 'invalid_client' ? 401 : 400;
  if (status === 401 && /^basic\s/i.test(c.req.header('Authorization') ?? '')) c.header('WWW-Authenticate', 'Basic realm="RebbeHub"');
  return c.json({ error: error.error, error_description: error.message }, status, NO_STORE);
}

/** A token or revocation request's fields: a form, as RFC 6749 says, or JSON, which some clients send. */
async function formOf(c: Context): Promise<Record<string, string>> {
  const type = c.req.header('Content-Type') ?? '';
  if (type.includes('application/json')) {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(body).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  }
  const body = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  return Object.fromEntries(Object.entries(body).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
}

/** The app's id and secret, from HTTP Basic (client_secret_basic) or the form (client_secret_post, or a public app's client_id). */
function credentialsOf(c: Context, form: Record<string, string>): { id?: string; secret?: string } {
  const basic = /^basic\s+(.+)$/i.exec(c.req.header('Authorization') ?? '');
  if (basic) {
    try {
      const [id, secret] = atob(basic[1]!.trim()).split(':').map((part) => decodeURIComponent(part.replace(/\+/g, ' ')));
      return { id, secret: secret || undefined };
    } catch {
      return {};
    }
  }
  return { id: form.client_id, secret: form.client_secret };
}

export function oauthRoutes(app: Hono, catalog: Catalog, signedIn: (c: Context) => Promise<string>, options: OAuthServerOptions): void {
  const db = catalog.db;
  const site = options.siteUrl.replace(/\/+$/, '');
  const fetcher = options.fetchClientMetadata ?? defaultFetch;

  /** The resource's metadata (RFC 9728): the MCP server's at …/mcp, the whole API's at the root. */
  const protectedResource = (c: Context, resource: string) =>
    c.json(
      {
        resource,
        authorization_servers: [apiOrigin(c)],
        scopes_supported: OAUTH_SCOPES,
        bearer_methods_supported: ['header'],
        resource_name: 'RebbeHub',
        resource_documentation: `${site}/developers/agents`,
      },
      200,
      { 'Cache-Control': 'public, max-age=3600' },
    );
  app.get('/.well-known/oauth-protected-resource', (c) => protectedResource(c, apiOrigin(c)));
  app.get('/.well-known/oauth-protected-resource/mcp', (c) => protectedResource(c, mcpResource(c)));

  app.get('/.well-known/oauth-authorization-server', (c) => {
    const base = apiOrigin(c);
    return c.json(
      {
        issuer: base,
        authorization_endpoint: `${base}/oauth/authorize`,
        token_endpoint: `${base}/oauth/token`,
        registration_endpoint: `${base}/oauth/register`,
        revocation_endpoint: `${base}/oauth/revoke`,
        scopes_supported: OAUTH_SCOPES,
        response_types_supported: ['code'],
        response_modes_supported: ['query'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
        revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
        code_challenge_methods_supported: ['S256'],
        client_id_metadata_document_supported: true,
        authorization_response_iss_parameter_supported: true,
        service_documentation: `${site}/developers/auth`,
        ui_locales_supported: ['he', 'en'],
      },
      200,
      { 'Cache-Control': 'public, max-age=3600' },
    );
  });

  app.post('/oauth/register', async (c) => {
    const input = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return c.json({ error: 'invalid_client_metadata', error_description: 'send the app\'s metadata as JSON' }, 400, NO_STORE);
    try {
      return c.json(await registerClient(db, input), 201, NO_STORE);
    } catch (error) {
      if (error instanceof OAuthError) return c.json({ error: error.error, error_description: error.message }, 400, NO_STORE);
      throw error;
    }
  });

  /**
   * Starts a connection: checks the app and its redirect address, keeps the
   * asking, and sends the person to the site's consent page. A mistake in
   * the app or its address is shown to the person there; any other goes
   * back to the app, as RFC 6749 (4.1.2.1) says.
   */
  app.get('/oauth/authorize', async (c) => {
    const q = c.req.query();
    const lang = (q.ui_locales ?? '').split(/\s+/)[0]?.startsWith('en') ? '&lang=en' : '';
    c.header('Cache-Control', 'no-store');
    let client: OAuthClient;
    try {
      client = await getClient(db, q.client_id, fetcher);
    } catch (error) {
      if (error instanceof OAuthError) return c.redirect(`${site}/oauth/consent?error=invalid_client${lang}`, 302);
      throw error;
    }
    try {
      const { id } = await startAuthorization(db, client, { responseType: q.response_type, redirectUri: q.redirect_uri, scope: q.scope, state: q.state, codeChallenge: q.code_challenge, codeChallengeMethod: q.code_challenge_method, resource: q.resource }, resourcesOf(c));
      return c.redirect(`${site}/oauth/consent?request=${id}${lang}`, 302);
    } catch (error) {
      if (!(error instanceof OAuthError)) throw error;
      if (!error.redirectable || !q.redirect_uri) return c.redirect(`${site}/oauth/consent?error=${error.error === 'invalid_request' ? 'invalid_redirect' : error.error}${lang}`, 302);
      const back = new URL(q.redirect_uri);
      back.searchParams.set('error', error.error);
      back.searchParams.set('error_description', error.message);
      if (q.state) back.searchParams.set('state', q.state);
      back.searchParams.set('iss', apiOrigin(c));
      return c.redirect(back.toString(), 302);
    }
  });

  app.post('/oauth/token', async (c) => {
    const form = await formOf(c);
    try {
      const credentials = credentialsOf(c, form);
      const client = await getClient(db, credentials.id, fetcher);
      await authenticateClient(db, client, credentials.secret);
      if (form.resource !== undefined && !canonicalResource(form.resource)) throw new OAuthError('invalid_target', 'resource is a URL');
      if (form.grant_type === 'authorization_code') return c.json(await exchangeCode(db, client, { code: form.code, redirectUri: form.redirect_uri, verifier: form.code_verifier, resource: form.resource }), 200, NO_STORE);
      if (form.grant_type === 'refresh_token') return c.json(await refreshTokens(db, client, { refreshToken: form.refresh_token, scope: form.scope, resource: form.resource }), 200, NO_STORE);
      throw new OAuthError('unsupported_grant_type', 'grant_type is authorization_code or refresh_token');
    } catch (error) {
      if (error instanceof OAuthError) return oauthFailure(c, error);
      throw error;
    }
  });

  /** RFC 7009: always 200, whether or not the token was known, so nothing is learned by asking. */
  app.post('/oauth/revoke', async (c) => {
    const form = await formOf(c);
    const credentials = credentialsOf(c, form);
    let clientId: string | undefined;
    if (credentials.id) {
      try {
        const client = await getClient(db, credentials.id, fetcher);
        await authenticateClient(db, client, credentials.secret);
        clientId = client.id;
      } catch (error) {
        if (error instanceof OAuthError) return oauthFailure(c, error);
        throw error;
      }
    }
    await revokeOAuthToken(db, form.token, clientId);
    return c.body(null, 200, NO_STORE);
  });

  // The consent page's own questions: signed in on the site, never with a token (tokens.ts refuses /v1/oauth).
  app.get('/v1/oauth/requests/:id', async (c) => {
    await signedIn(c);
    const view = await authorizationRequest(db, c.req.param('id'));
    if (!view) throw new HttpError(404, 'this request to connect is over (answered, or older than half an hour); start again from the app');
    return c.json(view, 200, NO_STORE);
  });

  app.post('/v1/oauth/requests/:id', async (c) => {
    const by = await signedIn(c);
    const input = (await c.req.json().catch(() => ({}))) as { approve?: unknown; scopes?: unknown };
    if (typeof input.approve !== 'boolean') throw new HttpError(400, 'say approve: true or false');
    try {
      return c.json(await decideAuthorization(db, c.req.param('id'), by, { approve: input.approve, scopes: input.scopes }, apiOrigin(c)), 200, NO_STORE);
    } catch (error) {
      if (error instanceof OAuthError) throw new HttpError(404, error.message);
      throw error;
    }
  });
}
