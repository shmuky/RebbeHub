import { Link } from 'react-router';
import type { Route } from './+types/missing';
import { EventRow, type EventItem } from '../components/EventRow.js';
import type { ArchiveGap, CatalogHealth, Entity } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { dateLabel, yearLabel } from '../lib/dates.js';
import { langFrom, t, type Lang } from '../lib/i18n.js';
import { tn } from '../lib/i18nNetwork.js';
import { num } from '../lib/i18nUi.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { parseTokens, type TokenKey } from '../lib/tokens.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { Box, EmptyState, Label, Pagination, RelativeTime, Tabs, cx } from '../ui/primitives.js';
import { TokenSearch } from '../ui/TokenSearch.js';
import { MISSING_CAP, capped } from './projects.js';
import '../styles/pages/projects.css';

/**
 * The Missing board (the plan, section 7): what the catalog still lacks
 * that anyone could help with. Farbrengens without a recording or a text,
 * by year, and sefarim with no scan of any printing. Each row leads to its
 * page, where "Add a recording", "Add a scan" and "Suggest a fix" are.
 * And the files Sichos-Kodesh's archive wants and could not get: a
 * hanacha whose Drive link is gone, a recording JEM's CDN lost; whoever
 * has one can add it on its item's page.
 *
 * The year is chosen as a search token (`שנה:תשמ״ה`), as every list on
 * the site is filtered, or from the years beside the list, each with how
 * many of its farbrengens still lack what this tab is about.
 */

const KINDS = ['recordings', 'texts', 'scans', 'files'] as const;
type Kind = (typeof KINDS)[number];
const FIRST_YEAR = 5710;
const LAST_YEAR = 5752;
/** Rows a page, and how deep the pages go (the API lists up to 500 at a time). */
const PAGE = 50;
const DEEPEST = 500;
const YEARS = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);

/** The search line's one filter: a year, written in Hebrew letters or digits. */
function yearKey(lang: Lang): TokenKey {
  return {
    key: 'year',
    he: 'שנה',
    en: 'year',
    values: [...YEARS].reverse().map((y) => ({ value: String(y), he: yearLabel(y, 'he'), en: String(y) })),
    hint: { he: 'שנה עברית: תשמ״ה או 5745', en: 'A Hebrew year: 5745' },
  };
}

/** A year from the search line or the address (?year=5745), in digits. */
function yearFrom(url: URL): string | undefined {
  const plain = url.searchParams.get('year') ?? '';
  if (/^\d{4}$/.test(plain)) return plain;
  const parsed = parseTokens(url.searchParams.get('q'), [yearKey('he')]).filters.year?.[0];
  return parsed && /^\d{4}$/.test(parsed) ? parsed : undefined;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const url = new URL(request.url);
  const kind: Kind = (KINDS as readonly string[]).includes(url.searchParams.get('kind') ?? '') ? (url.searchParams.get('kind') as Kind) : 'recordings';
  const year = yearFrom(url);
  const byYear = kind === 'recordings' || kind === 'texts';
  const within = byYear ? year : undefined;
  const page = Math.min(Math.max(1, Number(url.searchParams.get('page')) || 1), DEEPEST / PAGE);
  const limit = page * PAGE;
  // The list itself, each tab's count (the year's, where a tab has years), and each year's gaps from the health of the catalog.
  const [missing, files, counts, health] = await Promise.all([
    kind === 'files' ? Promise.resolve({ kind, total: 0, items: [] as Entity[] }) : api.missing(kind, { within, limit }),
    kind === 'files' ? api.missingFiles({ limit }) : Promise.resolve(null),
    Promise.all(
      KINDS.map((k) =>
        k === 'files'
          ? api.missingFiles({ limit: 1 }).then((r) => r.total, () => null)
          : api.missing(k, { within: k === 'scans' ? undefined : year, limit: 1 }).then((r) => r.total, () => null),
      ),
    ),
    byYear ? api.health().catch(() => null) : Promise.resolve(null),
  ]);
  const years = (health?.years ?? []).map((y: CatalogHealth['years'][number]) => ({ year: y.year, events: y.events, missing: y.events - (kind === 'texts' ? y.withText : y.withRecording) }));
  const from = (page - 1) * PAGE;
  if (files) files.items = files.items.slice(from);
  missing.items = missing.items.slice(from);
  return { lang, siteUrl, kind, year, page, missing, files, counts: Object.fromEntries(KINDS.map((k, i) => [k, counts[i]])) as Record<Kind, number | null>, years, q: url.searchParams.get('q') ?? '' };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: t(loaderData.lang, 'missingTitle'), description: t(loaderData.lang, 'missingIntro'), path: '/missing', lang: loaderData.lang, siteUrl: loaderData.siteUrl });
}

const W = {
  byYear: { he: 'לפי שנה', en: 'By year' },
  allYears: { he: 'כל השנים', en: 'All years' },
  ofYear: { he: 'בשנת', en: 'in' },
  search: { he: 'סינון לפי שנה', en: 'Filter by year' },
  hint: { he: 'למשל: שנה:תשמ״ה', en: 'For example: year:5745' },
  howTitle: { he: 'איך עוזרים', en: 'How to help' },
  projects: { he: 'פרויקטים', en: 'Projects' },
  projectsLine: { he: 'לעבוד יחד על שנה שלמה, פריט אחרי פריט.', en: 'Work through a whole year together, one item at a time.' },
  health: { he: 'מצב הקטלוג', en: 'Health of the catalog' },
  healthLine: { he: 'כמה מלא הקטלוג, שנה אחרי שנה.', en: 'How full the catalog is, year by year.' },
  nothing: { he: 'לא חסר כאן כלום.', en: 'Nothing is missing here.' },
  nothingYear: { he: 'בשנה הזאת לא חסר כלום.', en: 'Nothing is missing in this year.' },
  nothingFiles: { he: 'הארכיון קיבל כל קובץ שחיפש.', en: 'The archive got every file it looked for.' },
  pickYear: { he: 'מוצגים 500 הראשונים; בחרו שנה כדי לראות את כולם.', en: 'The first 500 are shown; pick a year to see them all.' },
  deeper: { he: 'מוצגים 500 הראשונים.', en: 'The first 500 are shown.' },
  lastTried: { he: 'נבדק', en: 'tried' },
  noAnswer: { he: 'לא ענה', en: 'no answer' },
  unresolved: { he: 'לא נמצא', en: 'not found' },
  noItem: { he: 'אין לו עדיין דף בקטלוג', en: 'no page in the catalog yet' },
  clear: { he: 'ניקוי השנה', en: 'Clear the year' },
  tabs: { he: 'מה חסר', en: 'What is missing' },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

const TAB_ICON: Record<Kind, IconName> = { recordings: 'audio', texts: 'scan', scans: 'book', files: 'link' };

/** Why a file could not be fetched, as a label: its HTTP status, or "no answer". */
function GapStatus({ gap, lang }: { gap: ArchiveGap; lang: Lang }) {
  if (gap.http_status) return <Label tone="scan" size="sm">{`HTTP ${gap.http_status}`}</Label>;
  return (
    <Label tone="meta" size="sm">
      {gap.status === 'error' ? w(lang, 'noAnswer') : w(lang, 'unresolved')}
    </Label>
  );
}

function FileRows({ gaps, lang }: { gaps: ArchiveGap[]; lang: Lang }) {
  return (
    <ul>
      {gaps.map((g) => {
        const date = g.hebrew_date && /^\d{4}-/.test(g.hebrew_date) ? dateLabel(g.hebrew_date, lang, { civil: false }) : null;
        return (
          <li key={`${g.collection}/${g.item_id}/${g.kind}/${g.role}/${g.url}`} className="ms-file">
            <Icon name={g.kind === 'audio' ? 'audio' : 'file'} className="subtle" />
            <div className="pj-main">
              <div className="pj-title-line">
                {g.entity ? (
                  <Link className="pj-item-title" to={href(itemPath(g.entity), lang)}>
                    {labelOf(g.entity, lang)}
                  </Link>
                ) : (
                  <span className="pj-item-title">{g.label ?? g.item_id}</span>
                )}
                <GapStatus gap={g} lang={lang} />
              </div>
              <div className="pj-sub">
                {[date, t(lang, g.kind === 'audio' ? 'missingFile_audio' : 'missingFile_text'), g.label && g.entity ? g.label : null, g.entity ? null : w(lang, 'noItem')]
                  .filter(Boolean)
                  .map((part, i) => (
                    <span key={i}>
                      {i ? <span aria-hidden="true">· </span> : null}
                      {part}
                    </span>
                  ))}
                {g.checked_at ? (
                  <span>
                    <span aria-hidden="true">· </span>
                    {w(lang, 'lastTried')} <RelativeTime at={g.checked_at} lang={lang} />
                  </span>
                ) : null}
              </div>
            </div>
            <a className="btn sm ghost ms-where" href={g.url} target="_blank" rel="noopener nofollow" title={g.url}>
              <Icon name="external" size={14} />
              {t(lang, 'missingFileWhere')}
            </a>
          </li>
        );
      })}
    </ul>
  );
}

export default function Missing({ loaderData }: Route.ComponentProps) {
  const { lang, kind, year, page, missing, files, counts, years, q } = loaderData;
  const byYear = kind === 'recordings' || kind === 'texts';
  const tab = (k: Kind) => href('/missing', lang, { kind: k === 'recordings' ? undefined : k, year: (k === 'recordings' || k === 'texts') && year ? year : undefined });
  const allYears = href('/missing', lang, { kind: kind === 'recordings' ? undefined : kind });
  const total = files ? files.total : missing.total;
  const shown = files ? files.items.length : missing.items.length;
  const pages = Math.max(1, Math.ceil(Math.min(total, DEEPEST) / PAGE));
  const key = yearKey(lang);
  const line = q || (year ? `${lang === 'he' ? key.he : key.en}:${lang === 'he' ? yearLabel(Number(year), 'he') : year}` : '');
  const heading = `${t(lang, `missingHead_${kind}`)}${byYear && year ? ` ${w(lang, 'ofYear')} ${yearLabel(Number(year), lang)}` : ''}`;
  const maxMissing = Math.max(1, ...years.map((y) => y.missing));

  return (
    <>
      <div className="phead">
        <div className="wrap">
          <div className="phead-row">
            <div>
              <h1 className="page-title">{t(lang, 'missingTitle')}</h1>
              <p className="lede">{t(lang, 'missingIntro')}</p>
            </div>
            <div className="phead-acts">
              <Link className="btn" to={href('/projects', lang)}>
                <Icon name="layers" />
                {w(lang, 'projects')}
              </Link>
              <Link className="btn" to={href('/health', lang)}>
                <Icon name="pulse" />
                {w(lang, 'health')}
              </Link>
            </div>
          </div>
          <Tabs
            label={w(lang, 'tabs')}
            current={kind}
            items={KINDS.map((k) => ({ key: k, label: t(lang, `missing_${k}`), icon: TAB_ICON[k], to: tab(k), count: counts[k] === null ? null : capped(counts[k]!, lang) }))}
          />
        </div>
      </div>

      <div className={'wrap cols pj-cols'}>
        <div className="stack">
          {byYear ? (
            <TokenSearch
              lang={lang}
              keys={[key]}
              defaultValue={line}
              hidden={{ kind: kind === 'recordings' ? undefined : kind }}
              label={w(lang, 'search')}
              placeholder={w(lang, 'hint')}
              after={
                year ? (
                  <Link className="btn ms-clear" to={allYears} aria-label={w(lang, 'clear')}>
                    <Icon name="x" />
                    <span className="ms-clear-t">{w(lang, 'clear')}</span>
                  </Link>
                ) : null
              }
            />
          ) : null}

          <Box
            className="ms-list"
            header={
              <>
                <Icon name={TAB_ICON[kind]} className="subtle" />
                <span>{heading}</span>
                <span className="end num muted">{capped(total, lang)}</span>
              </>
            }
            footer={
              <>
                <Icon name="info" className="subtle" />
                <span className="muted">{t(lang, `missingHow_${kind}`)}</span>
              </>
            }
          >
            {shown === 0 ? (
              <EmptyState compact icon="check" title={kind === 'files' ? w(lang, 'nothingFiles') : year && byYear ? w(lang, 'nothingYear') : w(lang, 'nothing')} />
            ) : files ? (
              <FileRows gaps={files.items} lang={lang} />
            ) : kind === 'scans' ? (
              <ul>
                {missing.items.map((item) => (
                  <li key={item.id}>
                    <Link className="row hover" to={href(itemPath(item), lang)}>
                      <Icon name="book" />
                      <span className="row-main">
                        <span className="row-title torah">{labelOf(item, lang)}</span>
                      </span>
                      <Icon name="chev" className="flip-ltr subtle" size={14} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <ul>
                {(missing.items as EventItem[]).map((e) => (
                  <li key={e.id}>
                    <EventRow event={e} lang={lang} />
                  </li>
                ))}
              </ul>
            )}
          </Box>
          <Pagination page={page} pages={pages} lang={lang} hrefOf={(n) => href('/missing', lang, { kind: kind === 'recordings' ? undefined : kind, year: byYear ? year : undefined, page: n > 1 ? String(n) : undefined })} />
          {total > DEEPEST && page === pages ? <p className="subtle small ms-more">{byYear && !year ? w(lang, 'pickYear') : w(lang, 'deeper')}</p> : null}
        </div>

        <aside className="side" aria-label={byYear ? w(lang, 'byYear') : w(lang, 'howTitle')}>
          {byYear && years.length ? (
            <section>
              <h2>
                {w(lang, 'byYear')}
                {year ? <Link to={allYears}>{w(lang, 'allYears')}</Link> : null}
              </h2>
              <nav className="ms-years" aria-label={w(lang, 'byYear')}>
                {[...years].reverse().map((y) => (
                  <Link
                    key={y.year}
                    to={href('/missing', lang, { kind: kind === 'recordings' ? undefined : kind, year: String(y.year) })}
                    aria-current={year === String(y.year) ? 'page' : undefined}
                    className={cx(y.missing === 0 && 'full')}
                    preventScrollReset
                  >
                    <span className="y">{yearLabel(y.year, lang)}</span>
                    <span className="ms-meter" aria-hidden="true">
                      <i style={{ width: `${(y.missing / maxMissing) * 100}%` }} />
                    </span>
                    <span className="num">{num(y.missing, lang)}</span>
                  </Link>
                ))}
              </nav>
            </section>
          ) : null}
          <section>
            <ul className="side-list ms-links">
              <li>
                <Icon name="layers" className="subtle" />
                <span className="grow">
                  <Link to={href('/projects', lang)}>{w(lang, 'projects')}</Link>
                  <span className="subtle small">{w(lang, 'projectsLine')}</span>
                </span>
              </li>
              <li>
                <Icon name="pulse" className="subtle" />
                <span className="grow">
                  <Link to={href('/health', lang)}>{tn(lang, 'healthTitle')}</Link>
                  <span className="subtle small">{w(lang, 'healthLine')}</span>
                </span>
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </>
  );
}
