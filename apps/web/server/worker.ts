import { WorkerEntrypoint } from 'cloudflare:workers';
import { readerFor, type ReadsEnv } from '@rebbehub/api';
import type { ServerBuild } from 'react-router';
import { crawlBudget, crawlLater, edgeCacheable, forEdge } from './cachePolicy.js';
import { createSiteHandler } from './handler.js';
import { door, privately, type DoorEnv } from './lock.js';
import { guestRequest, r2Showcases, showcaseMedia, type ShowcaseBucket } from './showcase.js';
// @ts-ignore - made by `react-router build`
import * as build from '../build/server/index.js';

/**
 * The site on Cloudflare Workers. Static assets (build/client) are served
 * by the Workers assets binding before this runs. A page's reads of the
 * API are answered in this Worker, by the API itself over one connection
 * to Postgres the page opens and closes (`readerFor` in @rebbehub/api:
 * the HYPERDRIVE and R2 bindings in wrangler.toml, the same as the API
 * Worker's); what the page cannot answer itself, and everything signed
 * in, goes through the API service binding when there is one, else over
 * HTTPS.
 *
 * Two entrypoints (wrangler.toml, [exports]): this default one runs on
 * every request and is never cached; `CachedSite` renders pages and sits
 * behind Cloudflare's Workers cache, which keeps what it answers for as
 * long as its Cache-Control says (root.tsx: five minutes, then stale while
 * it is made again). Pages for anyone go through `CachedSite`, so a burst
 * of readers or a crawler is answered from the edge; a signed-in person's
 * pages, and everything that is not a GET, are made here, fresh.
 *
 * `CachedSite` runs only when the edge has no copy, so that is where a
 * crawler's pages are counted against its budget (cachePolicy.ts,
 * crawlBudget): what is already at the edge is free and never counted.
 */
interface Env extends ReadsEnv, DoorEnv {
  API_URL: string;
  SITE_URL: string;
  /** Sichos-Kodesh's media proxy (JEM's audio), reached only from here while RebbeHub is private (wrangler.toml). */
  MEDIA?: { fetch(request: Request): Promise<Response> };
  /** The site's built files (build/client); the Worker runs first, so the lock covers them too (wrangler.toml). */
  ASSETS?: { fetch(request: Request): Promise<Response> };
  API?: { fetch: (input: string, init?: RequestInit) => Promise<Response> };
  /** Searches per address a minute ([[ratelimits]] in wrangler.toml); without it, none are counted. */
  RATE_LIMIT_SEARCH?: RateLimit;
  /** Pages made for each search engine's crawler a minute, and for all other bots together (wrangler.toml). */
  RATE_LIMIT_CRAWL_SEARCH?: RateLimit;
  RATE_LIMIT_CRAWL?: RateLimit;
}

interface RateLimit {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
  exports?: { CachedSite?: { fetch(request: Request): Promise<Response> } };
}

let handler: ReturnType<typeof createSiteHandler> | null = null;

function site(env: Env) {
  handler ??= createSiteHandler(build as unknown as ServerBuild, {
    apiUrl: env.API_URL,
    siteUrl: env.SITE_URL,
    fetch: env.API ? (input, init) => env.API!.fetch(input, init) : undefined,
    showcases: showcasesOf(env) ?? undefined,
  });
  return handler;
}

/** A page, made with a reader of its own when this Worker has a database; the reader's connection is closed once the page is sent. */
async function page(env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }, request: Request, key?: string): Promise<Response> {
  const reader = readerFor(env, (work) => ctx.waitUntil(work));
  if (!reader) return site(env)(request, undefined, key);
  try {
    return await site(env)(request, reader, key);
  } finally {
    ctx.waitUntil(reader.close());
  }
}

/** Showcases, kept in the public bucket (server/showcase.ts). */
const showcasesOf = (env: Env) => (env.FILES_PUBLIC ? r2Showcases(env.FILES_PUBLIC as unknown as ShowcaseBucket) : null);

/**
 * A guest with a showcase's link (app/lib/showcase.ts): its page, its data
 * and its transcripts are made like any page, privately; its files are
 * passed on as the showcase lists them; the site's built files are given.
 * Null for anything else, which goes to the lock as before.
 */
async function asGuest(request: Request, env: Env, ctx: Ctx): Promise<Response | null> {
  const guest = guestRequest(request);
  if (!guest) return null;
  if (guest.kind === 'file') {
    const file = env.ASSETS ? await env.ASSETS.fetch(request) : null;
    return file && file.status !== 404 ? file : null;
  }
  const showcase = await showcasesOf(env)?.get(guest.token);
  if (!showcase) return null;
  if (guest.kind === 'media') {
    const source = showcase.media[guest.index];
    if (!source) return new Response('Not found.', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const reader = readerFor(env, (work) => ctx.waitUntil(work));
    try {
      return await showcaseMedia(source, request, { apiUrl: env.API_URL, reader });
    } finally {
      if (reader) ctx.waitUntil(reader.close());
    }
  }
  return privately(await page(env, ctx, request));
}

/** Search asks the database (and, by meaning, a model) something new each time: an address may search a limited number of times a minute. */
const SEARCHING = /^\/(search|_\/find|_\/lookup)$/;

export class CachedSite extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    const crawler = crawlBudget(request);
    const budget = crawler && (crawler.searchEngine ? this.env.RATE_LIMIT_CRAWL_SEARCH : this.env.RATE_LIMIT_CRAWL);
    if (crawler && budget && !(await budget.limit({ key: crawler.key })).success) return crawlLater();
    return page(this.env, this.ctx, request);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    // A showcase's guest is let in to that page alone, before the lock (showcase.ts).
    const guest = await asGuest(request, env, ctx);
    if (guest) return guest;
    // While RebbeHub is private (lock.ts), the door comes first, for the built files too, and nothing is served from the edge cache.
    let key: string | undefined;
    const shut = await door(request, env, (opened) => (key = opened));
    if (shut) return shut;
    if (key) {
      const url = new URL(request.url);
      if (env.MEDIA && url.pathname.startsWith('/_/media/')) {
        // The recording's bytes, through the proxy's service binding; its range and caching headers go through as they are.
        const headers = new Headers();
        for (const name of ['range', 'if-none-match', 'if-modified-since', 'accept']) {
          const value = request.headers.get(name);
          if (value) headers.set(name, value);
        }
        return privately(await env.MEDIA.fetch(new Request(`https://media${url.pathname.slice('/_/media'.length)}${url.search}`, { method: request.method, headers })));
      }
      if (env.ASSETS && (request.method === 'GET' || request.method === 'HEAD')) {
        const file = await env.ASSETS.fetch(request);
        if (file.status !== 404) return privately(file);
      }
      return privately(await page(env, ctx, request, key));
    }
    if (env.ASSETS) {
      const file = await env.ASSETS.fetch(request);
      if (file.status !== 404) return file;
    }
    const address = request.headers.get('cf-connecting-ip');
    if (env.RATE_LIMIT_SEARCH && address && SEARCHING.test(new URL(request.url).pathname) && !(await env.RATE_LIMIT_SEARCH.limit({ key: address })).success) {
      return new Response('Too many searches; wait a minute.', { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    const cached = ctx.exports?.CachedSite;
    if (cached && edgeCacheable(request)) return cached.fetch(forEdge(request));
    return page(env, ctx, request);
  },
};
