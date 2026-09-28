import type { Route } from './+types/follows';
import { siteOf } from '../lib/context.server.js';
import { passThrough } from '../lib/pass.server.js';

/** Following, from the site's own pages: /_/follows to the API's /v1/follows. */
async function pass({ request, context }: Route.LoaderArgs | Route.ActionArgs) {
  return passThrough(siteOf(context).api, request, '/v1/follows');
}

export const loader = pass;
export const action = pass;
