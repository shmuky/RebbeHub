import type { Route } from './+types/threads-pass';
import { siteOf } from '../lib/context.server.js';
import { passThrough } from '../lib/pass.server.js';

/**
 * People and conversations, from the site's own pages: /_/threads/* to the
 * API's /v1/* (people to @mention, #numbers, suggestions' conversations and
 * reviews, issues, labels, comments and the inbox), with the session
 * cookie. Every method passes (PATCH, PUT and DELETE too); only these
 * addresses do.
 */
const HANDLE = '[A-Za-z0-9-]{1,39}';
const ALLOWED = new RegExp(
  '^(' +
    [
      `people(/${HANDLE})?`,
      'threads(/\\d+)?',
      'suggestions',
      `suggestions/\\d+(/(conversation|comments|reviews|review-requests(/${HANDLE})?))?`,
      'issues(/templates|/\\d+(/(state|labels|assignees|visibility|comments))?)?',
      'labels',
      'comments/\\d+(/resolve)?',
      'inbox(/(count|read))?',
    ].join('|') +
    ')$',
);

async function pass({ request, params, context }: Route.LoaderArgs | Route.ActionArgs) {
  const path = params['*'] ?? '';
  if (!ALLOWED.test(path)) return new Response('Not found', { status: 404 });
  return passThrough(siteOf(context).api, request, `/v1/${path}`);
}

export const loader = pass;
export const action = pass;
