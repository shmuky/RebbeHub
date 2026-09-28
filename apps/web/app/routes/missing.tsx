import { Link } from 'react-router';
import type { Route } from './+types/missing';
import { EventRows, eventData, type EventItem } from '../components/EventRow.js';
import { siteOf } from '../lib/context.server.js';
import { dateLabel, yearLabel } from '../lib/dates.js';
import { langFrom, t } from '../lib/i18n.js';
import { tn } from '../lib/i18nNetwork.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';

/**
 * The Missing board (the plan, section 7): what the catalog still lacks
 * that anyone could help with. Farbrengens without a recording or a text,
 * by year, and sefarim with no scan of any printing. Each row leads to its
 * page, where "Add a recording", "Add a scan" and "Suggest a fix" are.
 */

const KINDS = ['recordings', 'texts', 'scans'] as const;
type Kind = (typeof KINDS)[number];
const YEARS = Array.from({ length: 5752 - 5710 + 1 }, (_, i) => 5710 + i);

export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const url = new URL(request.url);
  const kind: Kind = (KINDS as readonly string[]).includes(url.searchParams.get('kind') ?? '') ? (url.searchParams.get('kind') as Kind) : 'recordings';
  const year = /^\d{4}$/.test(url.searchParams.get('year') ?? '') ? url.searchParams.get('year')! : undefined;
  const missing = await api.missing(kind, { within: kind === 'scans' ? undefined : year, limit: 200 });
  return { lang, siteUrl, kind, year, missing };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: t(loaderData.lang, 'missingTitle'), path: '/missing', lang: loaderData.lang, siteUrl: loaderData.siteUrl });
}

export default function Missing({ loaderData }: Route.ComponentProps) {
  const { lang, kind, year, missing } = loaderData;
  const num = (n: number) => n.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US');
  const tab = (k: Kind) => href('/missing', lang, { kind: k, year: k === 'scans' ? undefined : year });
  return (
    <>
      <h1>{t(lang, 'missingTitle')}</h1>
      <p className="subtitle">{t(lang, 'missingIntro')}</p>

      <nav className="page-tabs" aria-label={t(lang, 'sections')}>
        {KINDS.map((k) => (
          <Link key={k} to={tab(k)} aria-current={kind === k ? 'page' : undefined}>
            {t(lang, `missing_${k}`)}
          </Link>
        ))}
      </nav>

      {kind !== 'scans' ? (
        <nav className="page-tabs years" aria-label={t(lang, 'year')}>
          <Link to={href('/missing', lang, { kind })} aria-current={year ? undefined : 'page'}>
            {t(lang, 'allYears')}
          </Link>
          {YEARS.map((y) => (
            <Link key={y} to={href('/missing', lang, { kind, year: String(y) })} aria-current={year === String(y) ? 'page' : undefined}>
              {yearLabel(y, lang)}
            </Link>
          ))}
        </nav>
      ) : null}

      <h2 className="section-header">
        <span>{t(lang, `missingHead_${kind}`)}</span>
        <span>{num(missing.total)}</span>
      </h2>
      <p className="row-sub">{t(lang, `missingHow_${kind}`)}</p>

      {kind === 'scans' ? (
        <ul className="rows">
          {missing.items.map((w) => (
            <li key={w.id} className="row">
              <Link className="row-title" to={href(itemPath(w), lang)}>
                {labelOf(w, lang)}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EventRows events={missing.items as EventItem[]} sub={(e) => dateLabel(eventData(e).date, lang, { civil: false })} />
      )}
      {missing.total > missing.items.length ? <p className="row-sub">{t(lang, 'missingMore')}</p> : null}

      <p>
        <Link to={href('/projects', lang)}>{t(lang, 'projectsTitle')}</Link> · <Link to={href('/health', lang)}>{tn(lang, 'healthTitle')}</Link>
      </p>
    </>
  );
}
