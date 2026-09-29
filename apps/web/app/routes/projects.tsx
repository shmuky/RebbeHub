import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Route } from './+types/projects';
import type { Project } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { yearLabel } from '../lib/dates.js';
import { langFrom, t, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { Bar, Box, ChoiceList, EmptyState, Label, Panel, RelativeTime, cx, type LabelTone } from '../ui/primitives.js';
import '../styles/pages/projects.css';

/**
 * Projects (the plan, section 7): a keeper opens "Recordings of 5745",
 * "Sync the 5745 farbrengens" or "Proofread this volume" and the community
 * works through it; each shows how far it has come. The list reads as
 * GitHub's issues do: open and closed as two views of one list, each
 * project a row with what it works through, who opened it, and its bar.
 * Stewards open new ones here.
 */

type Missing = Project['focus']['missing'];

export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const state = new URL(request.url).searchParams.get('state') === 'closed' ? 'closed' : 'open';
  // What the Missing board holds, for the side: the gaps a new project could take on.
  const [{ projects }, recordings, texts] = await Promise.all([
    api.projects(),
    api.missing('recordings', { limit: 1 }).catch(() => null),
    api.missing('texts', { limit: 1 }).catch(() => null),
  ]);
  return { lang, siteUrl, state, projects, gaps: { recordings: recordings?.total ?? null, texts: texts?.total ?? null } };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: t(loaderData.lang, 'projectsTitle'), description: t(loaderData.lang, 'projectsIntro'), path: '/projects', lang: loaderData.lang, siteUrl: loaderData.siteUrl });
}

/** The words of the projects' pages that are theirs alone. */
export const PW = {
  open: { he: 'פתוחים', en: 'Open' },
  closed: { he: 'סגורים', en: 'Closed' },
  stateOpen: { he: 'פתוח', en: 'Open' },
  stateMerged: { he: 'הושלם', en: 'Done' },
  stateClosed: { he: 'נסגר', en: 'Closed' },
  openedAgo: { he: 'נפתח', en: 'opened' },
  by: { he: 'על ידי', en: 'by' },
  of: { he: 'מתוך', en: 'of' },
  done: { he: 'נעשו', en: 'done' },
  noClosed: { he: 'עוד לא נסגר שום פרויקט.', en: 'No project has been closed yet.' },
  noOpenHint: { he: 'אפשר להתחיל מלוח החוסרים: כל התוועדות שם מחכה למישהו.', en: 'Start from the Missing board: every farbrengen there is waiting for someone.' },
  howTitle: { he: 'איך זה עובד', en: 'How it works' },
  how1: { he: 'כל פרויקט עובר על חוסר אחד: התוועדויות של שנה בלי הקלטה, הקלטות לסנכרון, עמודי סריקה להגהה.', en: 'Each project works through one gap: a year’s farbrengens with no recording, recordings to sync, a scan’s pages to proofread.' },
  how2: { he: '״תנו לי את הבא״ מביא לכם פריט שאף אחד אחר לא עובד עליו, ושומר אותו לכם לשלוש שעות.', en: '“Give me the next one” hands you an item nobody else is on, and keeps it for you for three hours.' },
  how3: { he: 'ההתקדמות זזה עם כל תוספת שאושרה.', en: 'Progress moves with every approved addition.' },
  gapsTitle: { he: 'מה עוד חסר', en: 'Still missing' },
  gapRecordings: { he: 'התוועדויות בלי הקלטה', en: 'Farbrengens with no recording' },
  gapTexts: { he: 'התוועדויות בלי הנחה', en: 'Farbrengens with no text' },
  allMissing: { he: 'לוח החוסרים', en: 'The Missing board' },
  health: { he: 'מצב הקטלוג', en: 'Health of the catalog' },
  newProject: { he: 'פרויקט חדש', en: 'New project' },
  newHint: { he: 'לאחראים בלבד', en: 'Stewards only' },
  scanHint: { he: 'מופיע בכתובת של דף הסריקה', en: 'In the address of the scan’s page' },
  yearHint: { he: 'ריק: כל השנים', en: 'Empty: every year' },
  kind_recordings: { he: 'הקלטות', en: 'Recordings' },
  kind_texts: { he: 'הנחות', en: 'Texts' },
  kind_sync: { he: 'סנכרון', en: 'Sync' },
  kind_proofreading: { he: 'הגהה', en: 'Proofreading' },
} as const;

export const pw = (lang: Lang, key: keyof typeof PW) => PW[key][lang];

/** What a project works through, as a label with its colour and icon. */
export const FOCUS: Record<Missing, { tone: LabelTone; icon: IconName }> = {
  recordings: { tone: 'audio', icon: 'audio' },
  texts: { tone: 'text', icon: 'scan' },
  sync: { tone: 'sync', icon: 'clock' },
  proofreading: { tone: 'scan', icon: 'pencil' },
};

export function FocusLabel({ project, lang, size }: { project: Pick<Project, 'focus'>; lang: Lang; size?: 'sm' }) {
  const missing = project.focus.missing;
  return (
    <Label tone={FOCUS[missing].tone} size={size}>
      {pw(lang, `kind_${missing}`)}
    </Label>
  );
}

/** The Missing board counts up to 2,000 farbrengens at a time; past that it says so. */
export const MISSING_CAP = 2000;
export const capped = (n: number, lang: Lang) => (n >= MISSING_CAP ? `\u2066${num(MISSING_CAP, lang)}+\u2069` : num(n, lang));

export const percent = (p: Pick<Project, 'total' | 'done'>) => (p.total ? Math.round((p.done / p.total) * 100) : 0);

/** `54 of 106 · 51%`, under a thin bar. */
export function Progress({ project, lang, className }: { project: Pick<Project, 'total' | 'done'>; lang: Lang; className?: string }) {
  const pct = percent(project);
  const words = `${num(project.done, lang)} ${pw(lang, 'of')} ${num(project.total, lang)} · ${pct}%`;
  return (
    <span className={cx('pj-progress', className)}>
      <Bar value={project.done} max={project.total || 1} tone={pct >= 100 ? 'open' : undefined} label={words} />
      <span className="num">{words}</span>
    </span>
  );
}

/** A project's focus in words: "Farbrengens of 5745 without a recording", "Recordings of 5745 to check their sync", "Proofreading a scan". */
export function focusText(p: Pick<Project, 'focus'>, lang: Lang): string {
  const year = p.focus.within ? ` ${yearLabel(Number(p.focus.within.slice(0, 4)), lang)}` : '';
  if (p.focus.missing === 'proofreading') return `${t(lang, 'proofreadScan')} · ${t(lang, p.focus.level === 2 ? 'proofread2' : 'proofread1')}`;
  if (p.focus.missing === 'sync') return `${t(lang, 'recordingsOf')}${year} ${t(lang, 'withoutSync')}`;
  return `${t(lang, 'farbrengensOf')}${year} ${t(lang, p.focus.missing === 'recordings' ? 'withoutRecording' : 'withoutText')}`;
}

/** Open, done or closed, as the icon at the start of a row. */
export function ProjectStateIcon({ status }: { status: Project['status'] }) {
  return (
    <span className={cx('pj-ic', status)} aria-hidden="true">
      <Icon name={status === 'open' ? 'target' : status === 'merged' ? 'reportdone' : 'reportclosed'} />
    </span>
  );
}

/** A steward opens a project: its name, the gap it works through, and where. */
function NewProject({ lang }: { lang: Lang }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [missing, setMissing] = useState<Missing>('recordings');
  const [year, setYear] = useState('');
  const [scan, setScan] = useState('');
  const [level, setLevel] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const proofreading = missing === 'proofreading';
    const slug = `${missing}${year && !proofreading ? `-${year}` : ''}-${Date.now().toString(36)}`;
    const response = await fetch('/_/steward/projects', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(proofreading ? { slug, name, goal, missing, scan: scan.trim(), level: Number(level) } : { slug, name, goal, missing, within: year || undefined }),
    });
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    setBusy(false);
    if (!response.ok) return setError(body.message ?? response.statusText);
    navigate(href(`/projects/${slug}`, lang));
  }

  const kinds: Missing[] = ['recordings', 'texts', 'sync', 'proofreading'];
  return (
    <form className="form pj-new" onSubmit={create}>
      <label className="field">
        <span>{t(lang, 'projectName')}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} dir="auto" placeholder={t(lang, 'projectNameHint')} />
      </label>
      <div className="field">
        <span>{t(lang, 'projectWorksThrough')}</span>
        <ChoiceList
          name="missing"
          legend={t(lang, 'projectWorksThrough')}
          value={missing}
          onChange={(v) => setMissing(v as Missing)}
          options={kinds.map((k) => ({ value: k, label: t(lang, `missing_${k}`), hint: pw(lang, `kind_${k}`) }))}
        />
      </div>
      {missing === 'proofreading' ? (
        <div className="form-row">
          <label className="field">
            <span>{t(lang, 'scanId')}</span>
            <input value={scan} onChange={(e) => setScan(e.target.value)} required pattern="rh-[0-9a-zA-Z]+" placeholder="rh-…" dir="ltr" />
            <span className="hint">{pw(lang, 'scanHint')}</span>
          </label>
          <div className="field">
            <span>{t(lang, 'proofreadTo')}</span>
            <ChoiceList
              name="level"
              inline
              legend={t(lang, 'proofreadTo')}
              value={level}
              onChange={setLevel}
              options={[
                { value: '1', label: t(lang, 'proofread1') },
                { value: '2', label: t(lang, 'proofread2') },
              ]}
            />
          </div>
        </div>
      ) : (
        <label className="field">
          <span>{t(lang, 'year')}</span>
          <input className="pj-year" value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" maxLength={4} placeholder="5745" dir="ltr" />
          <span className="hint">{pw(lang, 'yearHint')}</span>
        </label>
      )}
      <label className="field">
        <span>{t(lang, 'projectGoal')}</span>
        <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} maxLength={2000} dir="auto" />
      </label>
      {error ? (
        <p className="alert negative" role="alert">
          <Icon name="warn" />
          {error}
        </p>
      ) : null}
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={busy || !name.trim() || (year !== '' && !/^\d{4}$/.test(year))}>
          {t(lang, 'openProject')}
        </button>
      </div>
    </form>
  );
}

export default function Projects({ loaderData }: Route.ComponentProps) {
  const lang = useLang();
  const account = useAccount();
  const { projects, state, gaps } = loaderData;
  const open = projects.filter((p) => p.status === 'open');
  const closed = projects.filter((p) => p.status !== 'open');
  const shown = state === 'closed' ? closed : open;
  const steward = Boolean(account?.person.steward);

  return (
    <>
      <div className="phead flat">
        <div className="wrap">
          <div className="phead-row">
            <div>
              <h1 className="page-title">{t(lang, 'projectsTitle')}</h1>
              <p className="lede">{t(lang, 'projectsIntro')}</p>
            </div>
            <div className="phead-acts">
              <Link className="btn" to={href('/missing', lang)}>
                <Icon name="target" />
                {pw(lang, 'allMissing')}
              </Link>
              {steward ? (
                <a className="btn primary" href="#new-project">
                  <Icon name="plus" />
                  {pw(lang, 'newProject')}
                </a>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="wrap cols pj-cols">
        <div className="stack">
          {steward ? (
            <Panel id="new-project" icon="plus" title={t(lang, 'newProject')} hint={pw(lang, 'newHint')}>
              <NewProject lang={lang} />
            </Panel>
          ) : null}

          <Box
            className="pj-list"
            header={
              <nav className="pj-states" aria-label={t(lang, 'projectsTitle')}>
                <Link to={href('/projects', lang)} aria-current={state === 'open' ? 'page' : undefined} preventScrollReset>
                  <Icon name="target" />
                  {num(open.length, lang)} {pw(lang, 'open')}
                </Link>
                <Link to={href('/projects', lang, { state: 'closed' })} aria-current={state === 'closed' ? 'page' : undefined} preventScrollReset>
                  <Icon name="check" />
                  {num(closed.length, lang)} {pw(lang, 'closed')}
                </Link>
              </nav>
            }
          >
            {shown.length === 0 ? (
              state === 'closed' ? (
                <EmptyState compact icon="check" title={pw(lang, 'noClosed')} />
              ) : (
                <EmptyState
                  compact
                  icon="target"
                  title={t(lang, 'noProjects')}
                  actions={
                    <Link className="btn sm" to={href('/missing', lang)}>
                      {pw(lang, 'allMissing')}
                    </Link>
                  }
                >
                  {pw(lang, 'noOpenHint')}
                </EmptyState>
              )
            ) : (
              <ul>
                {shown.map((p) => (
                  <li key={p.slug} className="pj-row">
                    <ProjectStateIcon status={p.status} />
                    <div className="pj-main">
                      <div className="pj-title-line">
                        <Link className="pj-title" to={href(`/projects/${p.slug}`, lang)}>
                          {p.name}
                        </Link>
                        <FocusLabel project={p} lang={lang} size="sm" />
                      </div>
                      <div className="pj-sub">
                        <span>{focusText(p, lang)}</span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {pw(lang, 'openedAgo')} <RelativeTime at={p.createdAt} lang={lang} />
                          {p.creatorName ? ` ${pw(lang, 'by')} ${p.creatorName}` : ''}
                        </span>
                      </div>
                    </div>
                    <Progress project={p} lang={lang} className="pj-row-progress" />
                  </li>
                ))}
              </ul>
            )}
          </Box>
        </div>

        <aside className="side" aria-label={pw(lang, 'howTitle')}>
          <section>
            <h2>{pw(lang, 'howTitle')}</h2>
            <ul className="pj-how">
              <li>{pw(lang, 'how1')}</li>
              <li>{pw(lang, 'how2')}</li>
              <li>{pw(lang, 'how3')}</li>
            </ul>
          </section>
          {gaps.recordings !== null || gaps.texts !== null ? (
            <section>
              <h2>
                {pw(lang, 'gapsTitle')}
                <Link to={href('/missing', lang)}>{pw(lang, 'allMissing')}</Link>
              </h2>
              <ul className="side-list">
                {gaps.recordings !== null ? (
                  <li>
                    <Icon name="audio" className="subtle" />
                    <Link className="grow" to={href('/missing', lang, { kind: 'recordings' })}>
                      {pw(lang, 'gapRecordings')}
                    </Link>
                    <span className="num subtle">{capped(gaps.recordings, lang)}</span>
                  </li>
                ) : null}
                {gaps.texts !== null ? (
                  <li>
                    <Icon name="scan" className="subtle" />
                    <Link className="grow" to={href('/missing', lang, { kind: 'texts' })}>
                      {pw(lang, 'gapTexts')}
                    </Link>
                    <span className="num subtle">{capped(gaps.texts, lang)}</span>
                  </li>
                ) : null}
                <li>
                  <Icon name="pulse" className="subtle" />
                  <Link className="grow" to={href('/health', lang)}>
                    {pw(lang, 'health')}
                  </Link>
                </li>
              </ul>
            </section>
          ) : null}
        </aside>
      </div>
    </>
  );
}
