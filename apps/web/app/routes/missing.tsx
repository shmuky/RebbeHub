import { Link } from 'react-router';
import type { Route } from './+types/missing';
import { EventRows, eventData, type EventItem } from '../components/EventRow.js';
import { siteOf } from '../lib/context.server.js';
import { dateLabel, yearLabel } from '../lib/dates.js';
import { langFrom, t } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';

/**
 * The Missing board (the plan, section 7): what the catalog still lacks
 * that anyone could help with. Farbrengens without a recording or a text,
 * by year, and sefarim with no scan of any printing. Each row leads to its
 * page, where "Add a recording", "Add a scan" and "Suggest a fix" are.
 * And the files Sichos-Kodesh's archive wants and could not get: a
 * hanacha whose Drive link is gone, a recording JEM's CDN lost; whoever
 * has one can add it on its item's page.
 */

const KINDS = ['recordings', 'texts', 'scans', 'files'] as const;
type Kind = (typeof KINDS)[number];
const YEARS = Array.from({ length: 5752 - 5710 + 1 }, (_, i) => 5710 + i);

export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const url = new URL(request.url);
  const kind: Kind = (KINDS as readonly string[]).includes(url.searchParams.get('kind') ?? '') ? (url.searchParams.get('kind') as Kind) : 'recordings';
  const year = /^\d{4}$/.test(url.searchParams.get('year') ?? '') ? url.searchParams.get('year')! : undefined;
  const byYear = kind === 'recordings' || kind === 'texts';
  const missing = kind === 'files' ? { kind, total: 0, items: [] } : await api.missing(kind, { within: byYear ? year : undefined, limit: 200 });
  const files = kind === 'files' ? await api.missingFiles({ limit: 200 }) : null;
  return { lang, siteUrl, kind, year, missing, files };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: t(loaderData.lang, 'missingTitle'), path: '/missing', lang: loaderData.lang, siteUrl: loaderData.siteUrl });
}

export default function Missing({ loaderData }: Route.ComponentProps) {
  const { lang, kind, year, missing, files } = loaderData;
  const num = (n: number) => n.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US');
  const tab = (k: Kind) => href('/missing', lang, { kind: k, year: k === 'recordings' || k === 'texts' ? year : undefined });
  const total = files ? files.total : missing.total;
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

      {kind === 'recordings' || kind === 'texts' ? (
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
        <span>{num(total)}</span>
      </h2>
      <p className="row-sub">{t(lang, `missingHow_${kind}`)}</p>

      {files ? (
        <ul className="rows">
          {files.items.map((g) => (
            <li key={`${g.collection}/${g.item_id}/${g.kind}/${g.role}/${g.url}`} className="row">
              {g.entity ? (
                <Link className="row-title" to={href(itemPath(g.entity), lang)}>
                  {labelOf(g.entity, lang)}
                </Link>
              ) : (
                <span className="row-title">{g.label ?? g.item_id}</span>
              )}
              <span className="row-sub">
                {[g.hebrew_date && /^\d{4}-/.test(g.hebrew_date) ? dateLabel(g.hebrew_date, lang, { civil: false }) : null, t(lang, g.kind === 'audio' ? 'missingFile_audio' : 'missingFile_text'), g.label && g.entity ? g.label : null]
                  .filter(Boolean)
                  .join(' · ')}
                {' · '}
                <a href={g.url} target="_blank" rel="noopener nofollow">
                  {t(lang, 'missingFileWhere')}
                </a>
              </span>
            </li>
          ))}
        </ul>
      ) : kind === 'scans' ? (
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
      {(files ? files.total > files.items.length : missing.total > missing.items.length) ? <p className="row-sub">{t(lang, 'missingMore')}</p> : null}

      <p>
        <Link to={href('/projects', lang)}>{t(lang, 'projectsTitle')}</Link>
      </p>
    </>
  );
}
