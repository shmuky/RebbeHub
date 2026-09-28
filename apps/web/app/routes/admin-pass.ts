import type { Route } from './+types/admin-pass';
import { siteOf } from '../lib/context.server.js';
import { passThrough } from '../lib/pass.server.js';

/** The stewards' page, from the site's own pages: /_/admin/people… to /v1/admin/people…, /_/reports… to /v1/reports…, and restoring a version (/_/steward/entities/<id>/restore). Only these addresses pass. */
const ALLOWED = /^(admin\/people(\/u-[0-9a-z]+\/(role|suspend))?|reports(\/\d+\/close)?|entities\/rh-[0-9a-z]+\/restore|projects(\/[a-z0-9-]+\/close)?|scans\/rh-[0-9a-z]+\/text\/fix|recordings\/rh-[0-9a-z]+\/transcript(\/fix)?|webhooks(\/\d+)?)$/;

async function pass({ request, params, context }: Route.LoaderArgs | Route.ActionArgs) {
  const path = params['*'] ?? '';
  if (!ALLOWED.test(path)) return new Response('Not found', { status: 404 });
  return passThrough(siteOf(context).api, request, `/v1/${path}`);
}

export const loader = pass;
export const action = pass;
