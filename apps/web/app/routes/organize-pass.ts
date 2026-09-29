import type { Route } from './+types/organize-pass';
import { siteOf } from '../lib/context.server.js';
import { passThrough } from '../lib/pass.server.js';

/**
 * The organizing view's calls, through the site's own address with its
 * session: /_/organize → POST /v1/organize, /_/organize/preview, the tree,
 * and the search its pickers use. Only these addresses pass.
 */
const TARGETS: Record<string, { path: string; method: 'GET' | 'POST' }> = {
  '': { path: '/v1/organize', method: 'POST' },
  preview: { path: '/v1/organize/preview', method: 'POST' },
  tree: { path: '/v1/tree', method: 'GET' },
  search: { path: '/v1/search', method: 'GET' },
};

async function pass({ request, params, context }: Route.LoaderArgs | Route.ActionArgs) {
  const target = TARGETS[params['*'] ?? ''];
  if (!target || request.method !== target.method) return new Response('Not found', { status: 404 });
  return passThrough(siteOf(context).api, request, target.path);
}

export const loader = pass;
export const action = pass;
