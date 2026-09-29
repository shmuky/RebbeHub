import { Link } from 'react-router';
import type { Route } from './+types/health';
import type { CatalogHealth, Entity } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { yearLabel } from '../lib/dates.js';
import { langFrom, nameOf, t, typeName, type Lang } from '../lib/i18n.js';
import { tn } from '../lib/i18nNetwork.js';
import { num } from '../lib/i18nUi.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { Avatar, Box, EmptyState, Label, RelativeTime } from '../ui/primitives.js';
import '../styles/pages/projects.css';

/**
 * The health of the catalog (the plan, section 9: "Health dashboards:
 * coverage per set and year, dead links, unchecked pages, unsynced
 * recordings, oldest open suggestions"): where the catalog is full, and
 * where help is needed, in plain tables and lines, as a printed report
 * would have them. Beside the Missing board, which lists the gaps
 * themselves.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const health = await api.health();
  const named = [...health.deadLinks.flatMap((d) => d.entities), ...health.unsynced.flatMap((r) => (r.event ? [r.event] : []))];
  const refs = Object.fromEntries(await api.entities(named));
  return { lang, siteUrl, health, refs };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: tn(loaderData.lang, 'healthTitle'), description: tn(loaderData.lang, 'healthIntro'), path: '/health', lang: loaderData.lang, siteUrl: loaderData.siteUrl });
}

const W = {
  onPage: { he: 'בדף הזה', en: 'On this page' },
  inShort: { he: 'בקיצור', en: 'In short' },
  set: { he: 'סט', en: 'Set' },
  items: { he: 'פריטים', en: 'Items' },
  kinds: { he: 'מה יש בו', en: 'What it holds' },
  pagesLine: { he: 'עמודי סריקות שנקראו במכונה: {a}. מהם נבדקו בידי אדם: {b} ({p}).', en: 'Pages of scans read by a machine: {a}. Checked by a person: {b} ({p}).' },
  recordingsLine: { he: 'הקלטות: {a}. עם תמלול: {b}. מסונכרנות ונבדקו: {c} ({p}).', en: 'Recordings: {a}. With a transcript: {b}. Synced and checked: {c} ({p}).' },
  linksLine: { he: 'קישורים שנבדקו: {a}. אינם עונים: {b}. נבדקו לאחרונה {when}.', en: 'Links checked: {a}. Not answering: {b}. Last checked {when}.' },
  meaningLine: { he: 'פריטים שכבר נקראו לחיפוש לפי רעיון: {a}. מחכים: {b}.', en: 'Items read for search by idea: {a}. Waiting: {b}.' },
  pagesShort: { he: 'מהעמודים נבדקו בידי אדם', en: 'of pages checked by a person' },
  recShort: { he: 'מההקלטות מסונכרנות', en: 'of recordings synced' },
  withRecShort: { he: 'מההתוועדויות עם הקלטה', en: 'of farbrengens have a recording' },
  withTextShort: { he: 'מההתוועדויות עם טקסט', en: 'of farbrengens have a text' },
  of: { he: 'מתוך', en: 'of' },
  unchecked: { he: 'לא נבדקו', en: 'unchecked' },
  noPages: { he: 'כל העמודים שנקראו במכונה נבדקו.', en: 'Every page a machine read has been checked.' },
  noUnsynced: { he: 'כל ההקלטות עם תמלול מסונכרנות.', en: 'Every recording with a transcript is synced.' },
  noDead: { he: 'כל הקישורים עונים.', en: 'Every link answers.' },
  openScan: { he: 'להגהה', en: 'Proofread' },
  sync: { he: 'לסנכרון', en: 'Sync' },
  missing: { he: 'לוח החוסרים', en: 'The Missing board' },
  projects: { he: 'פרויקטים', en: 'Projects' },
  bot: { he: 'בוט', en: 'bot' },
  showAll: { he: 'הצגת הכל', en: 'Show all' },
  showFewer: { he: 'הצגת פחות', en: 'Show fewer' },
  allSuggestions: { he: 'כל ההצעות', en: 'All suggestions' },
  total: { he: 'סך הכל', en: 'Total' },
  more: { he: 'ועוד', en: 'and' },
  others: { he: 'נוספים', en: 'more' },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

/** A line with its numbers put in: `{a}` and the like. */
const fill = (text: string, values: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');

const SECTIONS: Array<{ id: string; icon: IconName; title: (lang: Lang) => string }> = [
  { id: 'years', icon: 'cal', title: (lang) => tn(lang, 'healthYears') },
  { id: 'sets', icon: 'book', title: (lang) => tn(lang, 'healthSets') },
  { id: 'pages', icon: 'scan', title: (lang) => tn(lang, 'healthPages') },
  { id: 'recordings', icon: 'audio', title: (lang) => tn(lang, 'healthRecordings') },
  { id: 'links', icon: 'link', title: (lang) => tn(lang, 'healthLinks') },
  { id: 'suggestions', icon: 'suggest', title: (lang) => tn(lang, 'healthSuggestions') },
];

function Years({ years, lang }: { years: CatalogHealth['years']; lang: Lang }) {
  const total = years.reduce((s, y) => ({ events: s.events + y.events, withRecording: s.withRecording + y.withRecording, withText: s.withText + y.withText, withTranscript: s.withTranscript + y.withTranscript }), { events: 0, withRecording: 0, withText: 0, withTranscript: 0 });
  const cells = (y: typeof total) => (
    <>
      <td className="num">{num(y.events, lang)}</td>
      {[y.withRecording, y.withText, y.withTranscript].map((n, i) => (
        <td key={i} className="num">
          {num(n, lang)} <span className="subtle">{pct(n, y.events)}</span>
        </td>
      ))}
    </>
  );
  return (
    <div className="table-scroll">
      <table className="health-table">
        <thead>
          <tr>
            <th scope="col">{tn(lang, 'healthYear')}</th>
            <th scope="col">{tn(lang, 'healthEvents')}</th>
            <th scope="col">{tn(lang, 'healthWithRecording')}</th>
            <th scope="col">{tn(lang, 'healthWithText')}</th>
            <th scope="col">{tn(lang, 'healthWithTranscript')}</th>
          </tr>
        </thead>
        <tbody>
          {years.map((y) => (
            <tr key={y.year}>
              <th scope="row">
                <Link to={href(`/calendar/${y.year}`, lang)}>{yearLabel(y.year, lang)}</Link>
              </th>
              {cells(y)}
            </tr>
          ))}
        </tbody>
        {years.length > 1 ? (
          <tfoot>
            <tr>
              <th scope="row">{t(lang, 'allYears')}</th>
              {cells(total)}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

/** Rows past the first ten are folded away until asked for (styles/pages/projects.css), without script. */
const FOLD = 10;

function More({ n, lang }: { n: number; lang: Lang }) {
  if (n <= FOLD) return null;
  return (
    <details className="hl-more">
      <summary>
        <span className="closed-label">
          {w(lang, 'showAll')} ({num(n, lang)})
        </span>
        <span className="open-label">{w(lang, 'showFewer')}</span>
        <Icon name="chevd" size={14} />
      </summary>
    </details>
  );
}

function SectionHead({ id, lang, count, link }: { id: string; lang: Lang; count?: number; link?: { to: string; label: string } }) {
  const s = SECTIONS.find((x) => x.id === id)!;
  return (
    <h2 className="h-block" id={id}>
      <Icon name={s.icon} className="subtle" />
      {s.title(lang)}
      {count !== undefined ? <span className="count">{num(count, lang)}</span> : null}
      {link ? <Link to={link.to}>{link.label}</Link> : null}
    </h2>
  );
}

export default function Health({ loaderData }: Route.ComponentProps) {
  const { lang, health, refs } = loaderData;
  const itemLink = (id: string) => {
    const item: Entity | undefined = refs[id];
    return <Link to={href(item ? itemPath(item) : `/${id}`, lang)}>{item ? labelOf(item, lang) : id}</Link>;
  };
  const events = health.years.reduce((s, y) => s + y.events, 0);
  const withRecording = health.years.reduce((s, y) => s + y.withRecording, 0);
  const withText = health.years.reduce((s, y) => s + y.withText, 0);
  const unchecked = health.pages.total - health.pages.checked;
  const unsynced = health.recordings.total - health.recordings.synced;
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

  return (
    <>
      <div className="phead flat">
        <div className="wrap">
          <div className="phead-row">
            <div>
              <h1 className="page-title">{tn(lang, 'healthTitle')}</h1>
              <p className="lede">{tn(lang, 'healthIntro')}</p>
            </div>
            <div className="phead-acts">
              <Link className="btn" to={href('/missing', lang)}>
                <Icon name="target" />
                {w(lang, 'missing')}
              </Link>
              <Link className="btn" to={href('/projects', lang)}>
                <Icon name="layers" />
                {w(lang, 'projects')}
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="wrap cols hl-cols">
        <div className="hl-main">
          <section aria-labelledby="years">
            <SectionHead id="years" lang={lang} link={{ to: href('/missing', lang), label: w(lang, 'missing') }} />
            {health.years.length ? <Years years={health.years} lang={lang} /> : <p className="subtle">{tn(lang, 'healthNothing')}</p>}
          </section>

          <section aria-labelledby="sets">
            <SectionHead id="sets" lang={lang} count={health.sets.length} />
            <div className="table-scroll">
              <table className="health-table hl-sets">
                <thead>
                  <tr>
                    <th scope="col">{w(lang, 'set')}</th>
                    <th scope="col">{w(lang, 'items')}</th>
                    <th scope="col">{w(lang, 'kinds')}</th>
                  </tr>
                </thead>
                <tbody>
                  {health.sets.map((s) => (
                    <tr key={s.id}>
                      <th scope="row">
                        <Link to={href(s.path ?? `/${s.id}`, lang)}>{nameOf(s.name, lang) || s.id}</Link>
                      </th>
                      <td className="num">{num(s.items, lang)}</td>
                      <td className="subtle">
                        {Object.entries(s.byType)
                          .sort((a, b) => b[1] - a[1])
                          .map(([type, n]) => `${typeName(type, lang)} ${num(n, lang)}`)
                          .join(' · ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="pages">
            <SectionHead id="pages" lang={lang} count={unchecked} />
            <p className="hl-line">{fill(w(lang, 'pagesLine'), { a: num(health.pages.total, lang), b: num(health.pages.checked, lang), p: pct(health.pages.checked, health.pages.total) })}</p>
            <Box footer={health.uncheckedScans.length > FOLD ? <More n={health.uncheckedScans.length} lang={lang} /> : undefined}>
              {health.uncheckedScans.length ? (
                <ul className="hl-long">
                  {health.uncheckedScans.map((s) => (
                    <li key={s.scan}>
                      <Link className="row hover" to={href(`/text/${s.scan}`, lang)}>
                        <Icon name="scan" />
                        <span className="row-main">
                          <span className="row-title">{nameOf(s.title, lang) || s.scan}</span>
                          <span className="row-sub">
                            {num(s.pages - s.checked, lang)} {w(lang, 'unchecked')} · {num(s.pages, lang)} {t(lang, 'page')}
                          </span>
                        </span>
                        <span className="num">{pct(s.checked, s.pages)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState compact icon="check" title={w(lang, 'noPages')} />
              )}
            </Box>
          </section>

          <section aria-labelledby="recordings">
            <SectionHead id="recordings" lang={lang} count={unsynced} />
            <p className="hl-line">
              {fill(w(lang, 'recordingsLine'), { a: num(health.recordings.total, lang), b: num(health.recordings.transcribed, lang), c: num(health.recordings.synced, lang), p: pct(health.recordings.synced, health.recordings.total) })}
            </p>
            <Box footer={health.unsynced.length > FOLD ? <More n={health.unsynced.length} lang={lang} /> : undefined}>
              {health.unsynced.length ? (
                <ul className="hl-long">
                  {health.unsynced.map((r) => {
                    const event = r.event ? refs[r.event] : undefined;
                    return (
                      <li key={r.id}>
                        <Link className="row hover" to={event ? `${href(itemPath(event), lang)}#transcript` : href(r.path ?? `/${r.id}`, lang)}>
                          <Icon name="audio" />
                          <span className="row-main">
                            <span className="row-title">{event ? labelOf(event, lang) : nameOf(r.title, lang) || r.id}</span>
                            {event && nameOf(r.title, lang) ? <span className="row-sub">{nameOf(r.title, lang)}</span> : null}
                          </span>
                          <span className="subtle small">{w(lang, 'sync')}</span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState compact icon="check" title={w(lang, 'noUnsynced')} />
              )}
            </Box>
          </section>

          <section aria-labelledby="links">
            <SectionHead id="links" lang={lang} count={health.links.dead} />
            <p className="hl-line">
              {health.links.checked ? fill(w(lang, 'linksLine'), { a: num(health.links.checked, lang), b: num(health.links.dead, lang), when: day(health.links.lastChecked) }) : tn(lang, 'healthLinksNever')}
            </p>
            {health.links.checked ? (
              <Box footer={health.deadLinks.length > FOLD ? <More n={health.deadLinks.length} lang={lang} /> : undefined}>
                {health.deadLinks.length ? (
                  <ul className="dead-links hl-long">
                    {health.deadLinks.map((d) => (
                      <li key={d.url} className="row">
                        <Icon name="link" />
                        <div className="row-main">
                          <a className="row-title hl-url" href={d.url} rel="noopener nofollow" target="_blank" dir="ltr">
                            {d.url}
                          </a>
                          <span className="row-sub">
                            {tn(lang, 'healthFailingSince')} {day(d.failingSince)}
                            {d.entities.length ? ' · ' : ''}
                            {d.entities.slice(0, 5).map((id, i) => (
                              <span key={id}>
                                {i ? ', ' : ''}
                                {itemLink(id)}
                              </span>
                            ))}
                            {d.entities.length > 5 ? ` ${w(lang, 'more')} ${num(d.entities.length - 5, lang)} ${w(lang, 'others')}` : ''}
                          </span>
                        </div>
                        <Label tone="scan" size="sm">
                          {d.status ? `HTTP ${d.status}` : (d.error ?? '–')}
                        </Label>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState compact icon="check" title={w(lang, 'noDead')} />
                )}
              </Box>
            ) : null}
          </section>

          <section aria-labelledby="suggestions">
            <SectionHead id="suggestions" lang={lang} count={health.openSuggestions.length} link={{ to: href('/suggestions', lang), label: w(lang, 'allSuggestions') }} />
            <Box footer={health.openSuggestions.length > FOLD ? <More n={health.openSuggestions.length} lang={lang} /> : undefined}>
              {health.openSuggestions.length ? (
                <ul className="hl-long">
                  {health.openSuggestions.map((s) => (
                    <li key={s.id}>
                      <Link className="row hover" to={`${href('/review', lang)}#s${s.id}`}>
                        <Avatar name={s.authorName} id={s.author} size="sm" bot={s.authorIsBot} />
                        <span className="row-main">
                          <span className="row-title" dir="auto">
                            {s.title}
                          </span>
                          <span className="row-sub">
                            {s.authorName}
                            {s.authorIsBot ? ` (${w(lang, 'bot')})` : ''} · {tn(lang, 'healthWaitingSince')} <RelativeTime at={s.submittedAt} lang={lang} />
                          </span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState compact icon="check" title={tn(lang, 'healthNoSuggestions')} />
              )}
            </Box>
          </section>

          {health.embeddings.embedded || health.embeddings.waiting ? (
            <section aria-labelledby="meaning">
              <h2 className="h-block" id="meaning">
                <Icon name="sparkle" className="subtle" />
                {tn(lang, 'healthMeaning')}
              </h2>
              <p className="hl-line">{fill(w(lang, 'meaningLine'), { a: num(health.embeddings.embedded, lang), b: num(health.embeddings.waiting, lang) })}</p>
            </section>
          ) : null}
        </div>

        <aside className="side hl-side" aria-label={w(lang, 'onPage')}>
          <section>
            <h2>{w(lang, 'inShort')}</h2>
            <ul className="hl-short">
              {events ? (
                <>
                  <li>
                    <b>{pct(withRecording, events)}</b> {w(lang, 'withRecShort')} <span className="subtle">({num(withRecording, lang)} {w(lang, 'of')} {num(events, lang)})</span>
                  </li>
                  <li>
                    <b>{pct(withText, events)}</b> {w(lang, 'withTextShort')} <span className="subtle">({num(withText, lang)} {w(lang, 'of')} {num(events, lang)})</span>
                  </li>
                </>
              ) : null}
              {health.pages.total ? (
                <li>
                  <b>{pct(health.pages.checked, health.pages.total)}</b> {w(lang, 'pagesShort')}
                </li>
              ) : null}
              {health.recordings.total ? (
                <li>
                  <b>{pct(health.recordings.synced, health.recordings.total)}</b> {w(lang, 'recShort')}
                </li>
              ) : null}
            </ul>
          </section>
          <section className="hl-toc">
            <h2>{w(lang, 'onPage')}</h2>
            <nav aria-label={w(lang, 'onPage')}>
              {SECTIONS.map((s) => (
                <a key={s.id} href={`#${s.id}`}>
                  <Icon name={s.icon} className="subtle" />
                  {s.title(lang)}
                </a>
              ))}
            </nav>
          </section>
        </aside>
      </div>
    </>
  );
}
