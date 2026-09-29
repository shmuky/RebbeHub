import { one, type Db } from '@rebbehub/db';
import { base64url, hashToken } from './auth.js';
import { invalid, notFound } from './errors.js';
import { listConnections, oauthGrant, revokeConnection } from './oauth.js';

/**
 * Personal API tokens (migration 0018): how a person's scripts and agents
 * act as them through the API. A token is the person, no more: what they
 * send goes through the same suggestions, checks and review as what they
 * do on the site, and a suspended person's tokens sign nothing in.
 *
 * A token is `rhp_` and 43 letters (32 random bytes), shown once when it is
 * made; only its sha256 is kept. Tokens never manage sign-in, other tokens
 * or stewards' tools: those stay on the site's own pages.
 *
 * Apps a person connected with OAuth (oauth.ts) sign in the same way and
 * are listed and revoked beside these, with the app's name.
 */

export type TokenScope = 'read' | 'write';
export const TOKEN_SCOPES: readonly TokenScope[] = ['read', 'write'];
export const TOKEN_PREFIX = 'rhp_';
/** How many live tokens one person may hold. */
export const MAX_TOKENS_PER_PERSON = 20;

export interface ApiTokenView {
  id: string;
  /** A personal token made on the account page, or an app connected with OAuth (its name is the app's). */
  kind: 'personal' | 'oauth';
  name: string;
  /** The token's first characters, to tell it apart; never enough to use it. */
  prefix: string;
  scopes: TokenScope[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  /** For a connected app: the app as it names itself, and where it lives. */
  client?: { id: string; name: string; uri: string | null; host: string | null };
}

/** Who a token signs in, and what it may do. */
export interface TokenGrant {
  tokenId: string;
  /** The token's name, or the connected app's: what the site shows as the agent that sent a change. */
  name: string;
  personId: string;
  displayName: string;
  scopes: TokenScope[];
  /** For an app connected with OAuth: what its token was given for (RFC 8707), and the app. */
  resource?: string;
  client?: { id: string; name: string };
}

interface Row {
  id: string;
  name: string;
  prefix: string;
  scopes: TokenScope[];
  created_at: Date | string;
  last_used_at: Date | string | null;
  expires_at: Date | string | null;
  revoked_at: Date | string | null;
}

const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());

const view = (row: Row): ApiTokenView => ({
  id: row.id,
  kind: 'personal',
  name: row.name,
  prefix: row.prefix,
  scopes: row.scopes,
  createdAt: iso(row.created_at)!,
  lastUsedAt: iso(row.last_used_at),
  expiresAt: iso(row.expires_at),
  revokedAt: iso(row.revoked_at),
});

function random(bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  crypto.getRandomValues(out);
  return out;
}

/** Whether a string looks like one of our tokens at all (before any lookup). */
export function looksLikeToken(value: string): boolean {
  return /^rh[po]_[A-Za-z0-9_-]{43}$/.test(value);
}

/**
 * Makes a token for a person. Returns it whole, this once; afterwards only
 * its prefix is ever shown.
 */
export async function createApiToken(db: Db, personId: string, input: { name?: unknown; scopes?: unknown; expiresInDays?: unknown }): Promise<{ token: string; view: ApiTokenView }> {
  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim() : '';
  if (name.length < 1 || name.length > 80) throw invalid('give the token a name of 1 to 80 characters (what uses it)');
  const scopes = input.scopes === undefined ? (['read'] as TokenScope[]) : input.scopes;
  if (!Array.isArray(scopes) || scopes.length === 0 || !scopes.every((s) => TOKEN_SCOPES.includes(s as TokenScope))) throw invalid('scopes are read, write or both');
  let days: number | null = null;
  if (input.expiresInDays !== undefined && input.expiresInDays !== null) {
    if (typeof input.expiresInDays !== 'number' || !Number.isInteger(input.expiresInDays) || input.expiresInDays < 1 || input.expiresInDays > 3650) throw invalid('expiresInDays is a whole number of days, 1 to 3650');
    days = input.expiresInDays;
  }
  const live = await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM auth.api_token WHERE person_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())', [personId]);
  if ((live?.n ?? 0) >= MAX_TOKENS_PER_PERSON) throw invalid(`at most ${MAX_TOKENS_PER_PERSON} tokens at a time; revoke one you no longer use`);

  const token = `${TOKEN_PREFIX}${base64url(random(32))}`;
  const id = `tok-${base64url(random(9))}`;
  const row = await one<Row>(
    db,
    `INSERT INTO auth.api_token (id, person_id, name, prefix, token_hash, scopes, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::int IS NULL THEN NULL ELSE now() + make_interval(days => $7::int) END)
     RETURNING id, name, prefix, scopes, created_at, last_used_at, expires_at, revoked_at`,
    [id, personId, name, token.slice(0, TOKEN_PREFIX.length + 4), await hashToken(token), [...new Set(scopes as TokenScope[])], days],
  );
  return { token, view: view(row!) };
}

/** A person's tokens and connected apps, newest first, revoked ones included (marked). */
export async function listApiTokens(db: Db, personId: string): Promise<ApiTokenView[]> {
  const { rows } = await db.query<Row>('SELECT id, name, prefix, scopes, created_at, last_used_at, expires_at, revoked_at FROM auth.api_token WHERE person_id = $1 ORDER BY created_at DESC, id', [personId]);
  const all = [...rows.map(view), ...(await listConnections(db, personId))];
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
}

/** Revokes one of a person's tokens, or ends a connected app (`oac-…`); it stops working at once. */
export async function revokeApiToken(db: Db, personId: string, tokenId: string): Promise<void> {
  if (tokenId.startsWith('oac-')) {
    if (!(await revokeConnection(db, personId, tokenId))) throw notFound(`connection ${tokenId}`);
    return;
  }
  const row = await one<{ id: string }>(db, 'UPDATE auth.api_token SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1 AND person_id = $2 RETURNING id', [tokenId, personId]);
  if (!row) throw notFound(`token ${tokenId}`);
}

/** Revokes every token a person holds, and ends their connected apps (when they are suspended). */
export async function revokeAllApiTokens(db: Db, personId: string): Promise<number> {
  const { rows } = await db.query<{ id: string }>('UPDATE auth.api_token SET revoked_at = now() WHERE person_id = $1 AND revoked_at IS NULL RETURNING id', [personId]);
  const apps = await db.query<{ id: string }>('UPDATE auth.oauth_connection SET revoked_at = now() WHERE person_id = $1 AND revoked_at IS NULL RETURNING id', [personId]);
  return rows.length + apps.rows.length;
}

/**
 * Who a token signs in, or null when it is unknown, revoked or expired.
 * Its last use is kept to the minute, so the account page can show which
 * tokens are still in use without a write on every request.
 */
export async function tokenGrant(db: Db, token: string): Promise<TokenGrant | null> {
  if (!looksLikeToken(token)) return null;
  if (token.startsWith('rho_')) return oauthGrant(db, token);
  const row = await one<{ id: string; name: string; person_id: string; display_name: string; scopes: TokenScope[]; stale: boolean }>(
    db,
    `SELECT t.id, t.name, t.person_id, p.display_name, t.scopes,
            (t.last_used_at IS NULL OR t.last_used_at < now() - interval '1 minute') AS stale
     FROM auth.api_token t JOIN auth.person p ON p.id = t.person_id
     WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND (t.expires_at IS NULL OR t.expires_at > now())`,
    [await hashToken(token)],
  );
  if (!row) return null;
  if (row.stale) await db.query('UPDATE auth.api_token SET last_used_at = now() WHERE id = $1', [row.id]);
  return { tokenId: row.id, name: row.name, personId: row.person_id, displayName: row.display_name, scopes: row.scopes };
}
