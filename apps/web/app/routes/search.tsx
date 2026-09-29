import { Link } from 'react-router';
import { parseDateKey } from '@rebbehub/hebrew';
import type { Route } from './+types/search';
import { EventRows, eventData, type EventItem } from '../components/EventRow.js';
import { Marked, MomentRows, momentHref, momentRefs } from '../components/Moments.js';
import type { Entity, Moment, SimilarItem } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { dateLabel, yearLabel } from '../lib/dates.js';
import { langFrom, t, typeName, type Lang } from '../lib/i18n.js';
import { tn } from '../lib/i18nNetwork.js';
import { num } from '../lib/i18nUi.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { datesOf, parseSmartQuery, parshaLabel } from '../lib/smartSearch.js';
import { parseTokens, withToken, type TokenKey } from '../lib/tokens.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { EmptyState, Label, MachineLabel, MachineNote, Tabs, type LabelTone } from '../ui/primitives.js';
import { TokenSearch } from '../ui/TokenSearch.js';
import '../styles/pages/browse.css';

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
 *
 * Filters are written into the line itself, as GitHub's are: `סוג:התוועדות`
 * shows only farbrengens, `שנה:תשמ״ב` adds a year. The tabs are the same
 * filter, set by a click.
 */

/** The filters the search line takes. */
export const SEARCH_KEYS: TokenKey[] = [
  {
    key: 'type',
    he: 'סוג',
    en: 'type',
    values: [
      { value: 'event', he: 'התוועדות', en: 'farbrengen' },
      { value: 'library', he: 'ספרייה', en: 'library' },
      { value: 'text', he: 'בטקסט', en: 'text' },
    ],
  },
  { key: 'year', he: 'שנה', en: 'year', hint: { he: 'שנה עברית, למשל תשמ״ב', en: 'A Hebrew year, e.g. 5742' } },
];

type Kind = 'event' | 'library' | 'text';

export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const byMeaning = url.searchParams.get('by') === 'meaning';
  // The filters written into the line: the kind of result, and years added to the words.
  const parsed = parseTokens(q, SEARCH_KEYS);
  const kind = (['event', 'library', 'text'] as const).find((k) => parsed.filters.type?.includes(k)) ?? null;
  const words = [parsed.text, ...(parsed.filters.year ?? [])].filter(Boolean).join(' ');
  // Whether search by meaning is set up: asked with no question, it costs nothing.
  const meaning = await api.similar('').catch(() => ({ available: false, results: [] as SimilarItem[] }));
  const empty = {
    lang,
    siteUrl,
    q,
    kind: kind as Kind | null,
    by: byMeaning && meaning.available ? ('meaning' as const) : ('words' as const),
    meaningAvailable: meaning.available,
    understood: null as { parsha: string | null; day: string | null; year: number | null; month: string | null } | null,
    events: [] as EventItem[],
    results: [] as Entity[],
    date: null as { key: string } | null,
    moments: [] as Moment[],
    similar: [] as SimilarItem[],
    refs: {} as Record<string, Entity>,
  };
  if (!words) return empty;
  if (empty.by === 'meaning') {
    const similar = (await api.similar(words, { limit: 30 })).results;
    const refs = Object.fromEntries(await api.entities(momentRefs(similar.flatMap((s) => (s.moment ? [s.moment] : [])))));
    return { ...empty, similar, refs };
  }
  const moments = await api.moments(words, 20).catch(() => [] as Moment[]);
  const refs = Object.fromEntries(await api.entities(momentRefs(moments)));

  const smart = parseSmartQuery(words);
  const understood =
    smart.parsha || smart.day || smart.year
      ? {
          parsha: smart.parsha ? parshaLabel(smart.parsha, lang) : null,
          day: smart.day?.label ?? null,
          year: smart.year ?? null,
          // One day of one month: its month in the calendar (Adar's two spellings are one month in a given year).
          month: smart.year && smart.day && !smart.parsha && new Set(datesOf(smart)?.map((d) => d.split('-')[1])).size === 1 ? datesOf(smart)![0]!.split('-')[1]! : null,
        }
      : null;

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
      const rest = smart.rest.split(' ');
      const named = (e: EventItem) => rest.every((w) => JSON.stringify(eventData(e).title ?? '').includes(w));
      if (events.length) events = events.filter(named);
      results = (await api.search(smart.rest, { limit: 50 })).results;
    }
  } else {
    const found = await api.search(words, { limit: 50 });
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

const W = {
  lede: { he: 'ספרים, שיחות, התוועדויות ותאריכים — וגם המילים שבתוך הסריקות והתמלולים.', en: 'Sefarim, sichos, farbrengens and dates — and the words inside the scans and transcripts.' },
  all: { he: 'הכול', en: 'All' },
  kinds: { he: 'סוגי תוצאות', en: 'Kinds of result' },
  placeholder: { he: 'פרשה, תאריך, שנה, שם של ספר או מילים מתוך הטקסט', en: 'A parsha, a date, a year, a sefer’s name or words from the text' },
  hint: { he: 'אפשר לסנן: סוג:התוועדות שנה:תשמ״ב', en: 'Filter with type:farbrengen year:5742' },
  understood: { he: 'הובן מהחיפוש', en: 'Understood' },
  day: { he: 'יום', en: 'Day' },
  year: { he: 'שנה', en: 'Year' },
  date: { he: 'תאריך', en: 'Date' },
  tryThese: { he: 'אפשר לנסות', en: 'Try' },
  howTo: { he: 'איך מחפשים', en: 'How to search' },
  howToWords: { he: 'כותבים כמו שאומרים: פרשה, חג, יום בחודש, שנה, או שם של ספר. התאריך נקרא מתוך המילים.', en: 'Write it as you would say it: a parsha, a chag, a day of a month, a year, or the name of a sefer. The date is read out of the words.' },
  filters: { he: 'סינונים', en: 'Filters' },
  typeEvent: { he: 'רק התוועדויות', en: 'Only farbrengens' },
  typeLibrary: { he: 'רק ספרים ושיחות', en: 'Only sefarim and sichos' },
  typeText: { he: 'רק מתוך הטקסטים', en: 'Only inside the texts' },
  yearHint: { he: 'מוסיף שנה לחיפוש', en: 'Adds a year to the search' },
  byIdeaSide: { he: 'חיפוש לפי רעיון מוצא מקומות שעוסקים באותו עניין גם במילים אחרות. המכונה בוחרת, ולכן כל תוצאה מסומנת.', en: 'Search by idea finds places on the same subject in other words. A machine chooses, so every result is marked.' },
  results: { he: 'תוצאות', en: 'results' },
  for: { he: 'עבור', en: 'for' },
  nothingOfKind: { he: 'אין תוצאות מהסוג הזה.', en: 'No results of this kind.' },
  showAll: { he: 'הצגת כל הסוגים', en: 'Show every kind' },
  inCalendar: { he: 'בלוח', en: 'In the calendar' },
} as const;

const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

const EXAMPLES: Record<Lang, string[]> = {
  he: ['יו״ד שבט', 'פרשת בשלח', 'י״ט כסלו תשל״ד', 'חנוכה', 'שבועות תשמ״ב', 'תניא'],
  en: ['Yud Shvat', 'Beshalach', '19 Kislev 5734', 'Chanukah', 'Shavuos 5742', 'Tanya'],
};

const yearOf = (e: EventItem) => Number(String(eventData(e).date ?? '').slice(0, 4));

/** A library item's kind as a label, in the colour of what it is. */
const TYPE_TONE: Record<string, LabelTone> = { work: 'text', unit: 'text', publication: 'source', scan: 'scan', recording: 'audio', author: 'meta', set: 'meta', text: 'text' };
const TYPE_ICON: Record<string, IconName> = { work: 'book', unit: 'file', publication: 'layers', scan: 'scan', recording: 'audio', author: 'user', set: 'book', text: 'file' };

export default function Search({ loaderData }: Route.ComponentProps) {
  const { lang, q, kind, by, meaningAvailable, understood, events, results, date, moments, similar, refs } = loaderData;
  const hasQuery = q.trim() !== '';
  const total = events.length + results.length + moments.length;
  const tab = by === 'meaning' ? 'meaning' : (kind ?? 'all');
  const tabTo = (value: Kind | null) => href('/search', lang, { q: withToken(q, SEARCH_KEYS, 'type', value, lang) || undefined });
  const tabs = [
    { key: 'all', label: w(lang, 'all'), to: tabTo(null), count: hasQuery && by === 'words' ? num(total, lang) : null },
    { key: 'event', label: t(lang, 'tabFarbrengens'), icon: 'cal' as const, to: tabTo('event'), count: hasQuery && by === 'words' ? num(events.length, lang) : null },
    { key: 'library', label: t(lang, 'tabLibrary'), icon: 'book' as const, to: tabTo('library'), count: hasQuery && by === 'words' ? num(results.length, lang) : null },
    { key: 'text', label: tn(lang, 'inTheTexts'), icon: 'scan' as const, to: tabTo('text'), count: hasQuery && by === 'words' ? num(moments.length, lang) : null },
    ...(meaningAvailable ? [{ key: 'meaning', label: tn(lang, 'byMeaning'), icon: 'sparkle' as const, to: href('/search', lang, { q: q || undefined, by: 'meaning' }) }] : []),
  ];
  const show = (k: Kind) => by === 'words' && (kind === null || kind === k);
  const shownCount = (kind === 'event' ? events.length : 0) + (kind === 'library' ? results.length : 0) + (kind === 'text' ? moments.length : 0);
  return (
    <div className="search-page">
      <div className="phead">
        <div className="wrap">
          <h1 className="page-title">{t(lang, 'search')}</h1>
          <p className="lede">{w(lang, 'lede')}</p>
          <div className="search-line">
            <TokenSearch
              lang={lang}
              keys={SEARCH_KEYS}
              defaultValue={q}
              action="/search"
              hidden={{ by: by === 'meaning' ? 'meaning' : undefined }}
              label={t(lang, 'search')}
              placeholder={w(lang, 'placeholder')}
              hint={w(lang, 'hint')}
              autoFocus={!hasQuery}
              size="lg"
            />
          </div>
          <Tabs items={tabs} current={tab} label={w(lang, 'kinds')} />
        </div>
      </div>
      <div className="wrap cols">
        <div className="search-main stack-lg">
          {by === 'meaning' ? (
            <MeaningResults q={q} similar={similar} refs={refs} lang={lang} />
          ) : !hasQuery ? (
            <Examples lang={lang} />
          ) : (
            <>
              {understood || date ? <Understood lang={lang} understood={understood} date={date} /> : null}

              {show('text') && moments.length ? (
                <section aria-labelledby="in-texts">
                  <h2 className="h-block" id="in-texts">
                    {tn(lang, 'inTheTexts')} <span className="count">{num(moments.length, lang)}</span>
                  </h2>
                  <p className="section-hint">{tn(lang, 'inTheTextsHint')}</p>
                  <MomentRows moments={moments} refs={refs} lang={lang} />
                </section>
              ) : null}

              {show('event') && events.length ? (
                <section aria-labelledby="in-events">
                  <h2 className="h-block" id="in-events">
                    {t(lang, 'tabFarbrengens')} <span className="count">{num(events.length, lang)}</span>
                    {understood?.year ? <Link to={href(understood.month ? `/calendar/${understood.year}/${understood.month}` : `/calendar/${understood.year}`, lang)}>{t(lang, understood.month ? 'allOfMonth' : 'allOfYear')}</Link> : null}
                  </h2>
                  <EventRows events={events} sub={(e) => dateLabel(eventData(e).date, lang, { civil: false }) || yearLabel(yearOf(e), lang)} />
                </section>
              ) : null}

              {show('library') && results.length ? (
                <section aria-labelledby="in-library">
                  <h2 className="h-block" id="in-library">
                    {t(lang, 'tabLibrary')} <span className="count">{num(results.length, lang)}</span>
                  </h2>
                  <ul className="box">
                    {results.map((r) => (
                      <li key={r.id}>
                        <Link className="row hover" to={href(itemPath(r), lang)}>
                          <Icon name={TYPE_ICON[r.type] ?? 'file'} className="subtle" />
                          <span className="row-main">
                            <span className="row-title torah">{labelOf(r, lang)}</span>
                          </span>
                          <Label tone={TYPE_TONE[r.type] ?? 'meta'} size="sm">
                            {typeName(r.type, lang)}
                          </Label>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {total === 0 ? (
                <EmptyState icon="search" title={t(lang, 'noResults')}>
                  <ExampleLinks lang={lang} />
                </EmptyState>
              ) : kind && shownCount === 0 ? (
                <EmptyState icon="filter" title={w(lang, 'nothingOfKind')} actions={<Link className="btn" to={tabTo(null)}>{w(lang, 'showAll')}</Link>} compact />
              ) : null}
            </>
          )}
        </div>
        <aside className="side" aria-label={w(lang, 'howTo')}>
          <section>
            <h2>{w(lang, 'howTo')}</h2>
            <p className="side-p">{w(lang, 'howToWords')}</p>
          </section>
          <section>
            <h2>{w(lang, 'filters')}</h2>
            <dl className="token-help">
              <dt>
                <Link to={tabTo('event')}>
                  <code>{lang === 'he' ? 'סוג:התוועדות' : 'type:farbrengen'}</code>
                </Link>
              </dt>
              <dd>{w(lang, 'typeEvent')}</dd>
              <dt>
                <Link to={tabTo('library')}>
                  <code>{lang === 'he' ? 'סוג:ספרייה' : 'type:library'}</code>
                </Link>
              </dt>
              <dd>{w(lang, 'typeLibrary')}</dd>
              <dt>
                <Link to={tabTo('text')}>
                  <code>{lang === 'he' ? 'סוג:בטקסט' : 'type:text'}</code>
                </Link>
              </dt>
              <dd>{w(lang, 'typeText')}</dd>
              <dt>
                <code>{lang === 'he' ? 'שנה:תשמ״ב' : 'year:5742'}</code>
              </dt>
              <dd>{w(lang, 'yearHint')}</dd>
            </dl>
          </section>
          {meaningAvailable ? (
            <section>
              <h2>
                {tn(lang, 'byMeaning')}
                <Link to={href('/search', lang, { q: q || undefined, by: 'meaning' })}>{tn(lang, 'byMeaning')}</Link>
              </h2>
              <p className="side-p">{w(lang, 'byIdeaSide')}</p>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/** What the search read out of the words: a parsha, a day, a year, a date. */
function Understood({ lang, understood, date }: { lang: Lang; understood: { parsha: string | null; day: string | null; year: number | null; month: string | null } | null; date: { key: string } | null }) {
  return (
    <div className="understood" aria-label={t(lang, 'understood')}>
      <span className="subtle">{w(lang, 'understood')}:</span>
      {understood?.parsha ? (
        <Label tone="source">
          {t(lang, 'parshas')} {understood.parsha}
        </Label>
      ) : null}
      {understood?.day ? <Label tone="date">{understood.day}</Label> : null}
      {understood?.year ? <Label tone="meta">{yearLabel(understood.year, lang)}</Label> : null}
      {date ? <Label tone="date">{dateLabel(date.key, lang, { civil: false })}</Label> : null}
      {understood?.year ? (
        <Link className="understood-link" to={href(understood.month ? `/calendar/${understood.year}/${understood.month}` : `/calendar/${understood.year}`, lang)}>
          <Icon name="cal" />
          {t(lang, understood.month ? 'allOfMonth' : 'allOfYear')}
        </Link>
      ) : null}
    </div>
  );
}

function ExampleLinks({ lang }: { lang: Lang }) {
  return (
    <span className="examples">
      {EXAMPLES[lang].map((ex, i) => (
        <span key={ex}>
          {i > 0 ? ' · ' : ''}
          <Link to={href('/search', lang, { q: ex })}>{ex}</Link>
        </span>
      ))}
    </span>
  );
}

/** Before anything is asked: what can be asked, as searches one click away. */
function Examples({ lang }: { lang: Lang }) {
  return (
    <section aria-labelledby="try">
      <h2 className="h-block" id="try">
        {w(lang, 'tryThese')}
      </h2>
      <p className="section-hint">{t(lang, 'searchHint')}</p>
      <ul className="box">
        {EXAMPLES[lang].map((ex) => (
          <li key={ex}>
            <Link className="row hover" to={href('/search', lang, { q: ex })}>
              <Icon name="search" className="subtle" />
              <span className="row-main row-title">{ex}</span>
              <Icon name="chev" className="subtle flip-ltr" size={14} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What search by meaning found: each item, or the place in a text, with how near it is, all marked as the machine's choice. */
function MeaningResults({ q, similar, refs, lang }: { q: string; similar: SimilarItem[]; refs: Record<string, Entity>; lang: Lang }) {
  if (!q) return <EmptyState icon="sparkle" title={tn(lang, 'byMeaning')}>{tn(lang, 'byMeaningHint')}</EmptyState>;
  if (!similar.length) return <EmptyState icon="search" title={t(lang, 'noResults')} />;
  return (
    <section className="stack">
      <MachineNote>{tn(lang, 'byMeaningMachine')}</MachineNote>
      <ol className="box moments">
        {similar.map((s) => {
          const to = s.moment ? momentHref(s.moment, refs, lang) : href(itemPath(s.item), lang);
          const words = s.moment ? (s.moment.kind === 'scan-line' ? s.moment.line.text : s.moment.snippet) : labelOf(s.item, lang);
          const owner = s.moment?.kind === 'paragraph' ? (s.moment.event ?? s.moment.unit) : s.moment?.kind === 'scan-line' ? (s.moment.publication ?? s.moment.scan) : null;
          return (
            <li key={s.item.id} className="row moment machine-row">
              <span className="near" title={tn(lang, 'nearness')}>
                {Math.round(s.score * 100)}%
              </span>
              <div className="row-main">
                <p className="moment-words torah" dir="auto">
                  {to ? <Link to={to}>{s.moment ? <Marked text={words} hits={s.moment.hits} /> : words}</Link> : words}
                </p>
                <p className="row-sub">
                  {owner && refs[owner] ? `${labelOf(refs[owner]!, lang)} · ` : ''}
                  {typeName(s.item.type, lang)} · {tn(lang, 'nearness')} {Math.round(s.score * 100)}%{' '}
                  <MachineLabel lang={lang} size="sm">
                    {tn(lang, 'foundByMachine')}
                  </MachineLabel>
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
