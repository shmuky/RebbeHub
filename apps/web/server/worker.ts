import { WorkerEntrypoint } from 'cloudflare:workers';
import type { ServerBuild } from 'react-router';
import { edgeCacheable, forEdge } from './cachePolicy.js';
import { createSiteHandler } from './handler.js';
// @ts-ignore - made by `react-router build`
import * as build from '../build/server/index.js';

/**
 * The site on Cloudflare Workers. Static assets (build/client) are served
 * by the Workers assets binding before this runs; the API is reached
 * through the API service binding when there is one, else over HTTPS.
 *
 * Two entrypoints (wrangler.toml, [exports]): this default one runs on
 * every request and is never cached; `CachedSite` renders pages and sits
 * behind Cloudflare's Workers cache, which keeps what it answers for as
 * long as its Cache-Control says (root.tsx: five minutes, then stale while
 * it is made again). Pages for anyone go through `CachedSite`, so a burst
 * of readers or a crawler is answered from the edge; a signed-in person's
 * pages, and everything that is not a GET, are made here, fresh.
 */
interface Env {
  API_URL: string;
  SITE_URL: string;
  API?: { fetch: (input: string, init?: RequestInit) => Promise<Response> };
  /** Searches per address a minute ([[ratelimits]] in wrangler.toml); without it, none are counted. */
  RATE_LIMIT_SEARCH?: { limit(input: { key: string }): Promise<{ success: boolean }> };
}

interface Ctx {
  waitUntil(promise: Promise<unknown>): void;
  exports?: { CachedSite?: { fetch(request: Request): Promise<Response> } };
}

let handler: ((request: Request) => Promise<Response>) | null = null;

function site(env: Env) {
  handler ??= createSiteHandler(build as unknown as ServerBuild, {
    apiUrl: env.API_URL,
    siteUrl: env.SITE_URL,
    fetch: env.API ? (input, init) => env.API!.fetch(input, init) : undefined,
  });
  return handler;
}

/** Search asks the database (and, by meaning, a model) something new each time: an address may search a limited number of times a minute. */
const SEARCHING = /^\/(search|_\/find|_\/lookup)$/;

export class CachedSite extends WorkerEntrypoint<Env> {
  fetch(request: Request): Promise<Response> {
    return site(this.env)(request);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    const address = request.headers.get('cf-connecting-ip');
    if (env.RATE_LIMIT_SEARCH && address && SEARCHING.test(new URL(request.url).pathname) && !(await env.RATE_LIMIT_SEARCH.limit({ key: address })).success) {
      return new Response('Too many searches; wait a minute.', { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    const cached = ctx.exports?.CachedSite;
    if (cached && edgeCacheable(request)) return cached.fetch(forEdge(request));
    return site(env)(request);
  },
};
