import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Route } from './+types/admin';
import type { Entity } from '../lib/api.js';
import { langFrom, REPORT_REASONS, t, type Lang } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { personPath } from '../lib/threads.js';
import { useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';
import { Icon } from '../ui/Icon.js';
import { Avatar, Box, EmptyState, Label, RelativeTime, Skeleton, StateIcon, Tabs } from '../ui/primitives.js';
import '../styles/pages/people.css';
import '../styles/pages/admin.css';

/**
 * The stewards' page: the people with accounts (appointing stewards, for
 * platform admins; suspending, for stewards), the reports readers sent
 * (resolved or dismissed), and takedown requests, where each file the
 * request points at is taken down in one click (logged). Filled in by the
 * browser; the API decides who may see and do what. Each part is a tab
 * with its own address (`?tab=`), each list a box of rows with its
 * actions at the row's end, as GitHub's own admin pages are.
 */
export function loader({ request }: Route.LoaderArgs) {
  return { lang: langFrom(request), siteUrl: new URL(request.url).origin };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: t(loaderData.lang, 'adminTitle'), path: '/admin', lang: loaderData.lang, siteUrl: loaderData.siteUrl, noindex: true });
}

interface Person {
  id: string;
  username?: string;
  displayName: string;
  steward: boolean;
  admin: boolean;
  createdAt: string;
  passkeys: number;
  google: string | null;
  suspended: boolean;
  suggestions: number;
}

interface Report {
  id: number;
  entity_id: string | null;
  reason: string;
  note: string | null;
  created_at: string;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/_/steward/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(json.message ?? response.statusText);
  return json;
}

const when = (iso: string, lang: Lang) => new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

/** An action that asks first when it cannot be quietly undone, then loads the list again. */
function useAct(load: () => Promise<void>, onError: (message: string | null) => void) {
  return (path: string, body: unknown, confirmText?: string) => async () => {
    if (confirmText && !window.confirm(confirmText)) return;
    onError(null);
    try {
      await call(path, body);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
}

function People({ lang, onError }: { lang: Lang; onError: (message: string | null) => void }) {
  const [q, setQ] = useState('');
  const [data, setData] = useState<{ me: { admin: boolean }; people: Person[] } | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await call(`admin/people${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''}`));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [q, onError]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);
  const act = useAct(load, onError);

  return (
    <>
      <div className="admin-search">
        <Icon name="search" />
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(lang, 'adminSearchPeople')} aria-label={t(lang, 'adminSearchPeople')} dir="auto" />
      </div>
      <Box
        header={
          <>
            <Icon name="users" />
            <span>{t(lang, 'adminPeople')}</span>
            {data ? <span className="count">{data.people.length}</span> : null}
          </>
        }
      >
        {data === null ? (
          <Skeleton rows={4} lang={lang} />
        ) : data.people.length === 0 ? (
          <EmptyState compact icon="users" title={t(lang, 'adminPeople')} />
        ) : (
          <ul className="rows">
            {data.people.map((p) => (
              <li key={p.id} className="row admin-row">
                <Avatar name={p.displayName} id={p.id} size="sm" />
                <span className="row-main">
                  <span className="row-title">
                    {p.username ? (
                      <Link to={href(personPath(p.username), lang)} dir="auto">
                        {p.displayName}
                      </Link>
                    ) : (
                      <span dir="auto">{p.displayName}</span>
                    )}
                    {p.username ? (
                      <span className="handle" dir="ltr">
                        @{p.username}
                      </span>
                    ) : null}
                    {p.admin ? <Label size="sm">{t(lang, 'roleAdmin')}</Label> : p.steward ? <Label size="sm">{t(lang, 'steward')}</Label> : null}
                    {p.suspended ? (
                      <Label size="sm" tone="scan">
                        {t(lang, 'suspended')}
                      </Label>
                    ) : null}
                  </span>
                  <span className="row-sub">
                    <span className="mono" dir="ltr">
                      {p.id}
                    </span>
                    {[when(p.createdAt, lang), p.passkeys ? `${p.passkeys} ${t(lang, 'passkeysShort')}` : null, p.google, p.suggestions ? `${p.suggestions} ${t(lang, 'suggestionsShort')}` : null]
                      .filter(Boolean)
                      .map((part) => ` · ${part}`)
                      .join('')}
                  </span>
                </span>
                <span className="admin-acts">
                  {data.me.admin && !p.admin ? (
                    <button type="button" className="btn sm" onClick={act(`admin/people/${p.id}/role`, { steward: !p.steward })}>
                      {t(lang, p.steward ? 'removeSteward' : 'makeSteward')}
                    </button>
                  ) : null}
                  {data.me.admin && p.steward && !p.admin ? (
                    <button type="button" className="btn sm" onClick={act(`admin/people/${p.id}/role`, { admin: true }, t(lang, 'makeAdminConfirm'))}>
                      {t(lang, 'makeAdmin')}
                    </button>
                  ) : null}
                  {!p.admin ? (
                    <button type="button" className={p.suspended ? 'btn sm' : 'btn sm danger'} onClick={act(`admin/people/${p.id}/suspend`, { on: !p.suspended }, p.suspended ? undefined : t(lang, 'suspendConfirm'))}>
                      {t(lang, p.suspended ? 'restore' : 'suspend')}
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Box>
    </>
  );
}

function Reports({ lang, onError }: { lang: Lang; onError: (message: string | null) => void }) {
  const [data, setData] = useState<{ reports: Report[]; items: Entity[] } | null>(null);
  const load = useCallback(async () => {
    try {
      setData(await call('reports?status=open'));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [onError]);
  useEffect(() => void load(), [load]);
  const act = useAct(load, onError);

  return (
    <Box
      header={
        <>
          <Icon name="flag" />
          <span>{t(lang, 'adminReports')}</span>
          {data ? <span className="count">{data.reports.length}</span> : null}
        </>
      }
    >
      {data === null ? (
        <Skeleton rows={3} lang={lang} />
      ) : data.reports.length === 0 ? (
        <EmptyState compact icon="check" title={t(lang, 'noReports')} />
      ) : (
        <ul className="rows">
          {data.reports.map((r) => {
            const item = data.items.find((i) => i.id === r.entity_id);
            const reason = REPORT_REASONS.find((x) => x.id === r.reason);
            return (
              <li key={r.id} className="row admin-row">
                <StateIcon kind="report" state="open" />
                <span className="row-main">
                  <span className="row-title">{reason ? reason[lang] : r.reason}</span>
                  {item ? (
                    <Link className="admin-target" to={href(itemPath(item), lang)}>
                      {labelOf(item, lang)}
                    </Link>
                  ) : null}
                  {r.note ? (
                    <span className="admin-note">
                      <bdi>{r.note}</bdi>
                    </span>
                  ) : null}
                  <span className="row-sub">
                    <span className="num">#{r.id}</span> · <RelativeTime at={r.created_at} lang={lang} />
                  </span>
                </span>
                <span className="admin-acts">
                  <button type="button" className="btn sm" onClick={act(`reports/${r.id}/close`, { outcome: 'resolved' })}>
                    <Icon name="check" />
                    {t(lang, 'reportResolved')}
                  </button>
                  <button type="button" className="btn sm ghost" onClick={act(`reports/${r.id}/close`, { outcome: 'dismissed' })}>
                    {t(lang, 'reportDismiss')}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Box>
  );
}

interface Takedown {
  report: number;
  at: string;
  name: string;
  email: string;
  relation: 'rights-holder' | 'family' | 'representative' | 'other';
  target: string;
  statement: string | null;
  entityId: string | null;
  files: Array<{ sha256: string; mime: string; bytes: number; rights: string; usedBy: string | null }>;
}

function Takedowns({ lang, onError }: { lang: Lang; onError: (message: string | null) => void }) {
  const [data, setData] = useState<Takedown[] | null>(null);
  const load = useCallback(async () => {
    try {
      setData((await call<{ takedowns: Takedown[] }>('admin/takedowns')).takedowns);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [onError]);
  useEffect(() => void load(), [load]);
  const act = useAct(load, onError);

  if (data === null)
    return (
      <Box>
        <Skeleton rows={3} lang={lang} />
      </Box>
    );
  if (data.length === 0)
    return (
      <Box>
        <EmptyState compact icon="check" title={t(lang, 'noTakedowns')} />
      </Box>
    );
  return (
    <div className="stack">
      {data.map((d) => (
        <Box
          as="section"
          key={d.report}
          className="takedown-box"
          header={
            <>
              <StateIcon kind="report" state="open" />
              <span className="takedown-who">
                <b dir="auto">{d.name}</b>
                <span className="muted">{t(lang, `relation_${d.relation}`)}</span>
              </span>
              <span className="end">
                <span className="num muted">#{d.report}</span>
                <RelativeTime at={d.at} lang={lang} className="muted" />
              </span>
            </>
          }
          footer={
            <span className="btn-row">
              <button type="button" className="btn sm" onClick={act(`reports/${d.report}/close`, { outcome: 'resolved' })}>
                <Icon name="check" />
                {t(lang, 'takedownDone')}
              </button>
              <button type="button" className="btn sm ghost" onClick={act(`reports/${d.report}/close`, { outcome: 'dismissed' })}>
                {t(lang, 'reportDismiss')}
              </button>
            </span>
          }
        >
          <dl className="facts takedown-facts">
            <dt>{t(lang, 'takedownEmail')}</dt>
            <dd>
              <a href={`mailto:${d.email}`} dir="ltr">
                {d.email}
              </a>
            </dd>
            <dt>{t(lang, 'takedownWhat').split(':')[0]}</dt>
            <dd>
              {d.entityId ? (
                <Link to={href(`/${d.entityId}`, lang)} dir="ltr">
                  {d.target}
                </Link>
              ) : (
                <span dir="ltr">{d.target}</span>
              )}
            </dd>
          </dl>
          {d.statement ? (
            <blockquote className="admin-note takedown-statement">
              <bdi>{d.statement}</bdi>
            </blockquote>
          ) : null}
          {d.files.length === 0 ? (
            <div className="takedown-pad">
              <div className="alert info" role="note">
                <Icon name="info" />
                <div>{t(lang, 'takedownNoFiles')}</div>
              </div>
            </div>
          ) : (
            <ul className="rows takedown-files">
              {d.files.map((f) => (
                <li key={f.sha256} className="row">
                  <Icon name={f.mime.startsWith('audio/') ? 'audio' : f.mime.startsWith('video/') ? 'video' : 'file'} />
                  <span className="row-main">
                    <span className="row-title mono" dir="ltr">
                      {f.sha256.slice(0, 12)}…
                    </span>
                    <span className="row-sub" dir="ltr">
                      {f.mime} · {(f.bytes / 1024 / 1024).toFixed(1)} MB
                    </span>
                  </span>
                  {f.rights === 'preserved' ? (
                    <Label size="sm" tone="scan">
                      {t(lang, 'takenDown')}
                    </Label>
                  ) : (
                    <button type="button" className="btn sm danger" onClick={act(`admin/files/${f.sha256}/takedown`, { report: d.report }, t(lang, 'takeDownConfirm'))}>
                      <Icon name="trash" />
                      {t(lang, 'takeDown')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Box>
      ))}
    </div>
  );
}

function Head({ lang, lede, tabs }: { lang: Lang; lede?: string; tabs?: ReactNode }) {
  return (
    <div className="phead">
      <div className="wrap">
        <h1 className="page-title">{t(lang, 'adminTitle')}</h1>
        {lede ? <p className="lede">{lede}</p> : null}
        {tabs}
      </div>
    </div>
  );
}

export default function Admin() {
  const lang = useLang();
  const account = useAccount();
  const [params] = useSearchParams();
  const tab = params.get('tab') === 'reports' ? 'reports' : params.get('tab') === 'takedowns' ? 'takedowns' : 'people';
  const [error, setError] = useState<string | null>(null);

  if (account === undefined)
    return (
      <>
        <Head lang={lang} />
        <div className="wrap page">
          <Skeleton rows={4} lang={lang} />
        </div>
      </>
    );
  if (!account?.person.steward)
    return (
      <>
        <Head lang={lang} />
        <div className="wrap narrow page">
          <Box>
            <EmptyState icon="lock" title={t(lang, 'adminOnly')} />
          </Box>
        </div>
      </>
    );
  return (
    <>
      <Head
        lang={lang}
        lede={t(lang, account.person.admin ? 'adminIntroAdmin' : 'adminIntro')}
        tabs={
          <Tabs
            label={t(lang, 'sections')}
            current={tab}
            items={[
              { key: 'people', label: t(lang, 'adminPeople'), icon: 'users', to: href('/admin', lang, { tab: 'people' }) },
              { key: 'reports', label: t(lang, 'adminReports'), icon: 'flag', to: href('/admin', lang, { tab: 'reports' }) },
              { key: 'takedowns', label: t(lang, 'adminTakedowns'), icon: 'shield', to: href('/admin', lang, { tab: 'takedowns' }) },
              { key: 'review', label: t(lang, 'reviewTitle'), icon: 'suggest', to: href('/review', lang) },
            ]}
          />
        }
      />
      <div className="wrap page stack">
        {error ? (
          <div className="alert negative" role="alert">
            <Icon name="warn" />
            <div>{error}</div>
          </div>
        ) : null}
        {tab === 'people' ? <People lang={lang} onError={setError} /> : tab === 'takedowns' ? <Takedowns lang={lang} onError={setError} /> : <Reports lang={lang} onError={setError} />}
      </div>
    </>
  );
}
