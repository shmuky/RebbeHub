import { HDate } from '@hebcal/core';
import { MONTHS, isMonthToken, monthByToken, toHebrewNumeral } from '@rebbehub/hebrew';
import { data, Link } from 'react-router';
import type { Route } from './+types/calendar';
import { EventRows, eventData, type EventItem } from '../components/EventRow.js';
import { YearStrip } from '../components/YearStrip.js';
import { siteOf } from '../lib/context.server.js';
import { dateLabel, yearLabel } from '../lib/dates.js';
import { langFrom, t, type Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { FIRST_YEAR, LAST_YEAR, kviusYears } from '../lib/week.js';

/**
 * The farbrengens, a year at a time: a strip of the years, and the year's
 * farbrengens month by month, or one month's alone. It opens on the year
 * whose calendar falls like this one, so its weeks line up with today's.
 * Years are Hebrew years; a leap year has Adar I and II.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const year = params.year ? Number(params.year) : (kviusYears(new HDate(new Date()).getFullYear())[0] ?? LAST_YEAR);
  if (!Number.isInteger(year) || year < 5000 || year > 6000) throw data('not found', { status: 404 });
  const month = params.month;
  if (month !== undefined && !isMonthToken(month)) throw data('not found', { status: 404 });
  const leap = HDate.isLeapYear(year);
  const months = MONTHS.filter((m) => m.years === 'all' || (m.years === 'leap') === leap);
  if (month && !months.some((m) => m.token === month)) throw data('not found', { status: 404 });
  const events = await api.events({ within: month ? `${year}-${month}` : String(year), limit: 2000 });
  return { lang, siteUrl, year, month: month ?? null, months: months.map((m) => m.token), events };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { lang, siteUrl, year, month } = loaderData;
  const title = month ? `${monthByToken(month)![lang]} ${yearLabel(year, lang)}` : `${t(lang, 'tabFarbrengens')} ${yearLabel(year, lang)}`;
  return pageMeta({ title, path: month ? `/calendar/${year}/${month}` : `/calendar/${year}`, lang, siteUrl });
}

const YEARS = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => LAST_YEAR - i);

const chipLabel = (y: number, lang: Lang) => (lang === 'he' ? toHebrewNumeral(y).replace(/^ה/, '') : String(y));

/** Only the day and month, for rows under a month's heading: `י״ט כסלו`. */
const dayOf = (e: EventItem, lang: Lang) => dateLabel(eventData(e).date, lang, { civil: false }).replace(/\s\S+$/, '');

function Years({ year, lang }: { year: number; lang: Lang }) {
  return (
    <YearStrip>
      {YEARS.map((y) => (
        <li key={y}>
          <Link className={y === year ? 'year-chip on' : 'year-chip'} to={href(`/calendar/${y}`, lang)} preventScrollReset aria-current={y === year ? 'page' : undefined}>
            {chipLabel(y, lang)}
            {lang === 'he' ? <small>{y}</small> : null}
          </Link>
        </li>
      ))}
    </YearStrip>
  );
}

export default function Calendar({ loaderData }: Route.ComponentProps) {
  const { lang, year, month, months, events } = loaderData;
  const byMonth = new Map<string, EventItem[]>();
  for (const e of events) {
    const token = String(eventData(e).date ?? '').split('-')[1] ?? '';
    byMonth.set(token, [...(byMonth.get(token) ?? []), e]);
  }
  if (month) {
    const info = monthByToken(month)!;
    return (
      <>
        <ol className="breadcrumbs">
          <li>
            <Link to={href('/calendar', lang)}>{t(lang, 'tabFarbrengens')}</Link>
          </li>
          <li>
            <Link to={href(`/calendar/${year}`, lang)}>{yearLabel(year, lang)}</Link>
          </li>
        </ol>
        <h1>
          {info[lang]} {yearLabel(year, lang)}
        </h1>
        {events.length ? <EventRows events={events} sub={(e) => dayOf(e, lang)} /> : <p className="subtitle">{t(lang, 'noEvents')}</p>}
      </>
    );
  }
  return (
    <>
      <h1>{t(lang, 'tabFarbrengens')}</h1>
      <Years year={year} lang={lang} />
      <p className="subtitle" style={{ marginTop: 10 }}>
        {yearLabel(year, lang)} · {events.length} {t(lang, 'farbrengensCount')}
      </p>
      {events.length === 0 ? <p>{t(lang, 'noEvents')}</p> : null}
      {months
        .filter((token) => byMonth.has(token))
        .map((token) => {
          const info = monthByToken(token)!;
          const list = byMonth.get(token)!;
          return (
            <section key={token}>
              <h2 className="section-header">
                <Link to={href(`/calendar/${year}/${token}`, lang)} style={{ color: 'inherit', textDecoration: 'none' }}>
                  {info[lang]}
                </Link>{' '}
                · {list.length}
              </h2>
              <EventRows events={list} sub={(e) => dayOf(e, lang)} />
            </section>
          );
        })}
    </>
  );
}
