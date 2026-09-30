import { useEffect } from 'react';
import { data, Link, useNavigate } from 'react-router';
import type { Route } from './+types/daily';
import { hayomYomShiurimOf } from '@rebbehub/hebrew';
import { HayomYomDay } from '../components/HayomYomDay.js';
import { PageWords } from '../components/PageWords.js';
import { isPageText } from '@rebbehub/model';
import type { Entity } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { dateLabel } from '../lib/dates.js';
import { langFrom, type Lang } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { Icon } from '../ui/Icon.js';
import { EmptyState } from '../ui/primitives.js';
import '../styles/pages/daily.css';

/**
 * The day's learning: Chitas' Tanya (the day's portion by the yearly cycle
 * from 19 Kislev) and Hayom Yom, from the catalog's own texts, with the day
 * before and after. A day is the civil day it is learned on, and its page
 * is `/daily/2026-09-30`; `/daily` is today, as New York has it when the
 * page is made (pages are the same for everyone and kept at the edge), and
 * the browser moves on to its own today when that is another day. One read
 * of the API makes the page (services/api, `/v1/daily`).
 */

const W = {
  title: { he: 'לימוד יומי', en: 'Daily learning' },
  lede: { he: 'שיעור התניא היומי (חת״ת) והיום יום של היום.', en: 'Today’s Tanya (Chitas) and Hayom Yom.' },
  tanya: { he: 'תניא', en: 'Tanya' },
  hayomYom: { he: 'היום יום', en: 'Hayom Yom' },
  prev: { he: 'היום הקודם', en: 'Previous day' },
  next: { he: 'היום הבא', en: 'Next day' },
  today: { he: 'היום', en: 'Today' },
  whole: { he: 'לפרק כולו', en: 'The whole chapter' },
  wholeEntry: { he: 'לעמוד', en: 'Its page' },
  none: { he: 'לא נמצא לימוד ליום זה בקטלוג.', en: 'The catalog has no learning for this day.' },
  noTanya: { he: 'שיעור התניא של יום זה עדיין לא נמצא בקטלוג.', en: 'This day’s Tanya is not in the catalog yet.' },
  noHayomYom: { he: 'היום יום של יום זה עדיין לא נמצא בקטלוג.', en: 'This day’s Hayom Yom is not in the catalog yet.' },
  withheld: { he: 'המילים אינן מוצגות כאן בשל תנאי המקור.', en: 'The words are not shown here, by their source’s terms.' },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

const WEEKDAYS: Record<Lang, string[]> = {
  he: ['יום ראשון', 'יום שני', 'יום שלישי', 'יום רביעי', 'יום חמישי', 'יום שישי', 'שבת קודש'],
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Shabbos'],
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
/** Today as a place has it (`YYYY-MM-DD`). */
const todayIn = (timeZone?: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
};
const weekday = (iso: string) => new Date(`${iso}T12:00:00Z`).getUTCDay();

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const asked = params.date ?? null;
  if (asked !== null && (!ISO.test(asked) || Number.isNaN(Date.parse(asked)) || shift(asked, 0) !== asked)) throw data('not found', { status: 404 });
  const date = asked ?? todayIn('America/New_York');
  const day = await api.daily(date);
  // Each Hayom Yom entry with the head the book prints over it: weekday, year and shiurim.
  const hayomYom = day.hayomYom.map((entry) => ({ entry, shiurim: hayomYomShiurimOf(entry.data) }));
  return { lang, siteUrl, date, asked: asked !== null, hebrew: day.hebrew, tanya: day.tanya, hayomYom };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { lang, siteUrl, date, asked, hebrew } = loaderData;
  return pageMeta({ title: `${w(lang, 'title')} · ${dateLabel(hebrew, lang, { civil: false })}`, description: w(lang, 'lede'), path: asked ? `/daily/${date}` : '/daily', lang, siteUrl });
}

export const handle = { phone: { title: W.title, up: '/' } };

function Words({ item, lang }: { item: Entity; lang: Lang }) {
  const body = (item.data as { body?: unknown }).body;
  if (item.withheld) return <p className="subtle">{w(lang, 'withheld')}</p>;
  return isPageText(body) ? <PageWords page={body} lang={lang} /> : null;
}

export default function Daily({ loaderData }: Route.ComponentProps) {
  const { lang, date, asked, hebrew, tanya, hayomYom } = loaderData;
  const navigate = useNavigate();
  // `/daily` was made for New York's today: a reader whose own today is another day goes on to it.
  useEffect(() => {
    if (asked) return;
    const local = todayIn();
    if (local !== date) navigate(href(`/daily/${local}`, lang), { replace: true });
  }, [asked, date, lang, navigate]);
  const today = todayIn('America/New_York');
  const hebrewDay = dateLabel(hebrew, lang, { civil: false });
  const civil = date.split('-').map(Number).reverse().join('.');

  return (
    <div className="daily-page">
      <div className="phead">
        <div className="wrap">
          <div className="phead-row">
            <div>
              <h1 className="page-title">{w(lang, 'title')}</h1>
              <p className="lede">
                <Icon name="cal" className="subtle" /> {WEEKDAYS[lang][weekday(date)]}, <b>{hebrewDay}</b> · {civil}
              </p>
            </div>
            <nav className="phead-acts" aria-label={w(lang, 'title')}>
              <Link className="btn" to={href(`/daily/${shift(date, -1)}`, lang)} rel="prev" preventScrollReset>
                <Icon name="chevr" className="flip-ltr" />
                {w(lang, 'prev')}
              </Link>
              {asked && date !== today ? (
                <Link className="btn" to={href('/daily', lang)}>
                  {w(lang, 'today')}
                </Link>
              ) : null}
              <Link className="btn" to={href(`/daily/${shift(date, 1)}`, lang)} rel="next" preventScrollReset>
                {w(lang, 'next')}
                <Icon name="chev" className="flip-ltr" />
              </Link>
            </nav>
          </div>
        </div>
      </div>

      <div className="wrap daily-body">
        {!tanya.length && !hayomYom.length ? <EmptyState icon="book" title={w(lang, 'none')} /> : null}

        <section className="daily-section" aria-labelledby="daily-tanya">
          <h2 className="h-sec" id="daily-tanya">
            {w(lang, 'tanya')}
          </h2>
          {tanya.length ? (
            tanya.map((part) => (
              <article key={part.id} className="daily-part">
                <header className="daily-part-head">
                  <h3 className="torah">{labelOf(part, lang)}</h3>
                  <Link className="small" to={`${href(itemPath(part), lang)}#s-${part.from}`}>
                    {w(lang, 'whole')}
                  </Link>
                </header>
                <Words item={part} lang={lang} />
              </article>
            ))
          ) : (
            <p className="subtle">{w(lang, 'noTanya')}</p>
          )}
        </section>

        <section className="daily-section" aria-labelledby="daily-hayom-yom">
          <h2 className="h-sec" id="daily-hayom-yom">
            {w(lang, 'hayomYom')}
          </h2>
          {hayomYom.length ? (
            hayomYom.map(({ entry, shiurim }) =>
              entry.withheld ? (
                <p key={entry.id} className="subtle">
                  {w(lang, 'withheld')}
                </p>
              ) : (
                <HayomYomDay
                  key={entry.id}
                  title={labelOf(entry, 'he')}
                  body={(entry.data as { body?: unknown }).body}
                  shiurim={shiurim}
                  lang={lang}
                  actions={
                    <Link className="small" to={href(itemPath(entry), lang)}>
                      {w(lang, 'wholeEntry')}
                    </Link>
                  }
                />
              ),
            )
          ) : (
            <p className="subtle">{w(lang, 'noHayomYom')}</p>
          )}
        </section>
      </div>
    </div>
  );
}
