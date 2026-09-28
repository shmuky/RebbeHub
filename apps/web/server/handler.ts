import { createRequestHandler, type ServerBuild } from 'react-router';
import { RebbeHubApi } from '../app/lib/api.js';

export interface SiteOptions {
  /** The public API, e.g. https://api.rebbehub.org */
  apiUrl: string;
  /** The site's own address, for canonical links and sitemaps. */
  siteUrl: string;
  /** How the site reaches the API; a Worker can pass a service binding's fetch. */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

/** The site as one fetch handler: the same on Node, on Workers and in tests. */
export function createSiteHandler(build: ServerBuild, options: SiteOptions, mode: 'production' | 'development' = 'production') {
  const handle = createRequestHandler(build, mode);
  const api = new RebbeHubApi(options.apiUrl.replace(/\/$/, ''), options.fetch);
  return (request: Request) => handle(request, { site: { api, siteUrl: options.siteUrl } });
}
