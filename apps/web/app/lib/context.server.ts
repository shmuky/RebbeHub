import { RebbeHubApi } from './api.js';

/**
 * What every loader gets from the server it runs on: the API client, and
 * the site's own address for canonical links. The Node and Worker entries
 * (server/) pass these in; under `react-router dev` they come from the
 * environment.
 */
export interface SiteContext {
  api: RebbeHubApi;
  siteUrl: string;
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
