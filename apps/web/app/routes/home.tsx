import { HDate } from '@hebcal/core';
import { dateKeyFromHDate, describeDateKey } from '@rebbehub/hebrew';
import { Link } from 'react-router';
import type { Route } from './+types/home';
import { ItemList } from '../components/ItemLink.js';
import { siteOf } from '../lib/context.server.js';
import { dateLabel } from '../lib/dates.js';
import { langFrom, t } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';

export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  // Today's Hebrew date (by day; the evening's date change is left to the calendar pages).
  const today = dateKeyFromHDate(new HDate(new Date()));
  const day = today.slice(5);
  const [stats, sets, onThisDay] = await Promise.all([api.stats(), api.list({ type: 'set', limit: 100 }), api.events({ day, limit: 30 })]);
  return { lang, siteUrl, today, stats, sets: sets.items, onThisDay };
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

const COUNTED = ['work', 'unit', 'event', 'publication', 'recording', 'author'] as const;
const COUNT_KEYS = { work: 'works', unit: 'units', event: 'events', publication: 'publications', recording: 'recordings', author: 'authors' } as const;

export default function Home({ loaderData }: Route.ComponentProps) {
  const { lang, today, stats, sets, onThisDay } = loaderData;
  const topSets = sets.filter((s) => !(s.data as { parent?: string }).parent);
  return (
    <>
      <section className="hero">
        <h1>{t(lang, 'tagline')}</h1>
        <ul className="stats" aria-label={t(lang, 'inCatalog')}>
          {COUNTED.filter((type) => stats.counts[type]).map((type) => (
            <li key={type}>
              <strong>{stats.counts[type]!.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US')}</strong>
              {t(lang, COUNT_KEYS[type])}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>{t(lang, 'sets')}</h2>
        <ul className="cards">
          {topSets.map((set) => (
            <li key={set.id}>
              <Link className="card" to={href(itemPath(set), lang)}>
                <span className="card-title">{labelOf(set, lang)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>
          {t(lang, 'thisDay')} · {describeDateKey(today, lang).split(' ').slice(0, -1).join(' ')}
        </h2>
        {onThisDay.length ? <ItemList items={onThisDay} meta={(e) => dateLabel((e.data as { date?: string }).date, lang, { civil: false })} /> : <p className="card-meta">{t(lang, 'nothingThisDay')}</p>}
      </section>
    </>
  );
}
