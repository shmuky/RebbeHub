import { data } from 'react-router';
import type { Route } from './+types/show-transcript';
import { siteOf } from '../lib/context.server.js';

/**
 * A showcase's transcript, for its guest's player (routes/show.tsx): only
 * of a recording the showcase lists, and only its words and timings, not
 * who is waiting to fix them.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  const { api, showcases } = siteOf(context);
  const showcase = showcases ? await showcases.store.get(params.token) : null;
  if (!showcase || !showcase.transcripts.includes(params.recording)) throw data('not found', { status: 404 });
  const transcript = await api.transcript(params.recording);
  if (!transcript) throw data('not found', { status: 404 });
  const { pending: _pending, ...words } = transcript;
  return Response.json(words, { headers: { 'Cache-Control': 'private, max-age=300', 'X-Robots-Tag': 'noindex, nofollow' } });
}
