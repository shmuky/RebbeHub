/**
 * Who may be served a page from Cloudflare's edge, and what a page tells
 * caches (docs/operations.md, "Traffic and crawlers").
 *
 * Pages are made the same for everyone: loaders read the API as nobody,
 * and what is someone's own (their name, their inbox) is filled in by the
 * browser. So a page anyone may see is kept at the edge and served to the
 * next reader without reaching the Worker's render, the API or Postgres.
 * Someone signed in is not served from there: they may have just changed
 * the page, and should see it as it now is.
 */

/** The session cookie the API sets through the site (services/api/src/auth.ts). */
const SESSION = /(?:^|;\s*)(?:__Host-)?rh_session=/;

/** Whether the request comes from someone signed in. */
export const hasSession = (request: Request): boolean => SESSION.test(request.headers.get('cookie') ?? '');

/** What a signed-in person's pages say: theirs alone, and checked again each time. */
export const PERSONAL = 'private, no-cache';

/** What a page anyone may see says: a minute in the browser, five at the edge, then served stale for an hour while it is made again. */
export const PUBLIC_PAGE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600';

/** Addresses that only pass a signed-in person's requests on to the API: never from the edge. */
const PASSAGES = /^\/_\//;

/** Links shared on social sites and in newsletters carry these; the page is the same without them. */
const TRACKING = /^(utm_[a-z]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref_src)$/i;

/**
 * Whether a request may be answered from the edge cache: a GET or HEAD of a
 * page, from someone not signed in. Everything else reaches the Worker.
 */
export function edgeCacheable(request: Request): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  if (hasSession(request)) return false;
  return !PASSAGES.test(new URL(request.url).pathname);
}

/**
 * The request as the edge cache should see it: without tracking parameters,
 * so a link shared a thousand ways is one page in the cache, and without
 * cookies, which no page reads.
 */
export function forEdge(request: Request): Request {
  const url = new URL(request.url);
  for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
  const headers = new Headers(request.headers);
  headers.delete('cookie');
  return new Request(url.toString(), { method: request.method, headers, redirect: 'manual' });
}

/**
 * The Cache-Control a page goes out with: as its route said for anyone,
 * private for someone signed in, and never kept when it failed.
 */
export function withCachePolicy(request: Request, response: Response): Response {
  const said = response.headers.get('cache-control') ?? '';
  let policy: string | null = null;
  if (response.status >= 500) policy = 'no-store';
  else if (response.headers.has('set-cookie')) policy = said.includes('no-store') ? null : 'private, no-store';
  else if (hasSession(request) && !/\b(private|no-store)\b/.test(said)) policy = PERSONAL;
  if (policy === null || policy === said) return response;
  const out = new Response(response.body, response);
  out.headers.set('Cache-Control', policy);
  return out;
}
