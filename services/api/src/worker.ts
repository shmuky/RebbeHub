import { Catalog, adviseSuggestions, deliverWebhooks, embedderFromEnv, sendNotifications } from '@rebbehub/core';
import { connectPostgres } from '@rebbehub/db';
import { createApp, turnstileVerifier, type FileStore } from './app.js';
import { authFor } from './auth.js';
import { resendMailer, workersAiAdvisor } from './mail.js';

/**
 * The API on Cloudflare Workers: Postgres (Neon) through Hyperdrive, file
 * bytes from the public R2 bucket. Each request gets its own connection,
 * which Hyperdrive pools. Configured in wrangler.toml; secrets REPORT_SALT,
 * for captchas on reports TURNSTILE_SECRET, for Google sign-in
 * GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, for email (sign-in links,
 * notifications) RESEND_API_KEY, for the reviewer's advice and search by
 * meaning CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN, and for OAI-PMH the
 * administrators' address OAI_ADMIN_EMAIL. Each is off until set.
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
  /** Resend's API key (a secret): email sign-in, notifications and takedown receipts; without it, none of them. */
  RESEND_API_KEY?: string;
  /** Who email comes from, on a domain verified with Resend (default `RebbeHub <no-reply@rebbehub.org>`). */
  EMAIL_FROM?: string;
  /** Workers AI (secrets), for the reviewer's advice on suggestions and search by meaning (a token allowed only Workers AI); without both, neither. */
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_AI_TOKEN?: string;
  /** The address OAI-PMH names for the repository's administrators; without it, /oai is not offered. */
  OAI_ADMIN_EMAIL?: string;
}

const mailerOf = (env: Env) => (env.RESEND_API_KEY ? resendMailer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }) : undefined);
  /** Mirrors (docs/mirrors.md), all public values in [vars]: where the git mirror is cloned from (several, comma separated), */
  CATALOG_GIT_URL?: string;
  /** the release keys' public halves (base64, comma separated), */
  RELEASE_PUBLIC_KEYS?: string;
  /** and where dumps are served when not this Worker's /dumps. */
  DUMPS_BASE_URL?: string;
}

const list = (value: string | undefined) => (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);

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
  /**
   * Every few minutes (wrangler.toml, [triggers]): webhooks get the merges they have not had yet; people who
   * asked are emailed what changed in what they follow; suggestions waiting for review get the reviewer's advice.
   */
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<void> {
    const db = connectPostgres(env.HYPERDRIVE.connectionString, { max: 1 });
    const catalog = new Catalog(db);
    const mailer = mailerOf(env);
    const run = async () => {
      await deliverWebhooks(catalog).catch((error) => console.error('webhooks', error));
      if (mailer && env.SITE_URL) await sendNotifications(catalog, mailer, { siteUrl: new URL(env.SITE_URL).origin }).catch((error) => console.error('notifications', error));
      if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_TOKEN) {
        await adviseSuggestions(catalog, workersAiAdvisor({ accountId: env.CLOUDFLARE_ACCOUNT_ID, token: env.CLOUDFLARE_AI_TOKEN })).catch((error) => console.error('advice', error));
      }
    };
    ctx.waitUntil(run().finally(() => db.close()));
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
      embedder: embedderFromEnv({ CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_AI_TOKEN: env.CLOUDFLARE_AI_TOKEN }),
      oai: env.OAI_ADMIN_EMAIL ? { adminEmail: env.OAI_ADMIN_EMAIL, siteUrl: env.SITE_URL } : undefined,
      mirrors: { gitUrls: list(env.CATALOG_GIT_URL), publicKeys: list(env.RELEASE_PUBLIC_KEYS), dumpsBaseUrl: env.DUMPS_BASE_URL || undefined },
      auth: env.SITE_URL ? authFor(env.SITE_URL, { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }) : undefined,
      mailer: mailerOf(env),
    });
    try {
      return await app.fetch(request);
    } finally {
      ctx.waitUntil(db.close());
    }
  },
};
