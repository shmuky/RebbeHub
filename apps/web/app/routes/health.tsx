import { Link } from 'react-router';
import type { Route } from './+types/health';
import type { CatalogHealth, Entity } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { yearLabel } from '../lib/dates.js';
import { langFrom, nameOf, t, typeName, type Lang } from '../lib/i18n.js';
import { tn } from '../lib/i18nNetwork.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';

/**
 * The health of the catalog (the plan, section 9: "Health dashboards:
 * coverage per set and year, dead links, unchecked pages, unsynced
 * recordings, oldest open suggestions"): where the catalog is full, and
 * where help is needed, in plain tables and lists. Beside the Missing
 * board, which lists the gaps themselves.
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
  return pageMeta({ title: tn(loaderData.lang, 'healthTitle'), path: '/health', lang: loaderData.lang, siteUrl: loaderData.siteUrl });
}

const num = (n: number, lang: Lang) => n.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US');
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '–');
const day = (iso: string | null, lang: Lang) => (iso ? new Date(iso).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function Years({ years, lang }: { years: CatalogHealth['years']; lang: Lang }) {
  const total = years.reduce((s, y) => ({ events: s.events + y.events, withRecording: s.withRecording + y.withRecording, withText: s.withText + y.withText, withTranscript: s.withTranscript + y.withTranscript }), { events: 0, withRecording: 0, withText: 0, withTranscript: 0 });
  const cells = (y: typeof total) => (
    <>
      <td>{num(y.events, lang)}</td>
      <td>
        {num(y.withRecording, lang)} <span className="row-sub">{pct(y.withRecording, y.events)}</span>
      </td>
      <td>
        {num(y.withText, lang)} <span className="row-sub">{pct(y.withText, y.events)}</span>
      </td>
      <td>
        {num(y.withTranscript, lang)} <span className="row-sub">{pct(y.withTranscript, y.events)}</span>
      </td>
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

export default function Health({ loaderData }: Route.ComponentProps) {
  const { lang, health, refs } = loaderData;
  const itemLink = (id: string) => {
    const item: Entity | undefined = refs[id];
    return <Link to={href(item ? itemPath(item) : `/${id}`, lang)}>{item ? labelOf(item, lang) : id}</Link>;
  };
  return (
    <>
      <h1>{tn(lang, 'healthTitle')}</h1>
      <p className="subtitle">{tn(lang, 'healthIntro')}</p>

      <section>
        <h2 className="section-header">{tn(lang, 'healthYears')}</h2>
        {health.years.length ? <Years years={health.years} lang={lang} /> : <p className="row-sub">{tn(lang, 'healthNothing')}</p>}
        <p>
          <Link to={href('/missing', lang)}>{t(lang, 'missingTitle')}</Link>
        </p>
      </section>

      <section>
        <h2 className="section-header">{tn(lang, 'healthSets')}</h2>
        <ul className="list">
          {health.sets.map((s) => (
            <li key={s.id}>
              <Link to={href(s.path ?? `/${s.id}`, lang)}>
                <span>{nameOf(s.name, lang) || s.id}</span>
                <span className="meta">
                  {num(s.items, lang)} {tn(lang, 'healthItems')}
                  {Object.keys(s.byType).length > 1
                    ? ` · ${Object.entries(s.byType)
                        .sort((a, b) => b[1] - a[1])
                        .map(([type, n]) => `${typeName(type, lang)} ${num(n, lang)}`)
                        .join(', ')}`
                    : ''}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="section-header">
          <span>{tn(lang, 'healthPages')}</span>
          <span>{num(health.pages.total - health.pages.checked, lang)}</span>
        </h2>
        <p className="row-sub">
          {tn(lang, 'healthPagesLine')} {num(health.pages.total, lang)}; {num(health.pages.checked, lang)} ({pct(health.pages.checked, health.pages.total)})
        </p>
        <ul className="list">
          {health.uncheckedScans.map((s) => (
            <li key={s.scan}>
              <Link to={href(`/text/${s.scan}`, lang)}>
                <span>{nameOf(s.title, lang) || s.scan}</span>
                <span className="meta">
                  {num(s.pages - s.checked, lang)} / {num(s.pages, lang)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="section-header">
          <span>{tn(lang, 'healthRecordings')}</span>
          <span>{num(health.recordings.total - health.recordings.synced, lang)}</span>
        </h2>
        <p className="row-sub">
          {tn(lang, 'healthRecordingsLine')} {num(health.recordings.total, lang)}; {num(health.recordings.transcribed, lang)}; {num(health.recordings.synced, lang)} ({pct(health.recordings.synced, health.recordings.total)})
        </p>
        <ul className="list">
          {health.unsynced.map((r) => (
            <li key={r.id}>
              <Link to={href(r.event && refs[r.event] ? itemPath(refs[r.event]!) : (r.path ?? `/${r.id}`), lang)}>
                <span>{r.event && refs[r.event] ? labelOf(refs[r.event]!, lang) : nameOf(r.title, lang) || r.id}</span>
                <span className="meta">{nameOf(r.title, lang)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="section-header">
          <span>{tn(lang, 'healthLinks')}</span>
          <span>{num(health.links.dead, lang)}</span>
        </h2>
        {health.links.checked ? (
          <p className="row-sub">
            {tn(lang, 'healthLinksLine')} {num(health.links.checked, lang)}; {num(health.links.dead, lang)} · {tn(lang, 'healthLastChecked')} {day(health.links.lastChecked, lang)}
          </p>
        ) : (
          <p className="row-sub">{tn(lang, 'healthLinksNever')}</p>
        )}
        <ul className="rows dead-links">
          {health.deadLinks.map((d) => (
            <li key={d.url} className="row">
              <div className="row-main">
                <a className="row-title" href={d.url} rel="noopener nofollow" target="_blank" dir="ltr">
                  {d.url}
                </a>
                <span className="row-sub">
                  {d.status ?? d.error} · {tn(lang, 'healthFailingSince')} {day(d.failingSince, lang)}
                  {d.entities.length ? ' · ' : ''}
                  {d.entities.slice(0, 5).map((id, i) => (
                    <span key={id}>
                      {i ? ', ' : ''}
                      {itemLink(id)}
                    </span>
                  ))}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="section-header">
          <span>{tn(lang, 'healthSuggestions')}</span>
          <span>{num(health.openSuggestions.length, lang)}</span>
        </h2>
        {health.openSuggestions.length ? (
          <ul className="list">
            {health.openSuggestions.map((s) => (
              <li key={s.id}>
                <Link to={`${href('/review', lang)}#s${s.id}`}>
                  <span dir="auto">{s.title}</span>
                  <span className="meta">
                    {s.authorName}
                    {s.authorIsBot ? ` (${tn(lang, 'bot')})` : ''} · {tn(lang, 'healthWaitingSince')} {day(s.submittedAt, lang)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="row-sub">{tn(lang, 'healthNoSuggestions')}</p>
        )}
      </section>

      {health.embeddings.embedded || health.embeddings.waiting ? (
        <section>
          <h2 className="section-header">{tn(lang, 'healthMeaning')}</h2>
          <p className="row-sub">
            {tn(lang, 'healthMeaningLine')} {num(health.embeddings.embedded, lang)}; {num(health.embeddings.waiting, lang)}
          </p>
        </section>
      ) : null}
    </>
  );
}
