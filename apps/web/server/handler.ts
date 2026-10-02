import type { DbCost } from '@rebbehub/db';
import { createRequestHandler, type ServerBuild } from 'react-router';
import { RebbeHubApi } from '../app/lib/api.js';
import { hasSession, withCachePolicy } from './cachePolicy.js';

/** The header the lock's key goes in (services/api/src/lock.ts). */
const LOCK_HEADER = 'x-rebbehub-key';

export interface SiteOptions {
  /** The public API, e.g. https://api.rebbehub.org */
  apiUrl: string;
  /** The site's own address, for canonical links and sitemaps. */
  siteUrl: string;
  /** How the site reaches the API; a Worker can pass a service binding's fetch. */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

/**
 * A page's own reader: the API answering the page's reads inside the
 * site's Worker, on one connection (`readerFor` in @rebbehub/api). What it
 * does not answer goes the way `fetch` goes; what it answered cost the
 * database `cost`, counted whole.
 */
export interface PageReader {
  answers(input: string, init?: RequestInit): boolean;
  answer(input: string, init?: RequestInit): Promise<Response>;
  readonly cost: DbCost;
}

/**
 * One address per page: `/sample/` is `/sample`, sent on in one permanent
 * redirect, so search engines never hold two copies of a page.
 */
function withoutTrailingSlash(request: Request): Response | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const url = new URL(request.url);
  if (url.pathname.length < 2 || !url.pathname.endsWith('/')) return null;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  return new Response(null, { status: 301, headers: { Location: `${path}${url.search}`, 'Cache-Control': 'public, max-age=3600, s-maxage=86400' } });
}

/**
 * What every answer says to browsers, whatever made it: never guess a
 * file's type, only HTTPS from now on, send other sites only our address
 * (not the page's query), and no camera, microphone or location.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=31536000',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function secured(response: Response, timing: string): Response {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) if (!out.headers.has(name)) out.headers.set(name, value);
  out.headers.set('Server-Timing', timing);
  return out;
}

type Send = NonNullable<SiteOptions['fetch']>;

/**
 * What a page cost, for whoever looks (the Timing tab of a browser's
 * DevTools, or `curl -sI`; docs/operations.md, "The statement budget"):
 * how many times it asked the API and how long it waited on those answers
 * together (`api`; some are asked side by side, so this can exceed the
 * whole), what the API says those answers cost the database (`db`: the
 * statements and their time, summed from each answer's own Server-Timing;
 * an answer the edge had already is counted as from the edge and cost
 * nothing now), and the whole (`total`), in milliseconds.
 */
class Meter {
  calls = 0;
  fromEdge = 0;
  here = 0;
  apiMs = 0;
  statements = 0;
  dbMs = 0;

  /**
   * The page's reads: what its own reader answers, counted as answered
   * here (its cost is taken whole at the end, since each such answer's
   * Server-Timing says what the page's connection has done so far), and
   * the rest sent on, each answer saying what it cost.
   */
  wrap(send: Send, reader?: PageReader): Send {
    return async (input, init) => {
      this.calls++;
      const started = performance.now();
      const own = reader?.answers(input, init) ?? false;
      try {
        const response = await (own ? reader!.answer(input, init) : send(input, init));
        if (own) this.here++;
        else this.read(response.headers);
        return response;
      } finally {
        this.apiMs += performance.now() - started;
      }
    };
  }

  /** What the page's own reader cost the database, once its reads are done. */
  add(cost: DbCost): void {
    this.statements += cost.statements;
    this.dbMs += cost.ms;
  }

  private read(headers: Headers): void {
    if (headers.get('cf-cache-status') === 'HIT') {
      this.fromEdge++;
      return;
    }
    const said = /\bdb;dur=([\d.]+);desc="(\d+) statements"/.exec(headers.get('server-timing') ?? '');
    if (!said) return;
    this.dbMs += Number(said[1]);
    this.statements += Number(said[2]);
  }

  header(started: number): string {
    const calls = `${this.calls} calls${this.here ? `, ${this.here} answered here` : ''}${this.fromEdge ? `, ${this.fromEdge} from the edge` : ''}`;
    return `api;dur=${this.apiMs.toFixed(1)};desc="${calls}", db;dur=${this.dbMs.toFixed(1)};desc="${this.statements} statements", total;dur=${(performance.now() - started).toFixed(1)}`;
  }
}

/**
 * The site as one fetch handler: the same on Node, on Workers and in tests.
 * A page's `reader`, when the Worker has one, answers the page's reads
 * itself (server/worker.ts); the rest go as `options.fetch` goes.
 */
export function createSiteHandler(build: ServerBuild, options: SiteOptions, mode: 'production' | 'development' = 'production') {
  const handle = createRequestHandler(build, mode);
  const base = options.apiUrl.replace(/\/$/, '');
  const reach: Send = options.fetch ?? ((input, init) => fetch(input, init));
  return async (request: Request, reader?: PageReader, key?: string) => {
    const started = performance.now();
    // The request's own count of what it asks the API, so its answer can say what it cost.
    const meter = new Meter();
    // While RebbeHub is private, the visitor's key goes with every question to the API (services/api/src/lock.ts).
    const reachWithKey: Send = key
      ? (input, init) => {
          const headers = new Headers(init?.headers);
          headers.set(LOCK_HEADER, key);
          return reach(input, { ...init, headers });
        }
      : reach;
    const send = meter.wrap(reachWithKey, reader);
    const api = new RebbeHubApi(base, send);
    // Someone signed in may have just changed what they are looking at: their pages ask the API past its edge cache.
    const fresh = new RebbeHubApi(base, (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Cache-Control', 'no-cache');
      return send(input, { ...init, headers });
    });
    const response = withoutTrailingSlash(request) ?? withCachePolicy(request, await handle(request, { site: { api: hasSession(request) ? fresh : api, siteUrl: options.siteUrl } }));
    if (reader) meter.add(reader.cost);
    return secured(response, meter.header(started));
  };
}
