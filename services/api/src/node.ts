import { serve } from '@hono/node-server';
import { Catalog } from '@rebbehub/core';
import { connectPostgres } from '@rebbehub/db';
import { openPGlite } from '@rebbehub/db/pglite';
import { createApp } from './app.js';
import { authFor } from './auth.js';

/**
 * The API on Node, for local work: `npm run dev:api`.
 *
 *   DATABASE_URL   a Postgres server; without it, a PGlite database in .data/pglite
 *   PORT           default 8787
 *   SITE_URL       the site signing in happens on (default http://localhost:5173)
 *   DEV_ACCOUNT    sign every request in as this account - local testing only,
 *                  refused unless the server listens on localhost
 */
const url = process.env.DATABASE_URL;
const db = url ? connectPostgres(url) : await openPGlite(process.env.PGLITE_DIR ?? '.data/pglite');
const catalog = new Catalog(db);
await catalog.init();

const devAccount = process.env.DEV_ACCOUNT;
const hostname = process.env.HOST ?? '127.0.0.1';
if (devAccount && hostname !== '127.0.0.1' && hostname !== 'localhost') {
  throw new Error('DEV_ACCOUNT signs every request in; it is only for a server on localhost');
}
if (devAccount) await catalog.createAccount({ id: devAccount, displayName: devAccount });

const app = createApp({ catalog, authenticate: devAccount ? () => devAccount : undefined, auth: authFor(process.env.SITE_URL ?? 'http://localhost:5173'), filesBaseUrl: process.env.FILES_BASE_URL });
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname });
console.log(`RebbeHub API on http://${hostname}:${port}/v1 (${url ? 'Postgres' : 'PGlite'}${devAccount ? `, signed in as ${devAccount}` : ''})`);
