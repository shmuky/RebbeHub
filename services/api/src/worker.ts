import { Catalog } from '@rebbehub/core';
import { connectPostgres } from '@rebbehub/db';
import { createApp, turnstileVerifier } from './app.js';

/**
 * The API on Cloudflare Workers, reaching Postgres (Neon) through
 * Hyperdrive. Each request gets its own connection, which Hyperdrive pools.
 * Set in wrangler.toml: the HYPERDRIVE binding; secrets REPORT_SALT and,
 * for captchas on reports, TURNSTILE_SECRET.
 */
interface Env {
  HYPERDRIVE: { connectionString: string };
  REPORT_SALT?: string;
  TURNSTILE_SECRET?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    const db = connectPostgres(env.HYPERDRIVE.connectionString, { max: 1 });
    const app = createApp({
      catalog: new Catalog(db),
      reportSalt: env.REPORT_SALT,
      verifyCaptcha: env.TURNSTILE_SECRET ? turnstileVerifier(env.TURNSTILE_SECRET) : undefined,
    });
    try {
      return await app.fetch(request);
    } finally {
      ctx.waitUntil(db.close());
    }
  },
};
