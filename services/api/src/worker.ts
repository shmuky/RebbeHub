import { Catalog } from '@rebbehub/core';
import { connectPostgres } from '@rebbehub/db';
import { createApp, turnstileVerifier, type FileStore } from './app.js';
import { authFor } from './auth.js';

/**
 * The API on Cloudflare Workers: Postgres (Neon) through Hyperdrive, file
 * bytes from the public R2 bucket. Each request gets its own connection,
 * which Hyperdrive pools. Configured in wrangler.toml; secrets REPORT_SALT
 * and, for captchas on reports, TURNSTILE_SECRET.
 */
interface R2ObjectBody {
  body: ReadableStream;
  size: number;
}

interface R2Bucket {
  get(key: string, options?: { range?: { offset: number; length?: number } }): Promise<R2ObjectBody | null>;
}

interface Env {
  HYPERDRIVE: { connectionString: string };
  FILES_PUBLIC?: R2Bucket;
  REPORT_SALT?: string;
  TURNSTILE_SECRET?: string;
  /** Where files are served from, when not this Worker (a separate media domain). */
  FILES_BASE_URL?: string;
  /** The site's address (`https://rebbehub.org`): passkeys are bound to its domain, and sign-in happens on its pages. */
  SITE_URL?: string;
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
  async fetch(request: Request, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    const db = connectPostgres(env.HYPERDRIVE.connectionString, { max: 1 });
    const app = createApp({
      catalog: new Catalog(db),
      reportSalt: env.REPORT_SALT,
      verifyCaptcha: env.TURNSTILE_SECRET ? turnstileVerifier(env.TURNSTILE_SECRET) : undefined,
      filesBaseUrl: env.FILES_BASE_URL,
      files: env.FILES_PUBLIC ? r2Store(env.FILES_PUBLIC) : undefined,
      auth: env.SITE_URL ? authFor(env.SITE_URL) : undefined,
    });
    try {
      return await app.fetch(request);
    } finally {
      ctx.waitUntil(db.close());
    }
  },
};
