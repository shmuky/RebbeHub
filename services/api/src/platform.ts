import type { Context, MiddlewareHandler } from 'hono';

/**
 * What every route of the public API shares (docs/developers/api.md):
 * one shape for errors, cursors for lists, ETags and caching, CORS for
 * other sites' pages, and rate limits by address and by token. Kept apart
 * from the routes so a route only says what it answers.
 */

/** The one shape of every error: a code for programs, a sentence for people, and sometimes more. */
export interface ApiErrorBody {
  error: ErrorCode;
  message: string;
  detail?: unknown;
}

export type ErrorCode = 'bad-request' | 'unauthorized' | 'forbidden' | 'not-found' | 'conflict' | 'invalid' | 'rate-limited' | 'internal';

export const ERROR_CODES: Record<number, ErrorCode> = {
  400: 'bad-request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not-found',
  409: 'conflict',
  422: 'invalid',
  429: 'rate-limited',
  500: 'internal',
};

// ------------------------------------------------------------------ cursors

/**
 * A list's place, passed back as `cursor` for the next page. Opaque to
 * clients (`c1.` and base64url JSON), so how a list is ordered can change
 * without breaking anyone's loop. An older plain value (what `next` used to
 * be) is still read as it was.
 */
export const cursor = {
  encode(parts: ReadonlyArray<string | number>): string {
    const bytes = new TextEncoder().encode(JSON.stringify(parts));
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return `c1.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
  },
  /** The parts, or null when `raw` is not one of ours (then it is an older plain value). */
  decode(raw: string | undefined): Array<string | number> | null {
    if (!raw?.startsWith('c1.')) return null;
    try {
      const binary = atob(raw.slice(3).replace(/-/g, '+').replace(/_/g, '/'));
      const parts = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (ch) => ch.charCodeAt(0)))) as unknown;
      return Array.isArray(parts) && parts.every((p) => typeof p === 'string' || typeof p === 'number') ? parts : null;
    } catch {
      return null;
    }
  },
};

/** The page after this one, as a link header too (RFC 8288), for clients that follow links. */
export function nextLink(c: Context, next: string | null): void {
  if (!next) return;
  const url = new URL(c.req.url);
  url.searchParams.delete('after');
  url.searchParams.set('cursor', next);
  c.header('Link', `<${url.pathname}${url.search}>; rel="next"`);
}

// ------------------------------------------------------------------ CORS

const ALLOW_HEADERS = 'Authorization, Content-Type, If-None-Match, Range, Accept, Mcp-Session-Id, Mcp-Protocol-Version';
const EXPOSE_HEADERS = 'ETag, Link, Retry-After, RateLimit-Policy, Content-Range, Accept-Ranges, Content-Length, X-Credit, Mcp-Session-Id, Deprecation, Sunset';

/**
 * Any site's pages may read the API and send a token with it. Cookies are
 * never allowed across sites (no Allow-Credentials): a signed-in session
 * acts only from RebbeHub's own pages (auth.ts).
 */
export function cors(): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method === 'OPTIONS' && c.req.header('Access-Control-Request-Method')) {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': ALLOW_HEADERS,
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    await next();
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Expose-Headers', EXPOSE_HEADERS);
    c.header('X-Content-Type-Options', 'nosniff');
  };
}

// ------------------------------------------------------------------ caching

async function sha256Base64(bytes: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let binary = '';
  for (const b of digest.subarray(0, 18)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_');
}

/** Whether an If-None-Match header names this ETag (weakly, as RFC 9110 says GET compares). */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  const bare = (tag: string) => tag.trim().replace(/^W\//, '');
  return header.split(',').some((tag) => bare(tag) === bare(etag));
}

/**
 * Whether a request may be answered from Cloudflare's edge cache (the
 * Worker's `CachedApi` entrypoint, worker.ts): a GET or HEAD from nobody in
 * particular - no token, no session cookie - not asked for fresh
 * (`Cache-Control: no-cache`), that is not sign-in, the MCP
 * server, or a part of a file (a player asks for a file's bytes in ranges;
 * each range is read from R2 as it is asked for). The answers are the same for everyone who asks
 * so, so one kept answer serves them all.
 */
export function mayUseEdgeCache(request: Request): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  if (request.headers.has('authorization') || request.headers.has('cookie')) return false;
  // Asked for fresh (the site does so for someone signed in, who may have just changed it; a browser's hard reload does too).
  if (/no-cache|no-store/.test(request.headers.get('cache-control') ?? '') || request.headers.get('pragma') === 'no-cache') return false;
  const path = new URL(request.url).pathname;
  if (path === '/mcp' || path.startsWith('/v1/auth/')) return false;
  if (path.startsWith('/objects/') && request.headers.has('range')) return false;
  return true;
}

/**
 * How long an answer anyone may have is kept: a minute in browsers, two at
 * Cloudflare's edge (the Worker's cache, worker.ts), and served stale for
 * ten more while it is fetched again. A burst of readers asking the same
 * thing reaches the database about once in two minutes.
 */
export const PUBLIC_READ = 'public, max-age=60, s-maxage=120, stale-while-revalidate=600';

/** For answers that sum the whole catalog (counts, health, the community page): slow to change, dear to make. */
export const PUBLIC_SUMMARY = 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600';

/**
 * ETags on every JSON answer to a GET, and 304 when the client has it
 * already; a Cache-Control where the route set none: public for a minute
 * when nobody is signed in, else private and checked each time. The
 * answers differ by who asks, so caches keep them apart (Vary).
 */
export function caching(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const method = c.req.method;
    if (method !== 'GET' && method !== 'HEAD') return;
    const personal = Boolean(c.req.header('Authorization') || c.req.header('Cookie'));
    c.header('Vary', 'Authorization, Cookie, Accept-Encoding');
    if (c.res.status !== 200) return;
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', personal ? 'private, no-cache' : PUBLIC_READ);
    const type = c.res.headers.get('Content-Type') ?? '';
    if (c.res.headers.has('ETag') || !/json/.test(type) || !c.res.body) return;
    const etag = `W/"${await sha256Base64(await c.res.clone().arrayBuffer())}"`;
    c.header('ETag', etag);
    if (etagMatches(c.req.header('If-None-Match'), etag)) {
      const headers = new Headers(c.res.headers);
      headers.delete('Content-Type');
      headers.delete('Content-Length');
      c.res = new Response(null, { status: 304, headers });
    }
  };
}

// ------------------------------------------------------------------ rate limits

/** Counts requests by key and says whether one more is allowed: Cloudflare's rate limiting binding has this shape. */
export interface RateLimiter {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

/**
 * The API's limits: by the caller's address for everyone, and by token for
 * requests that carry one (a token's own, larger allowance, so a script
 * behind a shared address is not cut off by its neighbours).
 */
export interface RateLimits {
  ip?: RateLimiter;
  key?: RateLimiter;
  /**
   * Searching, by words and by meaning, per address: dearer than reading an
   * item (a full-text query, or a model turning the question into numbers),
   * so it has its own, smaller allowance on top of the address's.
   */
  search?: RateLimiter;
  /** What the limiters allow, as the RateLimit-Policy header says it. */
  ipPerMinute?: number;
  searchPerMinute?: number;
  keyPerMinute?: number;
}

export const DEFAULT_IP_PER_MINUTE = 300;
export const DEFAULT_KEY_PER_MINUTE = 1200;
export const DEFAULT_SEARCH_PER_MINUTE = 60;

/** The routes counted against the search allowance. */
export const SEARCH_PATHS = /^\/v1\/search(\/|$)/;

/**
 * A limiter in this process's memory: a fixed window per key. For Node and
 * tests; on Workers each isolate would count alone, so the Worker uses
 * Cloudflare's rate limiting bindings instead (wrangler.toml).
 */
export function memoryRateLimiter(limit: number, periodSeconds = 60, now: () => number = () => Date.now()): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    async limit({ key }) {
      const at = now();
      const period = periodSeconds * 1000;
      if (windows.size > 10_000) for (const [k, w] of windows) if (at - w.start >= period) windows.delete(k);
      const window = windows.get(key);
      if (!window || at - window.start >= period) {
        windows.set(key, { start: at, count: 1 });
        return { success: limit >= 1 };
      }
      window.count += 1;
      return { success: window.count <= limit };
    },
  };
}

/**
 * The caller's address, as Cloudflare saw it. Only CF-Connecting-IP counts:
 * X-Forwarded-For is whatever the caller wrote. A request without it came
 * from inside (the site through its service binding, or a local server)
 * and is not limited here.
 */
export function callerAddress(c: Context): string | undefined {
  return c.req.header('CF-Connecting-IP') || undefined;
}
