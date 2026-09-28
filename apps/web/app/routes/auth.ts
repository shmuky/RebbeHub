import type { Route } from './+types/auth';
import { siteOf } from '../lib/context.server.js';

/**
 * Sign-in's own address on the site: /_/auth/* passes through to the API's
 * /v1/auth/*, so the browser talks only to rebbehub.org and the session
 * cookie the API sets is the site's own. Its redirects (to Google and
 * back) go to the browser as they are. Never cached.
 */
async function pass({ request, params, context }: Route.LoaderArgs | Route.ActionArgs) {
  const { api } = siteOf(context);
  const path = params['*'] ?? '';
  if (!/^[a-z/-]+$/.test(path)) return new Response('Not found', { status: 404 });
  const response = await api.forward(`/v1/auth/${path}`, request);
  const headers = new Headers({ 'Content-Type': response.headers.get('Content-Type') ?? 'application/json', 'Cache-Control': 'no-store' });
  for (const cookie of response.headers.getSetCookie()) headers.append('Set-Cookie', cookie);
  const location = response.headers.get('Location');
  if (location) headers.set('Location', location);
  return new Response(location ? null : await response.text(), { status: response.status, headers });
}

export const loader = pass;
export const action = pass;
