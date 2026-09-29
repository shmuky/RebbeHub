import { HDate, months as HMONTHS } from '@hebcal/core';
import type { LocalName } from '@rebbehub/model';
import { MONTHS, dateKeyFromHDate, dateKeyToGregorian, isMonthToken, monthByToken, toHebrewNumeral } from '@rebbehub/hebrew';
import { Fragment, useEffect, useRef } from 'react';
import { data, Link, redirect } from 'react-router';
import type { Route } from './+types/calendar';
import { PlayEventButton, eventData, eventRow, hanachaOf, type EventItem } from '../components/EventRow.js';
import { siteOf } from '../lib/context.server.js';
import { yearLabel } from '../lib/dates.js';
import { langFrom, nameOf, t, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { href, itemPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { parseTokens, withToken, type TokenKey } from '../lib/tokens.js';
import { FIRST_YEAR, LAST_YEAR, kviusYears } from '../lib/week.js';
import { Icon } from '../ui/Icon.js';
import { Breadcrumbs, EmptyState } from '../ui/primitives.js';
import { TokenSearch } from '../ui/TokenSearch.js';
import '../styles/pages/browse.css';

/**
 * The farbrengens, a year at a time, as GitHub draws a year of work: a
 * square for every day of the Hebrew year, darker the more farbrengens it
 * had, and beneath it the year's farbrengens month by month, one dense
 * line each (the day, the name, whether it can be heard and read). A
 * month has a page of its own. It opens on the year whose calendar falls
 * like this one, so its weeks line up with today's. Years are Hebrew
 * years; a leap year has Adar I and II.
 *
 * Filters are written into the search line: `יש:הקלטה` (only what can be
 * heard), `יש:הנחה`, `חודש:שבט`, `שנה:תשמ״ב` (another year), and any
 * words, which must be in the name.
 */

const YEAR_KEY: TokenKey = { key: 'year', he: 'שנה', en: 'year', hint: { he: 'שנה עברית, למשל תשמ״ב', en: 'A Hebrew year, e.g. 5742' } };
const HAS_KEY: TokenKey = {
  key: 'has',
  he: 'יש',
  en: 'has',
  values: [
    { value: 'recording', he: 'הקלטה', en: 'recording', tone: 'audio' },
    { value: 'text', he: 'הנחה', en: 'hanacha', tone: 'text' },
  ],
};

function keysFor(monthTokens: string[], counts?: Map<string, number>): TokenKey[] {
  return [
    HAS_KEY,
    {
      key: 'month',
      he: 'חודש',
      en: 'month',
      values: monthTokens.map((m) => {
        const info = monthByToken(m)!;
        return { value: m, he: info.he, en: info.en, count: counts?.get(m) };
      }),
    },
    YEAR_KEY,
  ];
}

/** A year as typed: 5742, תשמ״ב, or 742. */
function yearOfText(text: string): number | null {
  const digits = Number(text.replace(/\D/g, ''));
  if (digits >= 5000 && digits < 6000) return digits;
  if (digits >= 700 && digits < 800) return 5000 + digits;
  const letters = text.replace(/[״"'׳]/g, '');
  for (let y = FIRST_YEAR - 20; y <= LAST_YEAR + 60; y++) if (toHebrewNumeral(y).replace(/[״"'׳]/g, '').replace(/^ה/, '') === letters.replace(/^ה/, '')) return y;
  return null;
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';
  const asked = params.year ?? url.searchParams.get('year') ?? undefined;
  const year = asked ? Number(asked) : (kviusYears(new HDate(new Date()).getFullYear())[0] ?? LAST_YEAR);
  if (!Number.isInteger(year) || year < 5000 || year > 6000) throw data('not found', { status: 404 });
  const month = params.month;
  if (month !== undefined && !isMonthToken(month)) throw data('not found', { status: 404 });
  const leap = HDate.isLeapYear(year);
  const monthTokens = MONTHS.filter((m) => m.years === 'all' || (m.years === 'leap') === leap).map((m) => m.token as string);
  if (month && !monthTokens.includes(month)) throw data('not found', { status: 404 });

  // A year written into the line is another page; the rest of the line goes with it.
  const parsed = parseTokens(q, keysFor(monthTokens));
  const toYear = parsed.filters.year?.map(yearOfText).find((y): y is number => y !== null);
  if (toYear && toYear !== year) {
    const rest = withToken(q, keysFor(monthTokens), 'year', null, lang);
    throw redirect(href(`/calendar/${toYear}`, lang, { q: rest || undefined }));
  }
  // The year's farbrengens as rows (their name, date, what they have), not whole: the page carries them all, hidden, for the filter.
  const all = (await api.events({ within: month ? `${year}-${month}` : String(year), limit: 2000, brief: true })).map(eventRow);
  return { lang, siteUrl, year, month: month ?? null, months: monthTokens, all, q, asked: Boolean(asked) };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { lang, siteUrl, year, month } = loaderData;
  const title = month ? `${monthByToken(month)![lang]} ${yearLabel(year, lang)}` : `${t(lang, 'tabFarbrengens')} ${yearLabel(year, lang)}`;
  return pageMeta({ title, path: month ? `/calendar/${year}/${month}` : `/calendar/${year}`, lang, siteUrl });
}

const W = {
  lede: { he: 'כל ההתוועדויות של השנה, יום אחר יום: כל ריבוע הוא יום, וכהה יותר ככל שהיו בו יותר התוועדויות.', en: 'The year’s farbrengens, day by day: each square is a day, darker the more farbrengens it had.' },
  ledeMonth: { he: 'ההתוועדויות של החודש, יום אחר יום.', en: 'The month’s farbrengens, day by day.' },
  sameKvius: { he: 'השנה שלוחה נופל כמו השנה הנוכחית, כך שהשבועות מקבילים להיום.', en: 'This year’s calendar falls like the current one, so its weeks line up with today’s.' },
  prevYear: { he: 'השנה הקודמת', en: 'Previous year' },
  nextYear: { he: 'השנה הבאה', en: 'Next year' },
  prevMonth: { he: 'החודש הקודם', en: 'Previous month' },
  nextMonth: { he: 'החודש הבא', en: 'Next month' },
  filterLabel: { he: 'סינון ההתוועדויות', en: 'Filter the farbrengens' },
  filterPlaceholder: { he: 'סינון לפי שם, חודש, הקלטה או הנחה', en: 'Filter by name, month, recording or hanacha' },
  filterHint: { he: 'יש:הקלטה חודש:שבט', en: 'has:recording month:Shevat' },
  years: { he: 'שנים', en: 'Years' },
  thisYear: { he: 'בשנה זו', en: 'This year' },
  thisMonth: { he: 'בחודש זה', en: 'This month' },
  withRecording: { he: 'עם הקלטה', en: 'With a recording' },
  withText: { he: 'עם הנחה', en: 'With a hanacha' },
  noRecording: { he: 'בלי הקלטה', en: 'Without a recording' },
  less: { he: 'פחות', en: 'Less' },
  more: { he: 'יותר', en: 'More' },
  dayUnknown: { he: 'יום לא ידוע', en: 'Day unknown' },
  shown: { he: 'מוצגות', en: 'shown' },
  of: { he: 'מתוך', en: 'of' },
  clear: { he: 'ניקוי הסינון', en: 'Clear the filter' },
  noMatch: { he: 'אין התוועדות שמתאימה לסינון.', en: 'No farbrengen matches the filter.' },
  gaps: { he: 'חסרות הקלטות?', en: 'Missing recordings?' },
  gapsHint: { he: 'רשימת ההתוועדויות שעוד אין להן הקלטה, לפי שנים.', en: 'The farbrengens with no recording yet, by year.' },
  gapsLink: { he: 'לרשימה', en: 'See the list' },
  yearView: { he: 'השנה בריבועים', en: 'The year in squares' },
  farbrengen: { he: 'התוועדות', en: 'farbrengen' },
  hanacha: { he: 'הנחה', en: 'Hanacha' },
  recording: { he: 'הקלטה', en: 'Recording' },
  parts: { he: 'חלקים', en: 'parts' },
} as const;

const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

const WEEKDAYS: Record<Lang, string[]> = {
  he: ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש״ק'],
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};
const WEEKDAY_NAMES: Record<Lang, string[]> = {
  he: ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת קודש'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Shabbos'],
};

const YEARS = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => LAST_YEAR - i);

const yearShort = (y: number, lang: Lang) => (lang === 'he' ? toHebrewNumeral(y).replace(/^ה/, '') : String(y));
const dayNumber = (d: number, lang: Lang) => (lang === 'he' ? toHebrewNumeral(d) : String(d));
const civilShort = (key: string) => {
  const civil = dateKeyToGregorian(key);
  return civil ? civil.split('-').map(Number).reverse().join('.') : null;
};
const keyOf = (e: EventItem) => String(eventData(e).date ?? '');
const hasDay = (key: string) => /^\d{4}-\w+-\d{2}$/.test(key) && !key.endsWith('-00');

/** The filter as the loader's events see it. */
function applyFilter(events: EventItem[], q: string, keys: TokenKey[], lang: Lang) {
  const parsed = parseTokens(q, keys);
  const has = parsed.filters.has ?? [];
  const monthsWanted = parsed.filters.month ?? [];
  const words = parsed.text.split(/\s+/).filter(Boolean);
  const active = has.length > 0 || monthsWanted.length > 0 || words.length > 0;
  const list = events.filter((e) => {
    if (has.includes('recording') && !e.recordings) return false;
    if (has.includes('text') && !hanachaOf(e)) return false;
    if (monthsWanted.length && !monthsWanted.includes(keyOf(e).split('-')[1] ?? '')) return false;
    const title = `${nameOf(eventData(e).title, 'he')} ${nameOf(eventData(e).title, 'en')} ${nameOf(eventData(e).title, lang)}`;
    return words.every((word) => title.includes(word));
  });
  return { list, active };
}

export default function Calendar({ loaderData }: Route.ComponentProps) {
  const { lang, year, month, months, q, asked } = loaderData;
  const all = loaderData.all as EventItem[];
  const counts = new Map<string, number>();
  for (const e of all) {
    const token = keyOf(e).split('-')[1] ?? '';
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  const keys = keysFor(months, counts);
  const { list: events, active } = applyFilter(all, q, keys, lang);
  const byMonth = new Map<string, EventItem[]>();
  for (const e of [...events].sort((a, b) => keyOf(a).localeCompare(keyOf(b)))) {
    const token = keyOf(e).split('-')[1] ?? '';
    byMonth.set(token, [...(byMonth.get(token) ?? []), e]);
  }
  const withRecording = events.filter((e) => e.recordings).length;
  const withText = events.filter((e) => hanachaOf(e)).length;
  const monthInfo = month ? monthByToken(month)! : null;
  const index = month ? months.indexOf(month) : -1;
  const prevMonth = index > 0 ? months[index - 1] : null;
  const nextMonth = index >= 0 && index < months.length - 1 ? months[index + 1] : null;
  const here = month ? `/calendar/${year}/${month}` : `/calendar/${year}`;
  const title = monthInfo ? `${monthInfo[lang]} ${yearLabel(year, lang)}` : `${t(lang, 'tabFarbrengens')} ${yearLabel(year, lang)}`;
  const keep = { q: q || undefined };
  // On a phone the years are one row that scrolls: open it with this year in view, scrolling the row alone.
  const yearList = useRef<HTMLElement>(null);
  useEffect(() => {
    const list = yearList.current;
    const on = list?.querySelector<HTMLElement>('[aria-current]');
    if (!list || !on || list.scrollWidth <= list.clientWidth) return;
    list.scrollLeft += on.getBoundingClientRect().left - list.getBoundingClientRect().left - (list.clientWidth - on.clientWidth) / 2;
  }, [year]);

  return (
    <div className="cal-page">
      <div className="phead">
        <div className="wrap">
          <Breadcrumbs
            lang={lang}
            items={monthInfo ? [{ label: t(lang, 'tabFarbrengens'), to: href('/calendar', lang) }, { label: yearLabel(year, lang), to: href(`/calendar/${year}`, lang, keep) }, { label: monthInfo[lang] }] : [{ label: t(lang, 'tabFarbrengens'), to: href('/calendar', lang) }, { label: yearLabel(year, lang) }]}
          />
          <div className="phead-row">
            <div>
              <h1 className="page-title">{title}</h1>
              <p className="lede">{monthInfo ? w(lang, 'ledeMonth') : w(lang, 'lede')}</p>
            </div>
            <nav className="phead-acts" aria-label={monthInfo ? w(lang, 'nextMonth') : w(lang, 'nextYear')}>
              {monthInfo ? (
                <>
                  {prevMonth ? (
                    <Link className="btn" to={href(`/calendar/${year}/${prevMonth}`, lang, keep)} rel="prev">
                      <Icon name="chevr" className="flip-ltr" />
                      {monthByToken(prevMonth)![lang]}
                    </Link>
                  ) : null}
                  {nextMonth ? (
                    <Link className="btn" to={href(`/calendar/${year}/${nextMonth}`, lang, keep)} rel="next">
                      {monthByToken(nextMonth)![lang]}
                      <Icon name="chev" className="flip-ltr" />
                    </Link>
                  ) : null}
                </>
              ) : (
                <>
                  {year > FIRST_YEAR ? (
                    <Link className="btn" to={href(`/calendar/${year - 1}`, lang, keep)} rel="prev" preventScrollReset>
                      <Icon name="chevr" className="flip-ltr" />
                      {yearLabel(year - 1, lang)}
                    </Link>
                  ) : null}
                  {year < LAST_YEAR ? (
                    <Link className="btn" to={href(`/calendar/${year + 1}`, lang, keep)} rel="next" preventScrollReset>
                      {yearLabel(year + 1, lang)}
                      <Icon name="chev" className="flip-ltr" />
                    </Link>
                  ) : null}
                </>
              )}
            </nav>
          </div>
          <div className="facts-row">
            <span>
              <Icon name="cal" className="subtle" />
              <span>
                <b>{num(events.length, lang)}</b> {t(lang, 'farbrengensCount')}
                {active ? ` (${w(lang, 'of')} ${num(all.length, lang)})` : ''}
              </span>
            </span>
            <span>
              <Icon name="audio" className="subtle" />
              <span>
                <b>{num(withRecording, lang)}</b> {w(lang, 'withRecording')}
              </span>
            </span>
            <span>
              <Icon name="scan" className="subtle" />
              <span>
                <b>{num(withText, lang)}</b> {w(lang, 'withText')}
              </span>
            </span>
          </div>
          <div className="cal-filter">
            <TokenSearch lang={lang} keys={keys} defaultValue={q} action={here} label={w(lang, 'filterLabel')} placeholder={w(lang, 'filterPlaceholder')} hint={w(lang, 'filterHint')} />
          </div>
        </div>
      </div>

      <div className="wrap cols narrow-side">
        <div className="cal-main">
          {!monthInfo ? <YearGrid year={year} events={events} lang={lang} /> : null}
          {!monthInfo && !asked ? (
            <p className="cal-kvius subtle">
              <Icon name="info" size={14} /> {w(lang, 'sameKvius')}
            </p>
          ) : null}

          {all.length === 0 ? (
            <EmptyState icon="cal" title={t(lang, 'noEvents')} />
          ) : events.length === 0 ? (
            <EmptyState icon="filter" title={w(lang, 'noMatch')} actions={<Link className="btn" to={href(here, lang)}>{w(lang, 'clear')}</Link>} compact />
          ) : (
            months
              .filter((token) => byMonth.has(token))
              .map((token) => {
                const info = monthByToken(token)!;
                const list = byMonth.get(token)!;
                return (
                  <section key={token} className="cal-month" aria-labelledby={`m-${token}`}>
                    <h2 className="h-block" id={`m-${token}`}>
                      {monthInfo ? info[lang] : <Link to={href(`/calendar/${year}/${token}`, lang, keep)}>{info[lang]}</Link>}
                      <span className="count">{num(list.length, lang)}</span>
                    </h2>
                    <DayRows events={list} lang={lang} />
                  </section>
                );
              })
          )}
        </div>

        <aside className="side">
          <section>
            <h2>{w(lang, 'years')}</h2>
            <nav className="year-list" aria-label={w(lang, 'years')} ref={yearList}>
              {YEARS.map((y) => (
                <Link key={y} to={href(`/calendar/${y}`, lang, keep)} aria-current={y === year ? 'page' : undefined} title={yearLabel(y, lang)}>
                  {yearShort(y, lang)}
                </Link>
              ))}
            </nav>
          </section>
          <section>
            <h2>{monthInfo ? w(lang, 'thisMonth') : w(lang, 'thisYear')}</h2>
            <dl>
              <dt>{t(lang, 'tabFarbrengens')}</dt>
              <dd>{num(all.length, lang)}</dd>
              <dt>{w(lang, 'withRecording')}</dt>
              <dd>
                <Link to={href(here, lang, { q: withToken(q, keys, 'has', 'recording', lang) })}>{num(all.filter((e) => e.recordings).length, lang)}</Link>
              </dd>
              <dt>{w(lang, 'withText')}</dt>
              <dd>
                <Link to={href(here, lang, { q: withToken(q, keys, 'has', 'text', lang) })}>{num(all.filter((e) => hanachaOf(e)).length, lang)}</Link>
              </dd>
            </dl>
          </section>
          {!monthInfo ? (
            <section>
              <h2>{w(lang, 'gaps')}</h2>
              <p className="side-p">{w(lang, 'gapsHint')}</p>
              <Link to={href('/missing', lang, { kind: 'recordings' })}>{w(lang, 'gapsLink')}</Link>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

/**
 * The year as squares, a column a week from Rosh Hashanah to Elul, a row a
 * weekday; a day with farbrengens is darker by how many, and opens its
 * line below. Months are named over the week they begin in.
 */
function YearGrid({ year, events, lang }: { year: number; events: EventItem[]; lang: Lang }) {
  const byDay = new Map<string, EventItem[]>();
  for (const e of events) {
    const key = keyOf(e);
    if (hasDay(key)) byDay.set(key, [...(byDay.get(key) ?? []), e]);
  }
  const start = new HDate(1, HMONTHS.TISHREI, year);
  const end = new HDate(1, HMONTHS.TISHREI, year + 1);
  const first = start.onOrBefore(0);
  const weeks: Array<Array<{ key: string; day: number; inYear: boolean }>> = [];
  const heads: Array<{ col: number; label: string }> = [];
  for (let d = first, col = 0; d.deltaDays(end) < 0; col++) {
    const week: Array<{ key: string; day: number; inYear: boolean }> = [];
    for (let i = 0; i < 7; i++, d = d.next()) {
      const inYear = d.deltaDays(start) >= 0 && d.deltaDays(end) < 0;
      const key = dateKeyFromHDate(d);
      week.push({ key, day: d.getDate(), inYear });
      if (inYear && d.getDate() === 1) heads.push({ col, label: monthByToken(key.split('-')[1]!)![lang] });
    }
    weeks.push(week);
  }
  const level = (n: number) => (n === 0 ? 0 : n === 1 ? 1 : n === 2 ? 2 : 3);
  return (
    <figure className="year-grid" aria-label={w(lang, 'yearView')}>
      {/* Scrolls sideways on a phone: reachable by keyboard too. */}
      <div className="yg-scroll" tabIndex={0}>
        <div className="yg" style={{ ['--weeks' as string]: weeks.length }}>
          <div className="yg-months" aria-hidden="true">
            {heads.map((h) => (
              <span key={h.col} style={{ gridColumn: h.col + 1 }}>
                {h.label}
              </span>
            ))}
          </div>
          <div className="yg-days" aria-hidden="true">
            {WEEKDAYS[lang].map((d, i) => (
              <span key={i}>{i % 2 === 0 ? d : ''}</span>
            ))}
          </div>
          <div className="yg-cells">
            {weeks.map((week, col) => (
              <Fragment key={col}>
                {week.map((cell, row) => {
                  const list = byDay.get(cell.key) ?? [];
                  const style = { gridColumn: col + 1, gridRow: row + 1 };
                  if (!cell.inYear) return <span key={cell.key} className="c out" style={style} />;
                  const label = `${dayNumber(cell.day, lang)} ${monthByToken(cell.key.split('-')[1]!)![lang]}${list.length ? `: ${list.map((e) => nameOf(eventData(e).title, lang)).join(' · ')}` : ''}`;
                  return list.length ? (
                    <a key={cell.key} className={`c l${level(list.length)}`} style={style} href={`#d-${cell.key}`} title={label} aria-label={label} />
                  ) : (
                    <span key={cell.key} className="c" style={style} title={label} />
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="yg-legend">
        <span>{w(lang, 'less')}</span>
        <i className="c" />
        <i className="c l1" />
        <i className="c l2" />
        <i className="c l3" />
        <span>{w(lang, 'more')}</span>
      </figcaption>
    </figure>
  );
}

/** A month's farbrengens, one dense line each: the day, the name, what can be heard and read, and play. */
function DayRows({ events, lang }: { events: EventItem[]; lang: Lang }) {
  let last = '';
  return (
    <ol className="box day-rows">
      {events.map((e) => {
        const d = eventData(e);
        const key = keyOf(e);
        const day = hasDay(key) ? Number(key.split('-')[2]) : null;
        const hdate = day ? new HDate(day, monthByToken(key.split('-')[1]!)!.hdateMonth, Number(key.slice(0, 4))) : null;
        const first = key !== last;
        last = key;
        const civil = hasDay(key) ? civilShort(key) : null;
        const text = hanachaOf(e);
        return (
          <li key={e.id} className="row day-row" id={first && day ? `d-${key}` : undefined}>
            <span className={first ? 'dn' : 'dn again'} aria-hidden={!first}>
              {day ? (
                <>
                  <b>{dayNumber(day, lang)}</b>
                  <small>{WEEKDAYS[lang][hdate!.getDay()]}</small>
                </>
              ) : (
                <small>—</small>
              )}
            </span>
            <span className="row-main">
              <Link className="row-title" to={href(itemPath(e), lang)}>
                {nameOf(d.title as LocalName | undefined, lang) || w(lang, 'farbrengen')}
              </Link>
              <span className="row-sub">
                {day ? `${WEEKDAY_NAMES[lang][hdate!.getDay()]}${civil ? ` · ${civil}` : ''}` : w(lang, 'dayUnknown')}
                {e.recordings ? ` · ${e.recordings === 1 ? w(lang, 'recording') : `${num(e.recordings, lang)} ${w(lang, 'parts')}`}` : ''}
              </span>
            </span>
            <span className="has">
              {text ? <Icon name="scan" label={w(lang, 'hanacha')} /> : <i />}
              {e.recordings ? <Icon name="audio" label={w(lang, 'recording')} /> : <i />}
            </span>
            {e.recordings ? <PlayEventButton event={e} /> : <span className="pp-space" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
