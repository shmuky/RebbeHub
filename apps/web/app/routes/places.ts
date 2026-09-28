import type { Route } from './+types/places';
import { siteOf } from '../lib/context.server.js';
import { passThrough } from '../lib/pass.server.js';

/** Where a signed-in person stopped reading and listening (lib/places.ts): /_/places to the API's /v1/places. */
async function pass({ request, context }: Route.LoaderArgs | Route.ActionArgs) {
  return passThrough(siteOf(context).api, request, '/v1/places');
}

export const loader = pass;
export const action = pass;
