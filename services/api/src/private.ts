import type { Context, MiddlewareHandler } from 'hono';
import { one } from '@rebbehub/db';
import type { Catalog } from '@rebbehub/core';
import { HttpError } from './app.js';
import { unlocked } from './lock.js';
import { mcpChallenge } from './oauth.js';

/**
 * While RebbeHub is private (lock.ts), what the API answers someone who did
 * not bring the key: only an owner's own token, from his MCP connector or
 * his scripts. An owner is a platform admin, or an account named in
 * OWNER_ACCOUNTS.
 *
 * Connecting an app (OAuth: the discovery documents, registering, the token
 * exchange) stays open, so his MCP connector can connect again; approving
 * the connection happens on the site's own page, behind the lock.
 */
const OPEN = /^\/(\.well-known\/oauth-[a-z-]+(\/mcp)?|oauth\/(register|authorize|token|revoke))$/;

export function ownersOnly(catalog: Catalog, owners: string[], authenticate: (c: Context) => Promise<string | null>): MiddlewareHandler {
  const isOwner = async (id: string): Promise<boolean> => {
    if (owners.includes(id)) return true;
    const person = await one<{ admin: boolean }>(catalog.db, 'SELECT admin FROM auth.person WHERE id = $1', [id]).catch(() => null);
    return Boolean(person?.admin);
  };
  return async (c, next) => {
    if (c.req.method === 'OPTIONS' || unlocked.has(c.req.raw) || OPEN.test(c.req.path)) return next();
    c.header('Cache-Control', 'no-store');
    const id = await authenticate(c);
    if (!id) {
      if (c.req.path === '/mcp') c.header('WWW-Authenticate', mcpChallenge(c));
      throw new HttpError(401, 'RebbeHub is private for now');
    }
    if (!(await isOwner(id))) throw new HttpError(403, 'RebbeHub is private for now');
    return next();
  };
}
