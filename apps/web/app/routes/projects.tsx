import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { Route } from './+types/projects';
import type { Project } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { yearLabel } from '../lib/dates.js';
import { langFrom, t, type Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';

/**
 * Projects (the plan, section 7): a keeper opens "Recordings of 5745",
 * "Sync the 5745 farbrengens" or "Proofread this volume" and the community
 * works through it; each shows how far it has come. Stewards open new ones
 * here.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  return { lang: langFrom(request), siteUrl, projects: (await api.projects()).projects };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: t(loaderData.lang, 'projectsTitle'), path: '/projects', lang: loaderData.lang, siteUrl: loaderData.siteUrl });
}

/** `12 / 40 · 30%`, and a bar. */
export function Progress({ project, lang }: { project: Pick<Project, 'total' | 'done'>; lang: Lang }) {
  const pct = project.total ? Math.round((project.done / project.total) * 100) : 0;
  const num = (n: number) => n.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US');
  return (
    <span className="project-progress">
      <span className="progress-bar" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </span>
      <span className="row-sub">
        {num(project.done)} / {num(project.total)} · {pct}%
      </span>
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

function NewProject({ lang }: { lang: Lang }) {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [missing, setMissing] = useState<Project['focus']['missing']>('recordings');
  const [year, setYear] = useState('');
  const [scan, setScan] = useState('');
  const [level, setLevel] = useState('1');
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const proofreading = missing === 'proofreading';
    const slug = `${missing}${year && !proofreading ? `-${year}` : ''}-${Date.now().toString(36)}`;
    const response = await fetch('/_/steward/projects', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(proofreading ? { slug, name, goal, missing, scan: scan.trim(), level: Number(level) } : { slug, name, goal, missing, within: year || undefined }),
    });
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) return setError(body.message ?? response.statusText);
    navigate(href(`/projects/${slug}`, lang));
  }

  return (
    <details className="report">
      <summary>{t(lang, 'newProject')}</summary>
      <form onSubmit={create}>
        <label>
          {t(lang, 'projectName')}
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} dir="auto" placeholder={t(lang, 'projectNameHint')} />
        </label>
        <label>
          {t(lang, 'projectWorksThrough')}
          <select value={missing} onChange={(e) => setMissing(e.target.value as 'recordings')}>
            <option value="recordings">{t(lang, 'missing_recordings')}</option>
            <option value="texts">{t(lang, 'missing_texts')}</option>
            <option value="sync">{t(lang, 'missing_sync')}</option>
            <option value="proofreading">{t(lang, 'missing_proofreading')}</option>
          </select>
        </label>
        {missing === 'proofreading' ? (
          <>
            <label>
              {t(lang, 'scanId')}
              <input value={scan} onChange={(e) => setScan(e.target.value)} required pattern="rh-[0-9a-zA-Z]+" placeholder="rh-…" dir="ltr" />
            </label>
            <label>
              {t(lang, 'proofreadTo')}
              <select value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="1">{t(lang, 'proofread1')}</option>
                <option value="2">{t(lang, 'proofread2')}</option>
              </select>
            </label>
          </>
        ) : (
          <label>
            {t(lang, 'year')}
            <input value={year} onChange={(e) => setYear(e.target.value)} inputMode="numeric" maxLength={4} placeholder="5745" dir="ltr" />
          </label>
        )}
        <label>
          {t(lang, 'projectGoal')}
          <textarea value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} maxLength={2000} />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <div>
          <button type="submit" disabled={!name.trim() || (year !== '' && !/^\d{4}$/.test(year))}>
            {t(lang, 'openProject')}
          </button>
        </div>
      </form>
    </details>
  );
}

export default function Projects({ loaderData }: Route.ComponentProps) {
  const lang = useLang();
  const account = useAccount();
  const { projects } = loaderData;
  const open = projects.filter((p) => p.status === 'open');
  const done = projects.filter((p) => p.status !== 'open');
  const Rows = ({ list }: { list: Project[] }) => (
    <ul className="rows">
      {list.map((p) => (
        <li key={p.slug} className="row project-row">
          <span className="row-main">
            <Link className="row-title" to={href(`/projects/${p.slug}`, lang)}>
              {p.name}
            </Link>
            <span className="row-sub">{focusText(p, lang)}</span>
            <Progress project={p} lang={lang} />
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <h1>{t(lang, 'projectsTitle')}</h1>
      <p className="subtitle">{t(lang, 'projectsIntro')}</p>
      {open.length === 0 ? <p>{t(lang, 'noProjects')}</p> : <Rows list={open} />}
      {account?.person.steward ? <NewProject lang={lang} /> : null}
      {done.length ? (
        <section>
          <h2 className="section-header">{t(lang, 'projectsClosed')}</h2>
          <Rows list={done} />
        </section>
      ) : null}
      <p>
        <Link to={href('/missing', lang)}>{t(lang, 'missingTitle')}</Link>
      </p>
    </>
  );
}
