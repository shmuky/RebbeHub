import { HDate } from '@hebcal/core';
import { MONTHS, isMonthToken, monthByToken } from '@rebbehub/hebrew';
import { data, Link } from 'react-router';
import type { Route } from './+types/calendar';
import { ItemList } from '../components/ItemLink.js';
import { siteOf } from '../lib/context.server.js';
import { dateLabel, yearLabel } from '../lib/dates.js';
import { langFrom, t } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import type { Entity } from '../lib/api.js';

/**
 * The events calendar: a year's farbrengens and other events by month, or
 * one month's by day. Years are Hebrew years; a leap year has Adar I and II.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const year = params.year ? Number(params.year) : new HDate(new Date()).getFullYear();
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
  const title = month ? `${monthByToken(month)![lang]} ${yearLabel(year, lang)}` : `${t(lang, 'calendar')} ${yearLabel(year, lang)}`;
  return pageMeta({ title, path: month ? `/calendar/${year}/${month}` : `/calendar/${year}`, lang, siteUrl });
}

const dateOf = (e: Entity) => (e.data as { date?: string }).date ?? '';

export default function Calendar({ loaderData }: Route.ComponentProps) {
  const { lang, year, month, months, events } = loaderData;
  const byMonth = new Map<string, Entity[]>();
  for (const e of events) {
    const token = dateOf(e).split('-')[1] ?? '';
    byMonth.set(token, [...(byMonth.get(token) ?? []), e]);
  }
  const yearNav = (
    <nav className="year-nav" aria-label={t(lang, 'year')}>
      <Link to={href(`/calendar/${year - 1}`, lang)}>{t(lang, 'previousYear')}</Link>
      <Link to={href(`/calendar/${year + 1}`, lang)}>{t(lang, 'nextYear')}</Link>
    </nav>
  );
  if (month) {
    const info = monthByToken(month)!;
    return (
      <>
        <ol className="breadcrumbs">
          <li>
            <Link to={href('/calendar', lang)}>{t(lang, 'calendar')}</Link>
          </li>
          <li>
            <Link to={href(`/calendar/${year}`, lang)}>{yearLabel(year, lang)}</Link>
          </li>
        </ol>
        <h1>
          {info[lang]} {yearLabel(year, lang)}
        </h1>
        {events.length ? <ItemList items={events} meta={(e) => dateLabel(dateOf(e as Entity), lang)} /> : <p>{t(lang, 'noEvents')}</p>}
      </>
    );
  }
  return (
    <>
      <h1>
        {t(lang, 'calendar')} {yearLabel(year, lang)}
        {lang === 'he' ? null : <span className="card-meta"> ({year})</span>}
      </h1>
      {yearNav}
      <div className="months">
        {months.map((token) => {
          const info = monthByToken(token)!;
          const list = byMonth.get(token) ?? [];
          return (
            <section className="month" key={token}>
              <h3>
                <Link to={href(`/calendar/${year}/${token}`, lang)}>{info[lang]}</Link> <span className="card-meta">({list.length})</span>
              </h3>
              {list.length ? <ItemList items={list.slice(0, 8)} meta={(e) => dateLabel(dateOf(e as Entity), lang, { civil: false }).split(' ')[0]} /> : <p className="card-meta">{t(lang, 'noEvents')}</p>}
              {list.length > 8 ? <Link to={href(`/calendar/${year}/${token}`, lang)}>{t(lang, 'more')}</Link> : null}
            </section>
          );
        })}
      </div>
      {yearNav}
    </>
  );
}
