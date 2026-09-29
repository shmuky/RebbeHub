import type { Route } from './+types/oauth-pass';
import { siteOf } from '../lib/context.server.js';
import { passThrough } from '../lib/pass.server.js';

/**
 * The consent page's questions, from the site's own pages: /_/oauth/requests/<id>
 * to the API's /v1/oauth/requests/<id>, with the session. Only that address passes.
 */
async function pass({ request, params, context }: Route.LoaderArgs | Route.ActionArgs) {
  const path = params['*'] ?? '';
  if (!/^requests\/oar-[\w-]+$/.test(path)) return new Response('Not found', { status: 404 });
  return passThrough(siteOf(context).api, request, `/v1/oauth/${path}`);
}

export const loader = pass;
export const action = pass;
