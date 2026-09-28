import { Form, Link } from 'react-router';
import { parseDateKey } from '@rebbehub/hebrew';
import { CalendarDays, Search as SearchIcon } from 'lucide-react';
import type { Route } from './+types/search';
import { EventRows, eventData, type EventItem } from '../components/EventRow.js';
import { ItemList } from '../components/ItemLink.js';
import type { Entity } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { dateLabel, yearLabel } from '../lib/dates.js';
import { langFrom, t, typeName, type Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { datesOf, parseSmartQuery, parshaLabel } from '../lib/smartSearch.js';

/**
 * Search as Sichos-Kodesh's app searches: a parsha, a chag or Chabad day, a
 * day of a month and a year are read out of the words (lib/smartSearch.ts)
 * and find farbrengens by date; the rest is searched in names. A query that
 * names nothing of the kind is searched as it is, dates and all.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const q = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  const empty = { lang, siteUrl, q, understood: null, events: [] as EventItem[], results: [] as Entity[], date: null as { key: string } | null };
  if (!q) return empty;

  const smart = parseSmartQuery(q);
  const understood = smart.parsha || smart.day || smart.year ? {
          parsha: smart.parsha ? parshaLabel(smart.parsha, lang) : null,
          day: smart.day?.label ?? null,
          year: smart.year ?? null,
          // One day of one month: its month in the calendar (Adar's two spellings are one month in a given year).
          month: smart.year && smart.day && !smart.parsha && new Set(datesOf(smart)?.map((d) => d.split('-')[1])).size === 1 ? datesOf(smart)![0]!.split('-')[1]! : null,
        } : null;

  let events: EventItem[] = [];
  let results: Entity[] = [];
  let date: { key: string } | null = null;
  if (understood) {
    const dates = datesOf(smart);
    if (dates?.length) events = await api.events({ dates: [...new Set(dates)].slice(0, 500), limit: 500 });
    else if (smart.day) events = await api.events({ day: smart.day.tokens, limit: 500 });
    else if (smart.year) events = await api.events({ within: String(smart.year), limit: 500 });
    if (smart.rest) {
      // Words beyond the date narrow the farbrengens found, and are searched in names too.
      const words = smart.rest.split(' ');
      const named = (e: EventItem) => words.every((w) => JSON.stringify(eventData(e).title ?? '').includes(w));
      if (events.length) events = events.filter(named);
      results = (await api.search(smart.rest, { limit: 50 })).results;
    }
  } else {
    const found = await api.search(q, { limit: 50 });
    results = found.results;
    date = found.date;
    if (found.date) {
      const parts = parseDateKey(found.date.key)!;
      const within = parts.month ? `${parts.year}-${parts.month}` : String(parts.year);
      events = (await api.events({ within, limit: 500 })).filter((e) => !parts.day || eventData(e).date === found.date!.key);
    }
  }
  // Farbrengens show once, in their own section.
  const shown = new Set(events.map((e) => e.id));
  results = results.filter((r) => !shown.has(r.id));
  const moreEvents = results.filter((r) => r.type === 'event') as EventItem[];
  return { ...empty, understood, events: [...events, ...moreEvents], results: results.filter((r) => r.type !== 'event'), date };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { lang, siteUrl, q } = loaderData;
  return pageMeta({ title: q ? `${t(lang, 'search')}: ${q}` : t(lang, 'search'), path: '/search', lang, siteUrl, noindex: true });
}

const EXAMPLES: Record<Lang, string[]> = {
  he: ['יו״ד שבט', 'פרשת בשלח', 'י״ט כסלו תשל״ד', 'חנוכה', 'שבועות תשמ״ב', 'תניא'],
  en: ['Yud Shvat', 'Beshalach', '19 Kislev 5734', 'Chanukah', 'Shavuos 5742', 'Tanya'],
};

const yearOf = (e: EventItem) => Number(String(eventData(e).date ?? '').slice(0, 4));

export default function Search({ loaderData }: Route.ComponentProps) {
  const { lang, q, understood, events, results, date } = loaderData;
  return (
    <>
      <h1>{t(lang, 'search')}</h1>
      <Form method="get" action="/search" className="search-box" role="search">
        <label className="visually-hidden" htmlFor="q">
          {t(lang, 'search')}
        </label>
        <input id="q" name="q" type="search" dir="auto" defaultValue={q} placeholder={t(lang, 'searchPlaceholder')} enterKeyHint="search" autoFocus={!q} />
        {lang === 'en' ? <input type="hidden" name="lang" value="en" /> : null}
        <button type="submit" aria-label={t(lang, 'search')}>
          <SearchIcon size={18} />
        </button>
      </Form>

      {!q ? (
        <section>
          <p className="search-hints">{t(lang, 'searchHint')}</p>
          <ul className="pills">
            {EXAMPLES[lang].map((ex) => (
              <li key={ex}>
                <Link className="pill" to={href('/search', lang, { q: ex })}>
                  {ex}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {understood || date ? (
        <ul className="pills" aria-label={t(lang, 'understood')}>
          {understood?.parsha ? (
            <li className="pill on">
              {t(lang, 'parshas')} {understood.parsha}
            </li>
          ) : null}
          {understood?.day ? <li className="pill on">{understood.day}</li> : null}
          {understood?.year ? <li className="pill on">{yearLabel(understood.year, lang)}</li> : null}
          {date ? (
            <li className="pill on">
              <CalendarDays size={14} aria-hidden="true" />
              {dateLabel(date.key, lang, { civil: false })}
            </li>
          ) : null}
          {understood?.year ? (
            <li>
              <Link className="pill" to={href(understood.month ? `/calendar/${understood.year}/${understood.month}` : `/calendar/${understood.year}`, lang)}>
                {t(lang, understood.month ? 'allOfMonth' : 'allOfYear')}
              </Link>
            </li>
          ) : null}
        </ul>
      ) : null}

      {q && events.length ? (
        <section>
          <h2 className="section-header">
            {t(lang, 'tabFarbrengens')} · {events.length}
          </h2>
          <EventRows events={events} sub={(e) => dateLabel(eventData(e).date, lang, { civil: false }) || yearLabel(yearOf(e), lang)} />
        </section>
      ) : null}

      {q && results.length ? (
        <section>
          <h2 className="section-header">
            {t(lang, 'tabLibrary')} · {results.length}
          </h2>
          <ItemList items={results} meta={(e) => typeName(e.type, lang)} />
        </section>
      ) : null}

      {q && !events.length && !results.length ? <p className="subtitle">{t(lang, 'noResults')}</p> : null}
    </>
  );
}
