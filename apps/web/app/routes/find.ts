import type { Route } from './+types/find';
import { siteOf } from '../lib/context.server.js';
import { dateLabel } from '../lib/dates.js';
import { langFrom, typeName } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { itemPath } from '../lib/links.js';

/**
 * What the command palette finds as one types (Ctrl K): a few items of any
 * kind by name, date or words, from the API's search, each with its kind
 * and where it lives. JSON only; the search page is the full answer.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
  if (q.length < 2) return Response.json({ items: [], date: null });
  const lang = langFrom(request);
  const { results, date } = await siteOf(context).api.search(q, { limit: 8 });
  return Response.json(
    {
      date: date ? { key: date.key, label: date[lang] } : null,
      items: results.map((item) => {
        const d = (item.data as { date?: string }).date;
        return { id: item.id, path: itemPath(item), label: labelOf(item, lang), kind: typeName(item.type, lang), type: item.type, date: d ? dateLabel(d, lang, { civil: false }) : null };
      }),
    },
    { headers: { 'Cache-Control': 'public, max-age=60' } },
  );
}
