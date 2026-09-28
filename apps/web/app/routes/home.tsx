import { dateKeyToHDate, toHebrewNumeral } from '@rebbehub/hebrew';
import { Bot, FileText } from 'lucide-react';
import { Link } from 'react-router';
import type { Route } from './+types/home';
import { EventRows, PlayEventButton, eventData, hanachaOf, type EventItem } from '../components/EventRow.js';
import { YearStrip } from '../components/YearStrip.js';
import { siteOf } from '../lib/context.server.js';
import { dateLabel, yearLabel } from '../lib/dates.js';
import { BOT_NAMES } from '../lib/people.js';
import { langFrom, nameOf, t, type Lang } from '../lib/i18n.js';
import { href, itemPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { kviusYears, thisWeek } from '../lib/week.js';

/**
 * The home page is the community's: it opens on the week you are in (as
 * Sichos-Kodesh's app does: today's parsha, this week's farbrengens in a
 * year whose calendar falls like this one, the years that have them), then
 * what the catalog still lacks that anyone can help with, what people and
 * importers have added lately, and how much is here.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const week = thisWeek(lang);
  const matching = kviusYears(Number(week.today.slice(0, 4)));
  const [weekEvents, community, stats] = await Promise.all([api.events({ day: week.dayTokens, limit: 2000 }), api.community(6), api.stats()]);

  const byYear = new Map<number, EventItem[]>();
  for (const e of weekEvents) {
    const year = Number(String(eventData(e).date).slice(0, 4));
    byYear.set(year, [...(byYear.get(year) ?? []), e]);
  }
  const asked = Number(new URL(request.url).searchParams.get('year'));
  // Of the years whose calendar falls like this one, the one with the most to hear this week (the latest, on a tie).
  const fullest = (years: number[]) => [...years].sort((a, b) => (byYear.get(b)?.length ?? 0) - (byYear.get(a)?.length ?? 0) || b - a)[0];
  const year = byYear.has(asked) ? asked : (fullest(matching.filter((y) => byYear.has(y))) ?? fullest([...byYear.keys()]) ?? matching[0] ?? null);
  const todayTokens = new Set(week.dayTokens.filter((tok) => tok.endsWith(week.today.slice(-3))));
  const today = weekEvents.filter((e) => todayTokens.has(String(eventData(e).date).slice(5)) && Number(String(eventData(e).date).slice(0, 4)) !== year);

  return {
    lang,
    siteUrl,
    week,
    year,
    isKvius: year !== null && matching.includes(year),
    yearEvents: year ? (byYear.get(year) ?? []) : [],
    years: [...byYear.entries()].map(([y, list]) => ({ year: y, count: list.length })).sort((a, b) => b.year - a.year),
    today,
    community,
    counts: stats.counts,
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { lang, siteUrl } = loaderData;
  return pageMeta({
    title: '',
    description: t(lang, 'tagline'),
    path: '/',
    lang,
    siteUrl,
    jsonLd: { '@type': 'WebSite', name: 'RebbeHub', url: siteUrl, potentialAction: { '@type': 'SearchAction', target: `${siteUrl}/search?q={q}`, 'query-input': 'required name=q' } },
  });
}

const WEEKDAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Shabbos'];

const num = (n: number, lang: Lang) => n.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US');

/** `יום שלישי · י״ט כסלו` */
function dayAndDate(date: string | undefined, lang: Lang): string {
  if (!date) return '';
  const h = dateKeyToHDate(date);
  const label = dateLabel(date, lang, { civil: false });
  if (!h) return label;
  const day = lang === 'he' ? `יום ${WEEKDAYS_HE[h.getDay()]}` : WEEKDAYS_EN[h.getDay()];
  // The year is said once, in the section's heading.
  return `${day} · ${label.replace(/\s\S+$/, '')}`;
}

/** `לפני 3 שעות`, `yesterday`. */
function ago(iso: string, lang: Lang): string {
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  const fmt = new Intl.RelativeTimeFormat(lang === 'he' ? 'he' : 'en', { numeric: 'auto' });
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps) if (Math.abs(seconds) >= size) return fmt.format(Math.round(seconds / size), unit);
  return fmt.format(0, 'minute');
}

function WeekCard({ event, lang }: { event: EventItem; lang: Lang }) {
  const d = eventData(event);
  const hanacha = hanachaOf(event);
  return (
    <li className="week-card">
      <Link className="week-card-main" to={href(itemPath(event), lang)}>
        <span className="week-card-title">{nameOf(d.title, lang)}</span>
        <span className="week-card-meta">{dayAndDate(d.date, lang)}</span>
      </Link>
      <span className="week-card-actions">
        {hanacha ? (
          <a className="pill" href={hanacha.url} target="_blank" rel="noopener">
            <FileText size={14} aria-hidden="true" />
            {t(lang, 'hanacha')}
          </a>
        ) : null}
        {event.recordings ? <PlayEventButton event={event} /> : null}
      </span>
    </li>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { lang, week, year, isKvius, yearEvents, years, today, community, counts } = loaderData;
  const headline = week.parsha ? `${t(lang, 'parshas')} ${week.parsha}` : (week.holidays[0] ?? week.todayLabel);
  const { gaps } = community;
  const withRecordings = gaps.events - gaps.eventsWithoutRecordings;
  return (
    <>
      <p className="home-date">{week.todayLabel}</p>
      <h1 className="home-parsha">{headline}</h1>
      {week.parsha && week.holidays.length ? <p className="home-holiday">{week.holidays.join(' · ')}</p> : null}

      {year ? (
        <section>
          <h2 className="section-header">
            <span>
              {t(lang, 'thisWeekIn')} {yearLabel(year, lang)}
            </span>
            <Link to={href('/calendar', lang)}>{t(lang, 'allFarbrengens')}</Link>
          </h2>
          {yearEvents.length ? (
            <ul className="week-cards">
              {yearEvents.map((e) => (
                <WeekCard key={e.id} event={e} lang={lang} />
              ))}
            </ul>
          ) : (
            <p className="subtitle">{t(lang, 'noFarbrengensThisWeek')}</p>
          )}
          {isKvius ? (
            <p className="row-sub" style={{ marginTop: 8 }}>
              {t(lang, 'kviusNote')}
            </p>
          ) : null}
        </section>
      ) : null}

      {years.length ? (
        <section>
          <h2 className="section-header">{t(lang, 'everyYear')}</h2>
          <YearStrip>
            {years.map(({ year: y, count }) => (
              <li key={y}>
                <Link className={y === year ? 'year-chip on' : 'year-chip'} to={href('/', lang, { year: String(y) })} preventScrollReset aria-current={y === year ? 'true' : undefined}>
                  {lang === 'he' ? toHebrewNumeral(y).replace(/^ה/, '') : y}
                  <small aria-label={`${count} ${t(lang, 'farbrengensCount')}`}>{count}</small>
                </Link>
              </li>
            ))}
          </YearStrip>
        </section>
      ) : null}

      <section>
        <h2 className="section-header">
          <span>{t(lang, 'buildingTogether')}</span>
          <Link to={href('/help', lang)}>{t(lang, 'howToHelp')}</Link>
        </h2>
        <ul className="needs">
          {gaps.eventsWithoutRecordings ? (
            <li>
              <b>{num(gaps.eventsWithoutRecordings, lang)}</b> {t(lang, 'taskRecordings')} ({num(withRecordings, lang)} {t(lang, 'outOf')} {num(gaps.events, lang)} {t(lang, 'alreadyLinked')}).{' '}
              <Link to={href('/help', lang)}>{t(lang, 'helpLink')}</Link>
            </li>
          ) : null}
          {gaps.eventsWithoutTexts ? (
            <li>
              <b>{num(gaps.eventsWithoutTexts, lang)}</b> {t(lang, 'taskTexts')}. {t(lang, 'taskTextsNote')}{' '}
              <Link to={href('/help', lang)}>{t(lang, 'helpFind')}</Link>
            </li>
          ) : null}
          <li>
            {community.openReports ? (
              <>
                <b>{num(community.openReports, lang)}</b> {t(lang, 'reportsWaiting')}.{' '}
              </>
            ) : null}
            {t(lang, 'reportHint')}
          </li>
        </ul>
      </section>

      {community.recent.length ? (
        <section>
          <h2 className="section-header">{t(lang, 'whatsNew')}</h2>
          <ul className="feed">
            {community.recent.map((c) => (
              <li key={c.seq}>
                <span className={c.authorIsBot ? 'who bot' : 'who'} aria-hidden="true">
                  {c.authorIsBot ? <Bot size={16} /> : c.authorName.charAt(0)}
                </span>
                <div>
                  <b>{c.authorIsBot ? (BOT_NAMES[c.author]?.[lang] ?? c.authorName) : c.authorName}</b> ·{' '}
                  {c.authorIsBot && c.message.startsWith('Import from') ? `${t(lang, 'addedItems')} ${num(c.changes, lang)} ${t(lang, 'unitsShort')}` : c.message}
                  {/* "2 hours ago" is said again by the browser, a moment later than the server said it. */}
                  <small suppressHydrationWarning>
                    {num(c.changes, lang)} {t(lang, 'changes')} · {ago(c.at, lang)}
                    {c.mergedByName && c.mergedBy !== c.author ? ` · ${t(lang, 'approvedBy')} ${c.mergedByName}` : ''}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {today.length ? (
        <section>
          <h2 className="section-header">{t(lang, 'todayEveryYear')}</h2>
          <EventRows events={today.slice(0, 5)} sub={(e) => yearLabel(Number(String(eventData(e).date).slice(0, 4)), lang)} />
        </section>
      ) : null}

      <section>
        <h2 className="section-header">{t(lang, 'inCatalog')}</h2>
        <p className="in-catalog">
          <Link to={href('/sets', lang)}>
            {num(counts.work ?? 0, lang)} {t(lang, 'seforim')}
          </Link>
          {' · '}
          <Link to={href('/calendar', lang)}>
            {num(counts.event ?? 0, lang)} {t(lang, 'farbrengensCount')}
          </Link>
          {' · '}
          <Link to={href('/calendar', lang)}>
            {num(counts.recording ?? 0, lang)} {t(lang, 'recordingParts')}
          </Link>
          {counts.unit ? ` · ${num(counts.unit, lang)} ${t(lang, 'unitsShort')}` : ''}
        </p>
      </section>
    </>
  );
}
