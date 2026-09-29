import { createRequestHandler, type ServerBuild } from 'react-router';
import { RebbeHubApi } from '../app/lib/api.js';
import { hasSession, withCachePolicy } from './cachePolicy.js';

export interface SiteOptions {
  /** The public API, e.g. https://api.rebbehub.org */
  apiUrl: string;
  /** The site's own address, for canonical links and sitemaps. */
  siteUrl: string;
  /** How the site reaches the API; a Worker can pass a service binding's fetch. */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
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

/** The site as one fetch handler: the same on Node, on Workers and in tests. */
export function createSiteHandler(build: ServerBuild, options: SiteOptions, mode: 'production' | 'development' = 'production') {
  const handle = createRequestHandler(build, mode);
  const base = options.apiUrl.replace(/\/$/, '');
  const api = new RebbeHubApi(base, options.fetch);
  // Someone signed in may have just changed what they are looking at: their pages ask the API past its edge cache.
  const send = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const fresh = new RebbeHubApi(base, (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Cache-Control', 'no-cache');
    return send(input, { ...init, headers });
  });
  return async (request: Request) =>
    withoutTrailingSlash(request) ?? withCachePolicy(request, await handle(request, { site: { api: hasSession(request) ? fresh : api, siteUrl: options.siteUrl } }));
}
