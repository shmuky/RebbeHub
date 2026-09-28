import type { Route } from './+types/lookup';
import { siteOf } from '../lib/context.server.js';
import { langFrom } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';

/**
 * A few items by name, for forms that link one item to another ("Map a
 * teshura" picks the letter these pages hold, or the sefer a new one
 * belongs to): /_/lookup?q=…&type=unit, from the API's search.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
  const type = url.searchParams.get('type');
  if (!q || (type !== 'unit' && type !== 'work')) return Response.json({ items: [] });
  const lang = langFrom(request);
  const { results } = await siteOf(context).api.search(q, { type, limit: 8 });
  return Response.json(
    { items: results.map((item) => ({ id: item.id, path: item.path, label: labelOf(item, lang), date: (item.data as { date?: string }).date ?? null })) },
    { headers: { 'Cache-Control': 'public, max-age=60' } },
  );
}
