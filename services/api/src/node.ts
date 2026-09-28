import { serve } from '@hono/node-server';
import { Catalog, embedderFromEnv } from '@rebbehub/core';
import { connectPostgres } from '@rebbehub/db';
import { openPGlite } from '@rebbehub/db/pglite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createApp, type FileStore } from './app.js';
import { authFor } from './auth.js';

/**
 * The API on Node, for local work: `npm run dev:api`.
 *
 *   DATABASE_URL   a Postgres server; without it, a PGlite database in .data/pglite
 *   PORT           default 8787
 *   FILES_DIR      a folder standing in for the two buckets, to try uploads
 *   SITE_URL       the site signing in happens on (default http://localhost:5173)
 *   DEV_ACCOUNT    sign every request in as this account - local testing only,
 *                  refused unless the server listens on localhost
 *   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_AI_TOKEN   search by meaning (Workers AI)
 *   OAI_ADMIN_EMAIL                              OAI-PMH at /oai
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

// FILES_DIR: the two buckets as folders on this machine (public/ and preservation/), for trying uploads without R2.
const filesDir = process.env.FILES_DIR;
const folder = (name: string) => ({
  async put(key: string, bytes: ArrayBuffer) {
    const path = join(filesDir!, name, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, new Uint8Array(bytes));
  },
});
const publicFolder: FileStore | undefined = filesDir
  ? {
      async get(key, range) {
        const bytes = await readFile(join(filesDir, 'public', key)).catch(() => null);
        if (!bytes) return null;
        const part = range ? bytes.subarray(range.offset, range.length === undefined ? undefined : range.offset + range.length) : bytes;
        return { body: new Blob([part]).stream(), size: bytes.byteLength };
      },
    }
  : undefined;

const app = createApp({
  catalog,
  authenticate: devAccount ? () => devAccount : undefined,
  auth: authFor(process.env.SITE_URL ?? 'http://localhost:5173', { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }),
  filesBaseUrl: process.env.FILES_BASE_URL,
  files: publicFolder,
  uploads: filesDir ? { public: folder('public'), preservation: folder('preservation') } : undefined,
  embedder: embedderFromEnv(process.env),
  oai: process.env.OAI_ADMIN_EMAIL ? { adminEmail: process.env.OAI_ADMIN_EMAIL, siteUrl: process.env.SITE_URL } : undefined,
});
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname });
console.log(`RebbeHub API on http://${hostname}:${port}/v1 (${url ? 'Postgres' : 'PGlite'}${devAccount ? `, signed in as ${devAccount}` : ''})`);
