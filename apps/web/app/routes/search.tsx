import { Form, Link } from 'react-router';
import { parseDateKey } from '@rebbehub/hebrew';
import { CalendarDays, Search as SearchIcon } from 'lucide-react';
import type { Route } from './+types/search';
import { EventRows, eventData, type EventItem } from '../components/EventRow.js';
import { ItemList } from '../components/ItemLink.js';
import { MomentRows, momentHref, momentRefs } from '../components/Moments.js';
import type { Entity, Moment, SimilarItem } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { dateLabel, yearLabel } from '../lib/dates.js';
import { langFrom, t, typeName, type Lang } from '../lib/i18n.js';
import { tn } from '../lib/i18nNetwork.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { datesOf, parseSmartQuery, parshaLabel } from '../lib/smartSearch.js';

/**
 * Search as Sichos-Kodesh's app searches: a parsha, a chag or Chabad day, a
 * day of a month and a year are read out of the words (lib/smartSearch.ts)
 * and find farbrengens by date; the rest is searched in names. A query that
 * names nothing of the kind is searched as it is, dates and all.
 *
 * Beside the names, the words are looked for inside the texts: a line on
 * a scan opens at that line, a paragraph of a transcript at the moment it
 * is heard. "By idea" (`?by=meaning`) searches by meaning instead, where
 * that is set up, and says the machine chose what it shows.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const byMeaning = url.searchParams.get('by') === 'meaning';
  // Whether search by meaning is set up: asked with no question, it costs nothing.
  const meaning = await api.similar('').catch(() => ({ available: false, results: [] as SimilarItem[] }));
  const empty = {
    lang,
    siteUrl,
    q,
    by: byMeaning && meaning.available ? ('meaning' as const) : ('words' as const),
    meaningAvailable: meaning.available,
    understood: null,
    events: [] as EventItem[],
    results: [] as Entity[],
    date: null as { key: string } | null,
    moments: [] as Moment[],
    similar: [] as SimilarItem[],
    refs: {} as Record<string, Entity>,
  };
  if (!q) return empty;
  if (empty.by === 'meaning') {
    const similar = (await api.similar(q, { limit: 30 })).results;
    const refs = Object.fromEntries(await api.entities(momentRefs(similar.flatMap((s) => (s.moment ? [s.moment] : [])))));
    return { ...empty, similar, refs };
  }
  const moments = await api.moments(q, 20).catch(() => [] as Moment[]);
  const refs = Object.fromEntries(await api.entities(momentRefs(moments)));

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
  // Pages and paragraphs show as the moments they are, above.
  const inText = new Set(['text-page', 'segment']);
  return { ...empty, moments, refs, understood, events: [...events, ...moreEvents], results: results.filter((r) => r.type !== 'event' && !inText.has(r.type)), date };
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
  const { lang, q, by, meaningAvailable, understood, events, results, date, moments, similar, refs } = loaderData;
  return (
    <>
      <h1>{t(lang, 'search')}</h1>
      {meaningAvailable ? (
        <nav className="page-tabs" aria-label={t(lang, 'search')}>
          <Link to={href('/search', lang, { q: q || undefined })} aria-current={by === 'words' ? 'page' : undefined}>
            {tn(lang, 'byWords')}
          </Link>
          <Link to={href('/search', lang, { q: q || undefined, by: 'meaning' })} aria-current={by === 'meaning' ? 'page' : undefined}>
            {tn(lang, 'byMeaning')}
          </Link>
        </nav>
      ) : null}
      <Form method="get" action="/search" className="search-box" role="search">
        <label className="visually-hidden" htmlFor="q">
          {t(lang, 'search')}
        </label>
        <input id="q" name="q" type="search" dir="auto" defaultValue={q} placeholder={t(lang, 'searchPlaceholder')} enterKeyHint="search" autoFocus={!q} />
        {lang === 'en' ? <input type="hidden" name="lang" value="en" /> : null}
        {by === 'meaning' ? <input type="hidden" name="by" value="meaning" /> : null}
        <button type="submit" aria-label={t(lang, 'search')}>
          <SearchIcon size={18} />
        </button>
      </Form>

      {by === 'meaning' ? (
        <MeaningResults q={q} similar={similar} refs={refs} lang={lang} />
      ) : !q ? (
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

      {by === 'meaning' ? null : understood || date ? (
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

      {q && moments.length ? (
        <section>
          <h2 className="section-header">
            {tn(lang, 'inTheTexts')} · {moments.length}
          </h2>
          <p className="row-sub">{tn(lang, 'inTheTextsHint')}</p>
          <MomentRows moments={moments} refs={refs} lang={lang} />
        </section>
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

      {q && by === 'words' && !events.length && !results.length && !moments.length ? <p className="subtitle">{t(lang, 'noResults')}</p> : null}
    </>
  );
}

/** What search by meaning found: each item, or the place in a text, with how near it is, all marked as the machine's choice. */
function MeaningResults({ q, similar, refs, lang }: { q: string; similar: SimilarItem[]; refs: Record<string, Entity>; lang: Lang }) {
  if (!q) return <p className="search-hints">{tn(lang, 'byMeaningHint')}</p>;
  if (!similar.length) return <p className="subtitle">{t(lang, 'noResults')}</p>;
  return (
    <section>
      <p className="note machine-note">{tn(lang, 'byMeaningMachine')}</p>
      <ol className="moments">
        {similar.map((s) => {
          const to = s.moment ? momentHref(s.moment, refs, lang) : href(itemPath(s.item), lang);
          const words = s.moment ? (s.moment.kind === 'scan-line' ? s.moment.line.text : s.moment.snippet) : labelOf(s.item, lang);
          const owner = s.moment?.kind === 'paragraph' ? (s.moment.event ?? s.moment.unit) : s.moment?.kind === 'scan-line' ? (s.moment.publication ?? s.moment.scan) : null;
          return (
            <li key={s.item.id} className="moment machine">
              <p className="moment-words" dir="auto">
                {to ? <Link to={to}>{words}</Link> : words}
              </p>
              <p className="row-sub">
                {owner && refs[owner] ? `${labelOf(refs[owner]!, lang)} · ` : ''}
                {typeName(s.item.type, lang)} · {tn(lang, 'nearness')} {Math.round(s.score * 100)}%<span className="unchecked"> · {tn(lang, 'foundByMachine')}</span>
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
