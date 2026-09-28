import type { ServerBuild } from 'react-router';
import { createSiteHandler } from './handler.js';
// @ts-ignore - made by `react-router build`
import * as build from '../build/server/index.js';

/**
 * The site on Cloudflare Workers. Static assets (build/client) are served
 * by the Workers assets binding before this runs; the API is reached
 * through the API service binding when there is one, else over HTTPS.
 */
interface Env {
  API_URL: string;
  SITE_URL: string;
  API?: { fetch: (input: string, init?: RequestInit) => Promise<Response> };
}

let handler: ((request: Request) => Promise<Response>) | null = null;

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    handler ??= createSiteHandler(build as unknown as ServerBuild, {
      apiUrl: env.API_URL,
      siteUrl: env.SITE_URL,
      fetch: env.API ? (input, init) => env.API!.fetch(input, init) : undefined,
    });
    return handler(request);
  },
};
