import type { Route } from './+types/suggestions';
import { siteOf } from '../lib/context.server.js';

/**
 * Suggestions and their review, from the site's own pages: /_/suggestions/*
 * passes through to the API's /v1/suggestions/*, carrying the session
 * cookie, as /_/auth/* does. Only these addresses pass. Never cached.
 */
const ALLOWED = /^(quick|\d+|\d+\/(approve|send-back|withdraw))?$/;

async function pass({ request, params, context }: Route.LoaderArgs | Route.ActionArgs) {
  const { api } = siteOf(context);
  const path = params['*'] ?? '';
  if (!ALLOWED.test(path)) return new Response('Not found', { status: 404 });
  const response = await api.forward(`/v1/suggestions${path ? `/${path}` : ''}`, request);
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const loader = pass;
export const action = pass;
