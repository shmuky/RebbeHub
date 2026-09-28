import { Link } from 'react-router';
import { parseDateKey } from '@rebbehub/hebrew';
import type { Route } from './+types/search';
import { ItemList } from '../components/ItemLink.js';
import { siteOf } from '../lib/context.server.js';
import { dateLabel } from '../lib/dates.js';
import { langFrom, t, typeName } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';

/** Search in Hebrew or English; a query that names a date also shows that date's events. */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const q = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (!q) return { lang, siteUrl, q, results: [], date: null, onDate: [] };
  const found = await api.search(q, { limit: 50 });
  let onDate: Awaited<ReturnType<typeof api.events>> = [];
  if (found.date) {
    const parts = parseDateKey(found.date.key)!;
    // A day: that day's events. A month or a year: all of them.
    const within = parts.month ? `${parts.year}-${parts.month}` : String(parts.year);
    onDate = (await api.events({ within, limit: 200 })).filter((e) => !parts.day || (e.data as { date?: string }).date === found.date!.key);
  }
  return { lang, siteUrl, q, results: found.results, date: found.date, onDate };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { lang, siteUrl, q } = loaderData;
  return pageMeta({ title: q ? `${t(lang, 'search')}: ${q}` : t(lang, 'search'), path: '/search', lang, siteUrl, noindex: true });
}

function calendarPath(key: string): string {
  const parts = parseDateKey(key)!;
  return parts.month ? `/calendar/${parts.year}/${parts.month}` : `/calendar/${parts.year}`;
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const { lang, q, results, date, onDate } = loaderData;
  return (
    <>
      <h1>{q ? `${t(lang, 'search')}: ${q}` : t(lang, 'search')}</h1>
      {date ? (
        <section>
          <p className="notice">
            {t(lang, 'dateFound')}: <strong>{dateLabel(date.key, lang)}</strong>
            {' '}
            · <Link to={href(calendarPath(date.key), lang)}>{t(lang, 'calendar')}</Link>
          </p>
          {onDate.length ? (
            <>
              <h2>{t(lang, 'eventsOnDate')}</h2>
              <ItemList items={onDate} meta={(e) => dateLabel((e.data as { date?: string }).date, lang, { civil: false })} />
            </>
          ) : null}
        </section>
      ) : null}
      {q ? (
        <section>
          <h2>
            {t(lang, 'results')} <span className="card-meta">({results.length})</span>
          </h2>
          {results.length ? <ItemList items={results} meta={(e) => typeName(e.type, lang)} /> : <p>{t(lang, 'noResults')}</p>}
        </section>
      ) : null}
    </>
  );
}
