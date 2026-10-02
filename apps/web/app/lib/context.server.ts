import { RebbeHubApi } from './api.js';
import type { ShowcaseStore } from './showcase.js';

/**
 * What every loader gets from the server it runs on: the API client, and
 * the site's own address for canonical links. The Node and Worker entries
 * (server/) pass these in; under `react-router dev` they come from the
 * environment.
 */
export interface SiteContext {
  api: RebbeHubApi;
  siteUrl: string;
  /** Where showcases are kept, and whether this visitor may make them (lib/showcase.ts); unset, there are none. */
  showcases?: { store: ShowcaseStore; owner: boolean };
}

declare module 'react-router' {
  interface AppLoadContext {
    site?: SiteContext;
  }
}

export function siteOf(context: { site?: SiteContext } | undefined): SiteContext {
  if (context?.site) return context.site;
  return {
    api: new RebbeHubApi(process.env.REBBEHUB_API_URL ?? 'http://127.0.0.1:8787'),
    siteUrl: process.env.SITE_URL ?? 'http://localhost:5173',
  };
}
