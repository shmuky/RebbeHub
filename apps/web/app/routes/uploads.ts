import type { Route } from './+types/uploads';
import { siteOf } from '../lib/context.server.js';

/** Adding a recording or a scan, from the site's own pages: /_/uploads streams the file through to the API's /v1/uploads with the session cookie. Never cached. */
export async function action({ request, context }: Route.ActionArgs) {
  const response = await siteOf(context).api.forwardUpload('/v1/uploads', request);
  return new Response(await response.text(), {
    status: response.status,
    headers: { 'Content-Type': response.headers.get('Content-Type') ?? 'application/json', 'Cache-Control': 'no-store' },
  });
}
