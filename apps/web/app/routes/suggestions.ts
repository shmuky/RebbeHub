import type { Route } from './+types/suggestions';
import { siteOf } from '../lib/context.server.js';
import { passThrough } from '../lib/pass.server.js';

/** Suggestions and their review, from the site's own pages: /_/suggestions/* to the API's /v1/suggestions/*. Only these addresses pass. */
const ALLOWED = /^(quick|\d+|\d+\/(approve|send-back|withdraw))?$/;

async function pass({ request, params, context }: Route.LoaderArgs | Route.ActionArgs) {
  const path = params['*'] ?? '';
  if (!ALLOWED.test(path)) return new Response('Not found', { status: 404 });
  return passThrough(siteOf(context).api, request, `/v1/suggestions${path ? `/${path}` : ''}`);
}

export const loader = pass;
export const action = pass;
