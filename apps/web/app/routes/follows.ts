import type { Route } from './+types/follows';
import { siteOf } from '../lib/context.server.js';

/** Following, from the site's own pages: /_/follows passes through to the API's /v1/follows with the session cookie, as /_/suggestions/* does. Never cached. */
async function pass({ request, context }: Route.LoaderArgs | Route.ActionArgs) {
  const { api } = siteOf(context);
  const response = await api.forward('/v1/follows', request);
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'application/json', 'Cache-Control': 'no-store' },
  });
}

export const loader = pass;
export const action = pass;
