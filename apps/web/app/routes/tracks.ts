import type { Route } from './+types/tracks';
import { siteOf } from '../lib/context.server.js';
import { langFrom } from '../lib/i18n.js';
import { tracksOf } from '../lib/tracks.js';

/**
 * An event's recordings as the player's queue, for a play button on a list
 * (the home page, the calendar, search) that starts a farbrengen without
 * opening its page.
 */
export async function loader({ params, request, context }: Route.LoaderArgs) {
  const { api } = siteOf(context);
  const lang = langFrom(request);
  const event = await api.entity(params.id);
  if (!event || event.type !== 'event') throw new Response('Not found', { status: 404 });
  const { items } = await api.children(event.id, 'event', 'recording', { limit: 200 });
  return Response.json({ tracks: tracksOf(event, items, lang) }, { headers: { 'Cache-Control': 'public, max-age=300' } });
}
