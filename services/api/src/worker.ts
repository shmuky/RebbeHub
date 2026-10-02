import { WorkerEntrypoint } from 'cloudflare:workers';
import { Catalog, adviseSuggestions, deliverWebhooks, embedderFromEnv, sendNotifications } from '@rebbehub/core';
import { connectPostgres, isCatalogHeld, measured } from '@rebbehub/db';
import { createApp, turnstileVerifier } from './app.js';
import { r2Store, r2Writer, statusStore, type R2Bucket } from './r2.js';
import { AppReleases } from './appCatalog.js';
import { DEFAULT_IP_PER_MINUTE, DEFAULT_KEY_PER_MINUTE, DEFAULT_SEARCH_PER_MINUTE, mayUseEdgeCache, type RateLimiter } from './platform.js';
import { authFor } from './auth.js';
import { LOCKED_HEADER, lockOf, openedBy, ownersFrom, unlocked, type LockEnv } from './lock.js';
import { githubDispatch } from './machine.js';
import { resendMailer, workersAiAdvisor } from './mail.js';
import {
  FREE_CPU_MS,
  FREE_DAILY_QUERIES,
  STATUS_KEY,
  allowanceCheck,
  checkDatabase,
  explainDatabase,
  hyperdriveQueriesToday,
  jobsCheck,
  mcpAnswers,
  mcpRequest,
  probe,
  record,
  workersCheck,
  workersLoadToday,
  type CheckResult,
  type StatusReport,
  type StatusStore,
} from './status.js';

/**
 * The API on Cloudflare Workers: Postgres (Neon) through Hyperdrive, file
 * bytes from the public R2 bucket. Each request gets its own connection,
 * which Hyperdrive pools. Configured in wrangler.toml; secrets REPORT_SALT,
 * for captchas on reports TURNSTILE_SECRET, for Google sign-in
 * GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, for email (sign-in links,
 * notifications) RESEND_API_KEY, for the reviewer's advice and search by
 * meaning CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_AI_TOKEN, and for OAI-PMH the
 * administrators' address OAI_ADMIN_EMAIL. Each is off until set. Rate
 * limits come from the RATE_LIMIT_ADDRESS and RATE_LIMIT_TOKEN bindings
 * (docs/configuration.md); without them nothing is counted.
 */
interface Env extends LockEnv {
  /** While RebbeHub is private (lock.ts): accounts let in by token besides platform admins, comma separated. */
  OWNER_ACCOUNTS?: string;
  HYPERDRIVE: { connectionString: string };
  /** The site's Worker (a service binding), for the status checks; without it they ask SITE_URL over the internet. */
  SITE?: { fetch(request: Request): Promise<Response> };
  /** The Hyperdrive config's id (wrangler.toml), for counting its queries today. */
  HYPERDRIVE_ID?: string;
  /** Its daily allowance of queries (default 100000, the free plan's); 0 on a plan without one. */
  HYPERDRIVE_DAILY_QUERIES?: string;
  /** A token allowed Account Analytics: Read (a secret), for the status page's count of today's queries and the Workers' load; without it, not counted. */
  CLOUDFLARE_ANALYTICS_TOKEN?: string;
  /** The Workers whose load the status page shows, by name, comma-separated (default the site's and this one). */
  STATUS_WORKERS?: string;
  /** The plan's CPU allowance for one request, in milliseconds (default 10, the free plan's); 0 on a plan whose allowance does not matter. */
  WORKERS_CPU_MS?: string;
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
  /** Mirrors (docs/mirrors.md), all public values in [vars]: where the git mirror is cloned from (several, comma separated), */
  CATALOG_GIT_URL?: string;
  /** the release keys' public halves (base64, comma separated), */
  RELEASE_PUBLIC_KEYS?: string;
  /** and where dumps are served when not this Worker's /dumps. */
  DUMPS_BASE_URL?: string;
  /** Cloudflare rate limiting bindings (wrangler.toml, [[ratelimits]]): requests per caller's address, and per API token. */
  RATE_LIMIT_ADDRESS?: RateLimiter;
  RATE_LIMIT_TOKEN?: RateLimiter;
  /** Searches per address a minute, on top of the address's allowance. */
  RATE_LIMIT_SEARCH?: RateLimiter;
  /** What those bindings allow a minute, for the RateLimit-Policy header (they are set in wrangler.toml). */
  RATE_LIMIT_ADDRESS_PER_MINUTE?: string;
  RATE_LIMIT_TOKEN_PER_MINUTE?: string;
  RATE_LIMIT_SEARCH_PER_MINUTE?: string;
  /** Google Drive files read for the site (GET /v1/drive/<id>) per address a minute, on top of the address's allowance. */
  RATE_LIMIT_DRIVE?: RateLimiter;
  /** The largest Drive file passed on, in megabytes (default 300). */
  DRIVE_MAX_MB?: string;
  /** A GitHub token (a secret) that may only run this repository's workflows: someone asking for OCR or a transcript starts the free machine job at once; without it, the nightly run takes the request. */
  GITHUB_DISPATCH_TOKEN?: string;
  /** Whose workflows those are (default shmuky/RebbeHub). */
  GITHUB_REPO?: string;
}

interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
  /** The Worker's own entrypoints (ctx.exports): `CachedApi`, behind the Workers cache. */
  exports?: { CachedApi?: { fetch(request: Request): Promise<Response> } };
}

/** The apps' catalog as last built, kept for this isolate's life: each request asks only whether anything changed. */
const appReleases = new AppReleases();

const mailerOf = (env: Env) => (env.RESEND_API_KEY ? resendMailer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }) : undefined);

const list = (value: string | undefined) => (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);

export default {
  /**
   * Every few minutes (wrangler.toml, [triggers]): the status checks (status.ts) first; then, when the database
   * answered, webhooks get the merges they have not had yet, people who asked are emailed what changed in what
   * they follow, and suggestions waiting for review get the reviewer's advice. When it did not answer, those
   * wait for the next run rather than spend queries failing.
   */
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<void> {
    const db = connectPostgres(env.HYPERDRIVE.connectionString, { max: 1 });
    const catalog = new Catalog(db);
    const mailer = mailerOf(env);
    const jobs = async (): Promise<string[]> => {
      const failed: string[] = [];
      const job = (name: string, work: () => Promise<unknown>) =>
        work().catch((error) => {
          // While an import holds the catalog the job waits for the next round; it has not failed.
          if (isCatalogHeld(error)) return;
          console.error(name, error);
          failed.push(name);
        });
      await job('webhooks', () => deliverWebhooks(catalog));
      if (mailer && env.SITE_URL) await job('email updates', () => sendNotifications(catalog, mailer, { siteUrl: new URL(env.SITE_URL!).origin }));
      if (env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_AI_TOKEN) {
        await job("the reviewer's advice", () => adviseSuggestions(catalog, workersAiAdvisor({ accountId: env.CLOUDFLARE_ACCOUNT_ID!, token: env.CLOUDFLARE_AI_TOKEN! })));
      }
      return failed;
    };
    const run = async () => {
      const now = new Date();
      const database = await checkDatabase(() => db.query('SELECT now()'));
      const failed = database.state === 'down' ? null : await jobs();
      await keepStatus(env, ctx, now, database, failed).catch((error) => console.error('status', error));
    };
    ctx.waitUntil(run().finally(() => db.close()));
  },

  /**
   * Every request comes here first, and is never cached here. A read anyone
   * may make goes on to `CachedApi`, behind Cloudflare's Workers cache
   * (wrangler.toml, [exports]), which keeps each answer as long as its
   * Cache-Control says (platform.ts): a burst of the same reads reaches
   * Postgres about once. What a token or a session asks, and every change,
   * is answered here, fresh.
   */
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    // While RebbeHub is private (lock.ts), nothing comes from the edge cache: the key opens it, else only an owner's token.
    const lock = await lockOf(env);
    if (lock) {
      if (await openedBy(request, lock)) {
        unlocked.add(request);
        return answer(request, env, ctx, true);
      }
      if (request.method === 'OPTIONS' || mayAsk(request)) return answer(request, env, ctx, true);
      return new Response(JSON.stringify({ error: 'unauthorized', message: 'RebbeHub is private for now' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', [LOCKED_HEADER]: '1' },
      });
    }
    const cached = ctx.exports?.CachedApi;
    if (cached && mayUseEdgeCache(request)) return cached.fetch(request);
    return answer(request, env, ctx);
  },
};

/**
 * While locked, what reaches the app without the key, to be answered for an owner alone (private.ts): a request with
 * a token, the MCP server (told how to connect), and connecting an app (OAuth).
 */
function mayAsk(request: Request): boolean {
  if (/^bearer\s/i.test(request.headers.get('Authorization') ?? '')) return true;
  return /^\/(mcp|\.well-known\/oauth-[a-z-]+(\/mcp)?|oauth\/(register|authorize|token|revoke))$/.test(new URL(request.url).pathname);
}

/** The API's answers to anyone's reads, kept at the edge (the Workers cache is switched on for this entrypoint alone). */
export class CachedApi extends WorkerEntrypoint<Env> {
  fetch(request: Request): Promise<Response> {
    return answer(request, this.env, this.ctx);
  }
}

async function answer(request: Request, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }, locked = false): Promise<Response> {
  // The request's own connection, counted: its answer says what it cost (Server-Timing).
  const db = measured(connectPostgres(env.HYPERDRIVE.connectionString, { max: 1 }));
  const app = createApp({
    catalog: new Catalog(db),
    cost: () => db.cost,
    reportSalt: env.REPORT_SALT,
    verifyCaptcha: env.TURNSTILE_SECRET ? turnstileVerifier(env.TURNSTILE_SECRET) : undefined,
    filesBaseUrl: env.FILES_BASE_URL,
    files: env.FILES_PUBLIC ? r2Store(env.FILES_PUBLIC) : undefined,
    texts: env.FILES_PUBLIC ? { store: r2Store(env.FILES_PUBLIC), writer: r2Writer(env.FILES_PUBLIC), from: env.SK_ARCHIVE ? r2Store(env.SK_ARCHIVE) : undefined } : undefined,
    uploads: env.FILES_PUBLIC && env.FILES_PRESERVATION ? { public: r2Writer(env.FILES_PUBLIC), preservation: r2Writer(env.FILES_PRESERVATION) } : undefined,
    status: env.FILES_PUBLIC ? statusStore(env.FILES_PUBLIC) : undefined,
    embedder: embedderFromEnv({ CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_AI_TOKEN: env.CLOUDFLARE_AI_TOKEN }),
    oai: env.OAI_ADMIN_EMAIL ? { adminEmail: env.OAI_ADMIN_EMAIL, siteUrl: env.SITE_URL } : undefined,
    mirrors: { gitUrls: list(env.CATALOG_GIT_URL), publicKeys: list(env.RELEASE_PUBLIC_KEYS), dumpsBaseUrl: env.DUMPS_BASE_URL || undefined },
    siteUrl: env.SITE_URL,
    rateLimits: {
      ip: env.RATE_LIMIT_ADDRESS,
      key: env.RATE_LIMIT_TOKEN,
      ipPerMinute: Number(env.RATE_LIMIT_ADDRESS_PER_MINUTE) || DEFAULT_IP_PER_MINUTE,
      keyPerMinute: Number(env.RATE_LIMIT_TOKEN_PER_MINUTE) || DEFAULT_KEY_PER_MINUTE,
      search: env.RATE_LIMIT_SEARCH,
      searchPerMinute: Number(env.RATE_LIMIT_SEARCH_PER_MINUTE) || DEFAULT_SEARCH_PER_MINUTE,
    },
    drive: { limiter: env.RATE_LIMIT_DRIVE, ...(Number(env.DRIVE_MAX_MB) > 0 ? { maxBytes: Number(env.DRIVE_MAX_MB) * 1024 * 1024 } : {}) },
    auth: env.SITE_URL ? authFor(env.SITE_URL, { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET }) : undefined,
    mailer: mailerOf(env),
    appReleases,
    machineDispatch: env.GITHUB_DISPATCH_TOKEN ? githubDispatch({ token: env.GITHUB_DISPATCH_TOKEN, repo: env.GITHUB_REPO }) : undefined,
    waitUntil: (work) => ctx.waitUntil(work),
    privateTo: locked ? { owners: ownersFrom(env.OWNER_ACCOUNTS) } : undefined,
  });
  try {
    return await app.fetch(request);
  } finally {
    ctx.waitUntil(db.close());
  }
}

/**
 * This run's checks, added to the kept report. The site is asked through its
 * service binding (a Worker cannot always reach another on the same zone over
 * the internet), for /about, which needs neither the API nor the database; the
 * API and the MCP server are this Worker's own answers, made as for anyone.
 */
async function keepStatus(env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }, now: Date, database: CheckResult, failedJobs: string[] | null): Promise<void> {
  if (!env.FILES_PUBLIC) return;
  const bucket = env.FILES_PUBLIC;
  const siteOrigin = new URL(env.SITE_URL ?? 'https://rebbehub.org').origin;
  const site = env.SITE ? (request: Request) => env.SITE!.fetch(request) : (request: Request) => fetch(request);
  const self = (request: Request) => answer(request, env, ctx);
  const apiOrigin = 'https://api.rebbehub.org';
  const limit = env.HYPERDRIVE_DAILY_QUERIES === undefined || env.HYPERDRIVE_DAILY_QUERIES === '' ? FREE_DAILY_QUERIES : Number(env.HYPERDRIVE_DAILY_QUERIES) || null;
  const cpuLimit = env.WORKERS_CPU_MS === undefined || env.WORKERS_CPU_MS === '' ? FREE_CPU_MS : Number(env.WORKERS_CPU_MS) || null;
  const scripts = (env.STATUS_WORKERS ?? 'rebbehub-web,rebbehub-api').split(',').map((s) => s.trim()).filter(Boolean);
  const analytics = env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_ANALYTICS_TOKEN ? { accountId: env.CLOUDFLARE_ACCOUNT_ID, token: env.CLOUDFLARE_ANALYTICS_TOKEN } : null;
  const [siteCheck, apiCheck, mcpCheck, used, load] = await Promise.all([
    // A fresh page each time, not the edge's copy: the Worker itself must answer.
    // While RebbeHub is private the site answers its lock page: the Worker itself answered.
    probe('site', site, new Request(`${siteOrigin}/about?status=${now.getTime()}`, { headers: { 'Cache-Control': 'no-cache' } }), async (r) => (r.ok || r.headers.has(LOCKED_HEADER) ? null : `answered ${r.status}`)),
    probe('api', self, new Request(`${apiOrigin}/openapi.json`)),
    probe('mcp', self, mcpRequest(apiOrigin), mcpAnswers),
    analytics && env.HYPERDRIVE_ID ? hyperdriveQueriesToday({ ...analytics, configId: env.HYPERDRIVE_ID, now }) : Promise.resolve(null),
    analytics ? workersLoadToday({ ...analytics, scripts, now }) : Promise.resolve(null),
  ]);
  const { check: quotaCheck, quota } = allowanceCheck(used, limit, now);
  const previous = await statusStore(bucket).read().catch(() => null);
  const report = record(previous, [siteCheck, apiCheck, mcpCheck, explainDatabase(database, quotaCheck), quotaCheck, workersCheck(load, cpuLimit), jobsCheck(failedJobs)], now, quota, load);
  await bucket.put(STATUS_KEY, JSON.stringify(report), { httpMetadata: { contentType: 'application/json', cacheControl: 'no-store' } });
}
