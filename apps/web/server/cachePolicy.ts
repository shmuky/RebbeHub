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

import { isbot } from 'isbot';

/** The session cookie the API sets through the site (services/api/src/auth.ts). */
const SESSION = /(?:^|;\s*)(?:__Host-)?rh_session=/;

/** Whether the request comes from someone signed in. */
export const hasSession = (request: Request): boolean => SESSION.test(request.headers.get('cookie') ?? '');

/** What a signed-in person's pages say: theirs alone, and checked again each time. */
export const PERSONAL = 'private, no-cache';

/** What a page anyone may see says: a minute in the browser, five at the edge, then served stale for an hour while it is made again. */
export const PUBLIC_PAGE = 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600';

/** Addresses that only pass a signed-in person's requests on to the API, and connecting an app (each asking is its own): never from the edge. */
const PASSAGES = /^\/(_|oauth)\//;

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

/**
 * What an item's page says: it changes only when someone's Suggestion is
 * approved, so the edge keeps it an hour (a crawler's second visit, and the
 * next reader's, cost nothing), then serves it stale for a day while it is
 * made again. Whoever made the change is signed in and sees it at once.
 */
export const ITEM_PAGE = 'public, max-age=60, s-maxage=3600, stale-while-revalidate=86400';

/** The search engines people find the site through: each gets a budget of its own. */
const SEARCH_ENGINES = /googlebot|google-inspectiontool|bingbot|applebot|duckduckbot|yandex|baiduspider|yeti|seznambot|qwantbot|petalbot/i;

/** What a crawler needs to find the rest, each one query or none and kept an hour: never counted. */
const CRAWLER_GUIDES = /^\/(robots\.txt|sitemap\.xml|sitemaps\/[^/]+\.xml|llms(-full)?\.txt)$/;

/**
 * Which budget a request's page is made from, when a crawler asks for one
 * that is not already at the edge: every search engine its own, every
 * other bot (AI crawlers, SEO tools, scrapers) one shared between them.
 * People are never counted (null).
 *
 * Making a page no one has asked for lately costs the database one to two
 * dozen reads, and a crawler asks for tens of thousands of them; without a
 * budget one crawl can use a day's reads (docs/operations.md, "Crawlers").
 */
export function crawlBudget(request: Request): { key: string; searchEngine: boolean } | null {
  const agent = request.headers.get('user-agent') ?? '';
  if (!isbot(agent) || CRAWLER_GUIDES.test(new URL(request.url).pathname)) return null;
  const engine = SEARCH_ENGINES.exec(agent)?.[0]?.toLowerCase();
  return engine ? { key: `search:${engine}`, searchEngine: true } : { key: 'bots', searchEngine: false };
}

/**
 * The answer for a crawler over its budget: come back later. Search engines
 * read 503 with Retry-After as "slow down", not as a missing page, and
 * nothing keeps it.
 */
export function crawlLater(): Response {
  return new Response('Busy: please crawl more slowly.', {
    status: 503,
    headers: { 'Retry-After': '120', 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
