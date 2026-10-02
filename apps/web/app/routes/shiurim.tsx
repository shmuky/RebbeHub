import { useEffect } from 'react';
import { data, Link, useNavigate } from 'react-router';
import type { Route } from './+types/shiurim';
import { isPageText } from '@rebbehub/model';
import { PageWords } from '../components/PageWords.js';
import type { ShiurPart } from '../lib/api.js';
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
 * The day's shiurim, their words on one page: Chumash with Rashi (the
 * day's aliyah, not its whole chapter), Tehillim, Tanya (the day's
 * portion) and the Rambam's three tracks, each cut to what is learned, in
 * Hebrew, each piece with a link to its whole page. `/shiurim/2026-10-02`
 * is a day's, `/shiurim` today's (as New York has it, then the reader's own
 * today); `/shiurim?ref=Exodus 10:1-11&rashi=1` any shiur by Sefaria's
 * reference (named by `title`, as the Hayom Yom's shiurim link to it). One read of the API
 * (services/api, `/v1/shiurim`).
 */

const W = {
  title: { he: 'השיעורים', en: 'The shiurim' },
  lede: { he: 'חת״ת ורמב״ם של היום, כל שיעור במקומו.', en: 'Today’s Chitas and Rambam, each shiur where it is learned.' },
  chumash: { he: 'חומש', en: 'Chumash' },
  tehillim: { he: 'תהלים', en: 'Tehillim' },
  tanya: { he: 'תניא', en: 'Tanya' },
  three: { he: 'רמב״ם, ג׳ פרקים', en: 'Rambam, three chapters' },
  one: { he: 'רמב״ם, פרק אחד', en: 'Rambam, one chapter' },
  mitzvos: { he: 'ספר המצוות', en: 'Sefer HaMitzvos' },
  passage: { he: 'השיעור', en: 'The shiur' },
  rashi: { he: 'רש״י', en: 'Rashi' },
  whole: { he: 'לפרק כולו', en: 'The whole chapter' },
  daily: { he: 'לימוד יומי', en: 'Daily learning' },
  prev: { he: 'היום הקודם', en: 'Previous day' },
  next: { he: 'היום הבא', en: 'Next day' },
  today: { he: 'היום', en: 'Today' },
  none: { he: 'השיעור עדיין לא נמצא בקטלוג.', en: 'This shiur is not in the catalog yet.' },
  withheld: { he: 'המילים אינן מוצגות כאן בשל תנאי המקור.', en: 'The words are not shown here, by their source’s terms.' },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const todayIn = (timeZone?: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const shift = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
};

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const url = new URL(request.url);
  const refs = url.searchParams.getAll('ref').filter(Boolean).slice(0, 10);
  const asked = params.date ?? null;
  if (asked !== null && (!ISO.test(asked) || Number.isNaN(Date.parse(asked)) || shift(asked, 0) !== asked)) throw data('not found', { status: 404 });
  if (refs.length && asked === null) {
    const shiurim = await api.shiurim({ refs, rashi: url.searchParams.get('rashi') === '1' });
    // The shiur as the page that links here names it (`בא, שני עם פירש״י`), not by Sefaria's reference.
    const title = url.searchParams.get('title')?.slice(0, 120);
    if (title) shiurim.sections = shiurim.sections.map((s) => ({ ...s, label: title }));
    return { lang, siteUrl, date: null, asked: false, refs, shiurim };
  }
  const date = asked ?? todayIn('America/New_York');
  return { lang, siteUrl, date, asked: asked !== null, refs, shiurim: await api.shiurim({ date }) };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { lang, siteUrl, date, asked, shiurim, refs } = loaderData;
  const title = shiurim.hebrew ? `${w(lang, 'title')} · ${dateLabel(shiurim.hebrew, lang, { civil: false })}` : `${w(lang, 'title')} · ${shiurim.sections[0]?.label ?? ''}`;
  return pageMeta({ title, description: w(lang, 'lede'), path: refs.length ? '/shiurim' : asked ? `/shiurim/${date}` : '/shiurim', lang, siteUrl });
}

export const handle = { phone: { title: W.title, up: '/daily' } };

/** A piece's name: its chapter (`פרק לג`), Rashi's marked. */
function partName(part: ShiurPart, lang: Lang): string {
  return `${part.rashi ? `${w(lang, 'rashi')} · ` : ''}${labelOf(part, lang)}`;
}

function Part({ part, lang }: { part: ShiurPart; lang: Lang }) {
  const body = (part.data as { body?: unknown }).body;
  return (
    <article className="daily-part">
      <header className="daily-part-head">
        <h3 className="torah">{partName(part, lang)}</h3>
        <Link className="small" to={`${href(itemPath(part), lang)}${part.from !== '1' ? `#s-${part.from}` : ''}`}>
          {w(lang, 'whole')}
        </Link>
      </header>
      {part.withheld ? <p className="subtle">{w(lang, 'withheld')}</p> : isPageText(body) ? <PageWords page={body} lang={lang} /> : null}
    </article>
  );
}

const NAMED = new Set(['chumash', 'tehillim', 'tanya', 'three', 'one', 'mitzvos', 'passage']);

export default function Shiurim({ loaderData }: Route.ComponentProps) {
  const { lang, date, asked, shiurim } = loaderData;
  const navigate = useNavigate();
  // `/shiurim` was made for New York's today: a reader whose own today is another day goes on to it.
  useEffect(() => {
    if (asked || date === null) return;
    const local = todayIn();
    if (local !== date) navigate(href(`/shiurim/${local}`, lang), { replace: true });
  }, [asked, date, lang, navigate]);
  const today = todayIn('America/New_York');

  return (
    <div className="daily-page">
      <div className="wrap dl">
        <h1 className="page-title dl-title">{w(lang, 'title')}</h1>
        {date && shiurim.hebrew ? (
          <nav className="dl-date" aria-label={w(lang, 'title')}>
            <Link className="ib" to={href(`/shiurim/${shift(date, -1)}`, lang)} rel="prev" preventScrollReset aria-label={w(lang, 'prev')}>
              <Icon name="chevr" className="flip-ltr" />
            </Link>
            <div className="dl-day">
              <p className="dl-hebrew">{dateLabel(shiurim.hebrew, lang, { civil: false }).replace(/\s+\S+$/, '')}</p>
              <p className="dl-sub">
                {date.split('-').map(Number).reverse().join('.')}
                {' · '}
                <Link to={href(asked ? `/daily/${date}` : '/daily', lang)}>{w(lang, 'daily')}</Link>
                {asked && date !== today ? (
                  <>
                    {' · '}
                    <Link to={href('/shiurim', lang)}>{w(lang, 'today')}</Link>
                  </>
                ) : null}
              </p>
            </div>
            <Link className="ib" to={href(`/shiurim/${shift(date, 1)}`, lang)} rel="next" preventScrollReset aria-label={w(lang, 'next')}>
              <Icon name="chev" className="flip-ltr" />
            </Link>
          </nav>
        ) : null}
      </div>

      <div className="wrap daily-body">
        {shiurim.sections.map((section) => (
          <section key={section.key} className="daily-section" id={section.key} aria-labelledby={`h-${section.key}`}>
            <h2 className="h-sec" id={`h-${section.key}`}>
              {NAMED.has(section.key) ? w(lang, section.key as keyof typeof W) : section.key}
              <span className="subtle torah" lang="he" dir="rtl">
                {' · '}
                {section.label}
              </span>
            </h2>
            {section.parts.length ? section.parts.map((part) => <Part key={`${part.id}-${part.from}`} part={part} lang={lang} />) : <EmptyState icon="book" title={w(lang, 'none')} compact />}
          </section>
        ))}
      </div>
    </div>
  );
}
