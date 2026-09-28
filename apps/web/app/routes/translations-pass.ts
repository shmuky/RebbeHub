import type { Route } from './+types/translations-pass';
import { siteOf } from '../lib/context.server.js';
import { passThrough } from '../lib/pass.server.js';

/**
 * Translations, from the site's own pages: /_/translations/fix to the API's
 * /v1/translations/fix, and /_/translations/units/<id> to
 * /v1/units/<id>/translations. Only these addresses pass.
 */
async function pass({ request, params, context }: Route.ActionArgs) {
  const path = params['*'] ?? '';
  const unit = /^units\/(rh-[0-9a-z]+)$/.exec(path)?.[1];
  if (path !== 'fix' && !unit) return new Response('Not found', { status: 404 });
  return passThrough(siteOf(context).api, request, unit ? `/v1/units/${unit}/translations` : '/v1/translations/fix');
}

export const action = pass;
