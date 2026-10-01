import { Catalog } from '@rebbehub/core';
import { connectPostgres, measured, type DbCost } from '@rebbehub/db';
import { createApp } from './app.js';
import { r2Store, r2Writer, statusStore, type R2Bucket } from './r2.js';

/**
 * The API answering the site's own reads inside the site's Worker
 * (apps/web/server/worker.ts). A page is made from one to two dozen reads
 * of the API, and each was a Worker invocation of its own through the
 * service binding, with a connection to Postgres of its own: a few
 * milliseconds each to set up, and a request may pass through 32
 * invocations in all, whatever the plan. Here they are calls on one
 * connection the page opens when it starts and closes when it is sent
 * (up to four at once, for the reads a page makes side by side). It is
 * the same app with the same routes, so the site still shows nothing
 * that is out of anyone else's reach (docs/operations.md, "Traffic and
 * crawlers").
 *
 * What a page cannot answer here goes on to the API's Worker: anything
 * signed in (a cookie or a token, whose sessions and passkeys live
 * there), anything that is not a read, search by meaning (Workers AI),
 * the apps' catalog and Drive files, and what needs a bucket this Worker
 * is not given.
 */
export interface ReadsEnv {
  /** Postgres through Hyperdrive, the same config as the API's; without it, every read goes to the API's Worker. */
  HYPERDRIVE?: { connectionString: string };
  /** The public bucket (the status report, the texts of seforim), as the API has it. */
  FILES_PUBLIC?: R2Bucket;
  /** Sichos-Kodesh's published archive, which a sefer's text is first copied from. */
  SK_ARCHIVE?: R2Bucket;
  /** The API's public address: what the site's reads are addressed to, and where files are served from. */
  API_URL: string;
  SITE_URL?: string;
}

export interface Reader {
  /** Whether this read is answered here; else it goes to the API's Worker. */
  answers(input: string, init?: RequestInit): boolean;
  /** Answers a read this Worker answers itself. */
  answer(input: string, init?: RequestInit): Promise<Response>;
  /** What the reads answered here have cost the database, exactly, for the page's Server-Timing. */
  readonly cost: DbCost;
  /** Closes the page's connection, once its answer is sent. */
  close(): Promise<void>;
}

/**
 * What only the API's Worker answers: the apps' catalog (kept per isolate there), Drive files (its own limits and size cap),
 * search by meaning (Workers AI), and what needs settings only it is given: sign-in (`/v1/auth/me` asked as nobody still
 * says whether Google sign-in is on), and the mirrors' git addresses and keys.
 */
const ELSEWHERE = /^\/v1\/(app|drive|search\/similar|auth|mirrors)(\/|$)/;
/** What reads a bucket: answered here only with FILES_PUBLIC. */
const NEEDS_FILES = /^\/v1\/(status|texts)(\/|$)/;

/**
 * Whether a read of the API is one the site's Worker may answer itself: a
 * GET or HEAD of `/v1/…` as nobody (no cookie, no token), and not one of
 * what only the API's Worker answers.
 */
export function answeredHere(input: string, init: RequestInit | undefined, apiUrl: string, hasFiles: boolean): boolean {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;
  const headers = new Headers(init?.headers);
  if (headers.has('authorization') || headers.has('cookie')) return false;
  const base = apiUrl.replace(/\/$/, '');
  if (!input.startsWith(`${base}/v1/`)) return false;
  const path = new URL(input).pathname;
  if (ELSEWHERE.test(path)) return false;
  return hasFiles || !NEEDS_FILES.test(path);
}

/** A page's reader, or null where this Worker has no database (then every read goes through the service binding). */
export function readerFor(env: ReadsEnv, waitUntil: (work: Promise<unknown>) => void): Reader | null {
  if (!env.HYPERDRIVE) return null;
  const db = measured(connectPostgres(env.HYPERDRIVE.connectionString, { max: 4 }));
  const files = env.FILES_PUBLIC;
  const app = createApp({
    catalog: new Catalog(db),
    cost: () => db.cost,
    filesBaseUrl: env.API_URL,
    files: files ? r2Store(files) : undefined,
    texts: files ? { store: r2Store(files), writer: r2Writer(files), from: env.SK_ARCHIVE ? r2Store(env.SK_ARCHIVE) : undefined } : undefined,
    status: files ? statusStore(files) : undefined,
    siteUrl: env.SITE_URL,
    waitUntil,
  });
  return {
    cost: db.cost,
    answers: (input, init) => answeredHere(input, init, env.API_URL, files !== undefined),
    answer: (input, init) => Promise.resolve(app.fetch(new Request(input, init))),
    close: () => db.close(),
  };
}
