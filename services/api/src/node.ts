import { serve } from '@hono/node-server';
import { Catalog } from '@rebbehub/core';
import { connectPostgres } from '@rebbehub/db';
import { openPGlite } from '@rebbehub/db/pglite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createApp, type FileStore } from './app.js';
import { authFor } from './auth.js';
import { resendMailer } from './mail.js';
import { sendNotifications, type Mailer } from '@rebbehub/core';

/**
 * The API on Node, for local work: `npm run dev:api`.
 *
 *   DATABASE_URL   a Postgres server; without it, a PGlite database in .data/pglite
 *   PORT           default 8787
 *   FILES_DIR      a folder standing in for the two buckets, to try uploads
 *   SITE_URL       the site signing in happens on (default http://localhost:5173)
 *   DEV_ACCOUNT    sign every request in as this account - local testing only,
 *                  refused unless the server listens on localhost
 *   RESEND_API_KEY, EMAIL_FROM   email sign-in and notifications (looked
 *                  for every minute); DEV_EMAIL=1 prints email here instead
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

// Email: through Resend with its key, or printed here to try signing in by email locally.
const mailer: Mailer | undefined = process.env.RESEND_API_KEY
  ? resendMailer({ apiKey: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM })
  : process.env.DEV_EMAIL
    ? { send: async (message) => console.log(`\n--- email to ${message.to}: ${message.subject}\n${message.text}\n---`) }
    : undefined;

const app = createApp({
  mailer,
  catalog,
  authenticate: devAccount ? () => devAccount : undefined,
  auth: authFor(process.env.SITE_URL ?? 'http://localhost:5173', { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }),
  filesBaseUrl: process.env.FILES_BASE_URL,
  files: publicFolder,
  uploads: filesDir ? { public: folder('public'), preservation: folder('preservation') } : undefined,
});
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port, hostname });
console.log(`RebbeHub API on http://${hostname}:${port}/v1 (${url ? 'Postgres' : 'PGlite'}${devAccount ? `, signed in as ${devAccount}` : ''})`);
// What the Workers' cron does every few minutes, here every minute: notifications by email.
if (mailer) setInterval(() => void sendNotifications(catalog, mailer, { siteUrl: new URL(process.env.SITE_URL ?? 'http://localhost:5173').origin }).catch((error) => console.error('notifications', error)), 60_000);
