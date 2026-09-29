import { Link } from 'react-router';
import type { Route } from './+types/status';
import type { CheckId, CheckState, StatusReport, WorkerLoad } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { Bar, Box, EmptyState, RelativeTime, cx } from '../ui/primitives.js';
import '../styles/pages/status.css';

/**
 * Whether RebbeHub is up: the site, the API, the MCP server, the database,
 * its daily allowance of queries, the Workers' load and the scheduled
 * jobs. The API checks
 * them every five minutes and keeps the last report with ninety days of
 * it (services/api/src/status.ts); this page reads that report, which
 * never asks the database, so it answers when the database does not. When
 * the API itself does not answer, the page says so from here.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const apiBase = /^https?:\/\//.test(api.baseUrl) ? api.baseUrl.replace(/\/+$/, '') : 'https://api.rebbehub.org';
  const lang = langFrom(request);
  const answer = await api.status().catch((error: unknown) => {
    console.error('status', error);
    return null;
  });
  return { lang, siteUrl, apiBase, now: answer?.now ?? new Date().toISOString(), report: answer?.report ?? null, apiAnswered: answer !== null };
}

export function headers({ parentHeaders }: Route.HeadersArgs) {
  // A minute, not the five every page is kept: this page is read when something is wrong.
  const headers = new Headers(parentHeaders);
  headers.set('Cache-Control', 'public, max-age=60, s-maxage=60');
  return headers;
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: w(loaderData.lang, 'title'), description: w(loaderData.lang, 'intro'), path: '/status', lang: loaderData.lang, siteUrl: loaderData.siteUrl });
}

const W = {
  title: { he: 'מצב האתר', en: 'Status' },
  intro: { he: 'האם האתר, ה-API, שרת ה-MCP ומסד הנתונים עונים. נבדק כל חמש דקות.', en: 'Whether the site, the API, the MCP server and the database are answering. Checked every five minutes.' },
  allUp: { he: 'הכל עובד', en: 'Everything is working' },
  someSlow: { he: 'חלק עובד באיטיות או חלקית', en: 'Some of it is slow or partly working' },
  someDown: { he: 'חלק אינו עובד כעת', en: 'Some of it is not working now' },
  noReport: { he: 'עוד לא נבדק', en: 'Not checked yet' },
  noReportLine: { he: 'הבדיקות רצות כל חמש דקות; התוצאה הראשונה תופיע כאן.', en: 'The checks run every five minutes; the first result will show here.' },
  apiDown: { he: 'ה-API אינו עונה', en: 'The API is not answering' },
  apiDownLine: { he: 'האתר עצמו עונה, אבל לא הצליח לקרוא מה-API את תוצאות הבדיקות. רוב הדפים תלויים בו.', en: 'The site itself answers, but could not read the checks from the API. Most pages depend on it.' },
  stale: { he: 'הבדיקות הפסיקו לרוץ', en: 'The checks have stopped running' },
  staleLine: { he: 'הבדיקה האחרונה הייתה {when}. מה שכתוב כאן אולי כבר אינו נכון.', en: 'The last check was {when}. What this page shows may no longer be true.' },
  checked: { he: 'נבדק', en: 'Checked' },
  now: { he: 'עכשיו', en: 'Now' },
  days: { he: '90 הימים האחרונים', en: 'The last 90 days' },
  uptime: { he: 'זמינות', en: 'uptime' },
  noData: { he: 'אין נתונים', en: 'No data' },
  quota: { he: 'שאילתות היום', en: "Today's queries" },
  quotaLine: { he: '{used} מתוך {limit} שאילתות למסד הנתונים היום. המונה מתאפס ב-00:00 UTC.', en: '{used} of {limit} database queries today. The count starts again at 00:00 UTC.' },
  quotaNoLimit: { he: '{used} שאילתות למסד הנתונים היום.', en: '{used} database queries today.' },
  runsOut: { he: 'בקצב של היום הן ייגמרו בערך ב-{at} UTC.', en: "At today's pace they run out at about {at} UTC." },
  workerLine: { he: '{n} בקשות היום · חצי מהן {p50} ms מעבד, האיטיות ביותר (1%) {p99} ms · {stopped} נעצרו על חריגה', en: '{n} requests today · half take {p50} ms of CPU, the slowest 1% {p99} ms · {stopped} stopped for taking too much' },
  workerNone: { he: 'עוד לא היו בקשות היום.', en: 'No requests yet today.' },
  incidents: { he: 'תקלות אחרונות', en: 'Recent incidents' },
  noIncidents: { he: 'לא היו תקלות ב-90 הימים האחרונים.', en: 'No incidents in the last 90 days.' },
  ongoing: { he: 'עדיין נמשכת', en: 'Ongoing' },
  lasted: { he: 'נמשכה {d}', en: 'Lasted {d}' },
  since: { he: 'מאז', en: 'Since' },
  forPrograms: { he: 'לתוכנות: אותו מידע ב-JSON, ב-', en: 'For programs: the same as JSON, at ' },
  healthLink: { he: 'מצב הקטלוג', en: 'Health of the catalog' },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang];
const fill = (text: string, values: Record<string, string>) => text.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? '');

const PARTS: Record<CheckId, { icon: IconName; name: Record<Lang, string>; about: Record<Lang, string> }> = {
  site: { icon: 'globe', name: { he: 'האתר', en: 'The site' }, about: { he: 'rebbehub.org', en: 'rebbehub.org' } },
  api: { icon: 'code', name: { he: 'ה-API', en: 'The API' }, about: { he: 'api.rebbehub.org, לתוכנות ולאפליקציה', en: 'api.rebbehub.org, for programs and the app' } },
  mcp: { icon: 'bot', name: { he: 'שרת ה-MCP', en: 'The MCP server' }, about: { he: 'לסוכני בינה מלאכותית (Claude ואחרים)', en: 'For AI agents (Claude and others)' } },
  database: { icon: 'database', name: { he: 'מסד הנתונים', en: 'The database' }, about: { he: 'הקטלוג עצמו', en: 'The catalog itself' } },
  quota: { icon: 'pulse', name: { he: 'מכסת השאילתות היומית', en: 'Daily query allowance' }, about: { he: 'כמה שאילתות למסד הנתונים מותרות ביום', en: 'How many database queries a day allows' } },
  workers: { icon: 'monitor', name: { he: 'העומס על השרתים', en: "The servers' load" }, about: { he: 'כמה מעבד לוקחת בקשה, וכמה נעצרו על חריגה', en: 'The CPU a request takes, and how many were stopped for taking too much' } },
  jobs: { icon: 'clock', name: { he: 'משימות מתוזמנות', en: 'Scheduled jobs' }, about: { he: 'Webhooks, עדכונים במייל, עצות לבודקים', en: "Webhooks, email updates, the reviewer's advice" } },
};
const ORDER: CheckId[] = ['site', 'api', 'mcp', 'database', 'quota', 'workers', 'jobs'];

const STATE_WORD: Record<CheckState, Record<Lang, string>> = {
  up: { he: 'עובד', en: 'Working' },
  degraded: { he: 'חלקית', en: 'Partly' },
  down: { he: 'לא עובד', en: 'Not working' },
  unknown: { he: 'לא נבדק', en: 'Not checked' },
};
const STATE_ICON: Record<CheckState, IconName> = { up: 'check', degraded: 'warn', down: 'x', unknown: 'dot' };

/** Checks older than this mean the scheduled run has stopped (it runs every five minutes). */
const STALE_MS = 20 * 60_000;

/** A day's colour: any time down is down, any time slow is degraded. */
function dayState(t: { runs: number; degraded: number; down: number } | undefined): CheckState {
  if (!t || !t.runs) return 'unknown';
  return t.down ? 'down' : t.degraded ? 'degraded' : 'up';
}

/** Of the runs kept, how many were not down, to a tenth of a percent (99.9%, never a rounded-up 100% with an outage in it). */
function uptime(report: StatusReport, id: CheckId): number | null {
  let runs = 0;
  let down = 0;
  for (const d of report.days) {
    runs += d.checks[id]?.runs ?? 0;
    down += d.checks[id]?.down ?? 0;
  }
  return runs ? Math.floor(((runs - down) / runs) * 1000) / 10 : null;
}

/** The last 90 dates up to `today`, oldest first. */
function lastDays(today: string): string[] {
  const end = Date.parse(`${today}T00:00:00Z`);
  return Array.from({ length: 90 }, (_, i) => new Date(end - (89 - i) * 86_400_000).toISOString().slice(0, 10));
}

function duration(ms: number, lang: Lang): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return lang === 'he' ? `${minutes} דק׳` : `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (lang === 'he') return rest ? `${hours} שע׳ ו-${rest} דק׳` : `${hours} שע׳`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

const utc = (iso: string, lang: Lang) => new Date(iso).toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';

function Overall({ state, lang, title, line }: { state: CheckState; lang: Lang; title: string; line?: React.ReactNode }) {
  return (
    <div className={cx('st-banner', state)} role="status">
      <Icon name={STATE_ICON[state]} size={22} />
      <div>
        <p className="st-banner-title">{title}</p>
        {line ? <p className="st-banner-line">{line}</p> : null}
      </div>
      <span className="visually-hidden">{STATE_WORD[state][lang]}</span>
    </div>
  );
}

function Days({ report, id, lang }: { report: StatusReport; id: CheckId; lang: Lang }) {
  const byDate = new Map(report.days.map((d) => [d.date, d.checks[id]]));
  return (
    <ol className="st-days" aria-label={w(lang, 'days')}>
      {lastDays(report.checkedAt.slice(0, 10)).map((date) => {
        const t = byDate.get(date);
        const state = dayState(t);
        const pct = t?.runs ? `${Math.floor(((t.runs - t.down) / t.runs) * 1000) / 10}%` : w(lang, 'noData');
        return <li key={date} className={state} title={`${date}: ${pct}`} />;
      })}
    </ol>
  );
}

export default function Status({ loaderData }: Route.ComponentProps) {
  const { lang, report, apiAnswered, now, apiBase } = loaderData;
  const stale = report ? Date.parse(now) - Date.parse(report.checkedAt) > STALE_MS : false;
  const checks = report ? new Map(report.checks.map((c) => [c.id, c])) : new Map();
  // What this page knows for itself: it was made, so the site answers; the API did or did not.
  if (!apiAnswered) {
    checks.set('site', { id: 'site', state: 'up', ms: null, detail: null });
    checks.set('api', { id: 'api', state: 'down', ms: null, detail: null });
  }
  const statusUrl = `${apiBase}/v1/status`;

  let banner: React.ReactNode;
  if (!apiAnswered) banner = <Overall state="down" lang={lang} title={w(lang, 'apiDown')} line={w(lang, 'apiDownLine')} />;
  else if (!report) banner = <Overall state="unknown" lang={lang} title={w(lang, 'noReport')} line={w(lang, 'noReportLine')} />;
  else if (stale)
    banner = (
      <Overall
        state="degraded"
        lang={lang}
        title={w(lang, 'stale')}
        line={fill(w(lang, 'staleLine'), { when: utc(report.checkedAt, lang) })}
      />
    );
  else {
    const title = report.state === 'down' ? w(lang, 'someDown') : report.state === 'degraded' ? w(lang, 'someSlow') : w(lang, 'allUp');
    banner = (
      <Overall
        state={report.state === 'unknown' ? 'up' : report.state}
        lang={lang}
        title={title}
        line={
          <>
            {w(lang, 'checked')} <RelativeTime at={report.checkedAt} lang={lang} />
          </>
        }
      />
    );
  }

  const quota = report?.quota ?? null;
  const workers: WorkerLoad[] | null = report?.workers ?? null;

  return (
    <>
      <div className="phead flat">
        <div className="wrap">
          <div className="phead-row">
            <div>
              <h1 className="page-title">{w(lang, 'title')}</h1>
              <p className="lede">{w(lang, 'intro')}</p>
            </div>
            <div className="phead-acts">
              <Link className="btn" to={href('/health', lang)}>
                <Icon name="pulse" />
                {w(lang, 'healthLink')}
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="wrap st-page">
        {banner}

        <Box as="ul" className="st-checks" aria-label={w(lang, 'title')}>
          {ORDER.map((id) => {
            const check = checks.get(id);
            const state: CheckState = check?.state ?? 'unknown';
            const part = PARTS[id];
            const up = report ? uptime(report, id) : null;
            return (
              <li key={id} className="st-check">
                <div className="st-check-head">
                  <Icon name={part.icon} className="subtle" />
                  <span className="st-check-name">
                    <span className="row-title">{part.name[lang]}</span>
                    <span className="row-sub">{part.about[lang]}</span>
                  </span>
                  <span className={cx('st-state', state)}>
                    <Icon name={STATE_ICON[state]} size={14} />
                    {STATE_WORD[state][lang]}
                    {check?.ms != null && state !== 'unknown' ? <span className="subtle">
                        {' · '}
                        <bdi dir="ltr">{num(check.ms, lang)} ms</bdi>
                      </span> : null}
                  </span>
                </div>
                {check?.detail && state !== 'up' ? (
                  <p className="st-detail" lang="en" dir="ltr">
                    {check.detail}
                  </p>
                ) : null}
                {id === 'quota' && quota ? (
                  <div className="st-quota">
                    {quota.limit ? <Bar value={quota.used} max={quota.limit} label={w(lang, 'quota')} /> : null}
                    <p className="subtle">
                      {fill(w(lang, quota.limit ? 'quotaLine' : 'quotaNoLimit'), { used: num(quota.used, lang), limit: quota.limit ? num(quota.limit, lang) : '' })}
                      {quota.runsOutAt ? ` ${fill(w(lang, 'runsOut'), { at: quota.runsOutAt.slice(11, 16) })}` : null}
                    </p>
                  </div>
                ) : null}
                {id === 'workers' && workers ? (
                  <ul className="st-workers">
                    {workers.map((load) => (
                      <li key={load.script}>
                        <bdi dir="ltr" className="st-worker-name">
                          {load.script}
                        </bdi>
                        <span className="subtle">
                          {load.requests
                            ? fill(w(lang, 'workerLine'), { n: num(load.requests, lang), p50: load.cpuP50Ms === null ? '–' : String(load.cpuP50Ms), p99: load.cpuP99Ms === null ? '–' : String(load.cpuP99Ms), stopped: num(load.exceeded, lang) })
                            : w(lang, 'workerNone')}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {report ? (
                  <div className="st-history">
                    <Days report={report} id={id} lang={lang} />
                    <p className="st-history-foot subtle">
                      <span>{w(lang, 'days')}</span>
                      <span>{up === null ? w(lang, 'noData') : `${up}% ${w(lang, 'uptime')}`}</span>
                      <span>{w(lang, 'now')}</span>
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </Box>

        <section aria-labelledby="incidents">
          <h2 className="h-block" id="incidents">
            <Icon name="history" className="subtle" />
            {w(lang, 'incidents')}
          </h2>
          <Box>
            {report?.incidents.length ? (
              <ul className="st-incidents">
                {report.incidents.map((i) => (
                  <li key={`${i.check}-${i.from}`} className="row">
                    <span className={cx('st-state', i.to ? 'resolved' : i.state)}>
                      <Icon name={i.to ? 'check' : STATE_ICON[i.state]} size={14} />
                    </span>
                    <span className="row-main">
                      <span className="row-title">
                        {PARTS[i.check].name[lang]}: {STATE_WORD[i.state][lang]}
                      </span>
                      <span className="row-sub">
                        {utc(i.from, lang)} · {i.to ? fill(w(lang, 'lasted'), { d: duration(Date.parse(i.to) - Date.parse(i.from), lang) }) : w(lang, 'ongoing')}
                      </span>
                      {i.detail ? (
                        <span className="row-sub" lang="en" dir="ltr">
                          {i.detail}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState compact icon="check" title={w(lang, 'noIncidents')} />
            )}
          </Box>
        </section>

        <p className="subtle st-json">
          {w(lang, 'forPrograms')}
          <a href={statusUrl} dir="ltr">
            {statusUrl}
          </a>
        </p>
      </div>
    </>
  );
}
