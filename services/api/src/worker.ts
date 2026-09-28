import { Catalog, deliverWebhooks } from '@rebbehub/core';
import { connectPostgres } from '@rebbehub/db';
import { createApp, turnstileVerifier, type FileStore } from './app.js';
import { authFor } from './auth.js';

/**
 * The API on Cloudflare Workers: Postgres (Neon) through Hyperdrive, file
 * bytes from the public R2 bucket. Each request gets its own connection,
 * which Hyperdrive pools. Configured in wrangler.toml; secrets REPORT_SALT,
 * for captchas on reports TURNSTILE_SECRET, and for Google sign-in
 * GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.
 */
interface R2ObjectBody {
  body: ReadableStream;
  size: number;
}

interface R2Bucket {
  get(key: string, options?: { range?: { offset: number; length?: number } }): Promise<R2ObjectBody | null>;
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
}

interface Env {
  HYPERDRIVE: { connectionString: string };
  FILES_PUBLIC?: R2Bucket;
  /** Uploaded bytes whose rights do not let them be served. Written, never read: nothing here is served. */
  FILES_PRESERVATION?: R2Bucket;
  /** Sichos-Kodesh's published archive, read only: texts are copied from it once, into FILES_PUBLIC. */
  SK_ARCHIVE?: R2Bucket;
  REPORT_SALT?: string;
  TURNSTILE_SECRET?: string;
  /** Where files are served from, when not this Worker (a separate media domain). */
  FILES_BASE_URL?: string;
  /** The site's address (`https://rebbehub.org`): passkeys are bound to its domain, and sign-in happens on its pages. */
  SITE_URL?: string;
  /** Google sign-in's client (secrets); without both, sign-in is by passkey alone. */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

function r2Writer(bucket: R2Bucket) {
  return { put: async (key: string, bytes: ArrayBuffer, mime: string) => void (await bucket.put(key, bytes, { httpMetadata: { contentType: mime } })) };
}

function r2Store(bucket: R2Bucket): FileStore {
  return {
    async get(key, range) {
      const object = await bucket.get(key, range ? { range } : undefined);
      return object ? { body: object.body, size: object.size } : null;
    },
  };
}

export default {
  /** Every few minutes (wrangler.toml, [triggers]): webhooks get the merges they have not had yet. */
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<void> {
    const db = connectPostgres(env.HYPERDRIVE.connectionString, { max: 1 });
    ctx.waitUntil(
      deliverWebhooks(new Catalog(db))
        .catch((error) => console.error('webhooks', error))
        .finally(() => db.close()),
    );
  },

  async fetch(request: Request, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    const db = connectPostgres(env.HYPERDRIVE.connectionString, { max: 1 });
    const app = createApp({
      catalog: new Catalog(db),
      reportSalt: env.REPORT_SALT,
      verifyCaptcha: env.TURNSTILE_SECRET ? turnstileVerifier(env.TURNSTILE_SECRET) : undefined,
      filesBaseUrl: env.FILES_BASE_URL,
      files: env.FILES_PUBLIC ? r2Store(env.FILES_PUBLIC) : undefined,
      texts: env.FILES_PUBLIC ? { store: r2Store(env.FILES_PUBLIC), writer: r2Writer(env.FILES_PUBLIC), from: env.SK_ARCHIVE ? r2Store(env.SK_ARCHIVE) : undefined } : undefined,
      uploads: env.FILES_PUBLIC && env.FILES_PRESERVATION ? { public: r2Writer(env.FILES_PUBLIC), preservation: r2Writer(env.FILES_PRESERVATION) } : undefined,
      auth: env.SITE_URL ? authFor(env.SITE_URL, { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }) : undefined,
    });
    try {
      return await app.fetch(request);
    } finally {
      ctx.waitUntil(db.close());
    }
  },
};
