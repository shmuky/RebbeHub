import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Route } from './+types/admin';
import type { Entity } from '../lib/api.js';
import { langFrom, REPORT_REASONS, t, type Lang } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';

/**
 * The stewards' page: the people with accounts (appointing stewards, for
 * platform admins; suspending, for stewards), the reports readers sent
 * (resolved or dismissed), and takedown requests, where each file the
 * request points at is taken down in one click (logged). Filled in by the
 * browser; the API decides who may see and do what.
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

  const act = (path: string, body: unknown, confirmText?: string) => async () => {
    if (confirmText && !window.confirm(confirmText)) return;
    onError(null);
    try {
      await call(path, body);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section>
      <input className="admin-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(lang, 'adminSearchPeople')} dir="auto" />
      <ul className="rows">
        {data?.people.map((p) => (
          <li key={p.id} className="row admin-person">
            <span className="row-main">
              <span className="row-title">
                {p.displayName}
                {p.admin ? <span className="badge">{t(lang, 'roleAdmin')}</span> : p.steward ? <span className="badge">{t(lang, 'steward')}</span> : null}
                {p.suspended ? <span className="badge is-warn">{t(lang, 'suspended')}</span> : null}
              </span>
              <span className="row-sub">
                <span dir="ltr">{p.id}</span>
                {[
                  when(p.createdAt, lang),
                  p.passkeys ? `${p.passkeys} ${t(lang, 'passkeysShort')}` : null,
                  p.google,
                  p.suggestions ? `${p.suggestions} ${t(lang, 'suggestionsShort')}` : null,
                ]
                  .filter(Boolean)
                  .map((part) => ` · ${part}`)
                  .join('')}
              </span>
            </span>
            <span className="admin-actions">
              {data.me.admin && !p.admin ? (
                <button type="button" className="link-button" onClick={act(`admin/people/${p.id}/role`, { steward: !p.steward })}>
                  {t(lang, p.steward ? 'removeSteward' : 'makeSteward')}
                </button>
              ) : null}
              {data.me.admin && p.steward && !p.admin ? (
                <button type="button" className="link-button" onClick={act(`admin/people/${p.id}/role`, { admin: true }, t(lang, 'makeAdminConfirm'))}>
                  {t(lang, 'makeAdmin')}
                </button>
              ) : null}
              {!p.admin ? (
                <button type="button" className="link-button" onClick={act(`admin/people/${p.id}/suspend`, { on: !p.suspended }, p.suspended ? undefined : t(lang, 'suspendConfirm'))}>
                  {t(lang, p.suspended ? 'restore' : 'suspend')}
                </button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
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

  const close = (id: number, outcome: 'resolved' | 'dismissed') => async () => {
    onError(null);
    try {
      await call(`reports/${id}/close`, { outcome });
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  if (data && data.reports.length === 0) return <p>{t(lang, 'noReports')}</p>;
  return (
    <ul className="rows">
      {data?.reports.map((r) => {
        const item = data.items.find((i) => i.id === r.entity_id);
        const reason = REPORT_REASONS.find((x) => x.id === r.reason);
        return (
          <li key={r.id} className="row admin-report">
            <span className="row-main">
              <span className="row-title">{reason ? reason[lang] : r.reason}</span>
              {item ? <Link to={href(itemPath(item), lang)}>{labelOf(item, lang)}</Link> : null}
              {r.note ? <span className="suggestion-note">{r.note}</span> : null}
              <span className="row-sub">{when(r.created_at, lang)}</span>
            </span>
            <span className="admin-actions">
              <button type="button" className="link-button" onClick={close(r.id, 'resolved')}>
                {t(lang, 'reportResolved')}
              </button>
              <button type="button" className="link-button" onClick={close(r.id, 'dismissed')}>
                {t(lang, 'reportDismiss')}
              </button>
            </span>
          </li>
        );
      })}
    </ul>
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

  const act = (path: string, body: unknown, confirmText?: string) => async () => {
    if (confirmText && !window.confirm(confirmText)) return;
    onError(null);
    try {
      await call(path, body);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

  if (data && data.length === 0) return <p>{t(lang, 'noTakedowns')}</p>;
  return (
    <ul className="rows">
      {data?.map((d) => (
        <li key={d.report} className="row admin-report">
          <span className="row-main">
            <span className="row-title">
              {d.name} · {t(lang, `relation_${d.relation}`)}
            </span>
            <span className="row-sub" dir="ltr">
              {d.email}
            </span>
            {d.entityId ? <Link to={href(`/${d.entityId}`, lang)}>{d.target}</Link> : <span dir="ltr">{d.target}</span>}
            {d.statement ? <span className="suggestion-note">{d.statement}</span> : null}
            <span className="row-sub">{when(d.at, lang)}</span>
            {d.files.length === 0 ? <span className="row-sub">{t(lang, 'takedownNoFiles')}</span> : null}
            {d.files.map((f) => (
              <span key={f.sha256} className="row-sub">
                <span dir="ltr">
                  {f.mime} · {(f.bytes / 1024 / 1024).toFixed(1)} MB · {f.sha256.slice(0, 12)}…
                </span>{' '}
                {f.rights === 'preserved' ? (
                  <span className="badge">{t(lang, 'takenDown')}</span>
                ) : (
                  <button type="button" className="link-button" onClick={act(`admin/files/${f.sha256}/takedown`, { report: d.report }, t(lang, 'takeDownConfirm'))}>
                    {t(lang, 'takeDown')}
                  </button>
                )}
              </span>
            ))}
          </span>
          <span className="admin-actions">
            <button type="button" className="link-button" onClick={act(`reports/${d.report}/close`, { outcome: 'resolved' })}>
              {t(lang, 'takedownDone')}
            </button>
            <button type="button" className="link-button" onClick={act(`reports/${d.report}/close`, { outcome: 'dismissed' })}>
              {t(lang, 'reportDismiss')}
            </button>
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function Admin() {
  const lang = useLang();
  const account = useAccount();
  const [params] = useSearchParams();
  const tab = params.get('tab') === 'reports' ? 'reports' : params.get('tab') === 'takedowns' ? 'takedowns' : 'people';
  const [error, setError] = useState<string | null>(null);

  if (account === undefined) return <h1>{t(lang, 'adminTitle')}</h1>;
  if (!account?.person.steward)
    return (
      <>
        <h1>{t(lang, 'adminTitle')}</h1>
        <p>{t(lang, 'adminOnly')}</p>
      </>
    );
  return (
    <>
      <h1>{t(lang, 'adminTitle')}</h1>
      <p className="subtitle">{t(lang, account.person.admin ? 'adminIntroAdmin' : 'adminIntro')}</p>
      <nav className="page-tabs" aria-label={t(lang, 'sections')}>
        <Link to={href('/admin', lang, { tab: 'people' })} aria-current={tab === 'people' ? 'page' : undefined}>
          {t(lang, 'adminPeople')}
        </Link>
        <Link to={href('/admin', lang, { tab: 'reports' })} aria-current={tab === 'reports' ? 'page' : undefined}>
          {t(lang, 'adminReports')}
        </Link>
        <Link to={href('/admin', lang, { tab: 'takedowns' })} aria-current={tab === 'takedowns' ? 'page' : undefined}>
          {t(lang, 'adminTakedowns')}
        </Link>
        <Link to={href('/review', lang)}>{t(lang, 'reviewTitle')}</Link>
      </nav>
      {error ? (
        <p className="note" role="alert">
          {error}
        </p>
      ) : null}
      {tab === 'people' ? <People lang={lang} onError={setError} /> : tab === 'takedowns' ? <Takedowns lang={lang} onError={setError} /> : <Reports lang={lang} onError={setError} />}
    </>
  );
}
