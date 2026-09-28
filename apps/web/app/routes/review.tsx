import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Route } from './+types/review';
import { ChangeTable } from '../components/ChangeTable.js';
import { langFrom, t, typeName, type Lang } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { st } from '../lib/scanStrings.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';

/**
 * Suggestions waiting for review (the plan, section 7): each one's change
 * before and after, in words, and for the set's keepers Approve or Send
 * back with a note, in one tap. Also the signed-in person's own
 * suggestions and what became of them. Filled in by the browser, since
 * who may approve is personal; the page itself is the same for everyone.
 */
export function loader({ request }: Route.LoaderArgs) {
  return { lang: langFrom(request), siteUrl: new URL(request.url).origin };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: t(loaderData.lang, 'reviewTitle'), path: '/review', lang: loaderData.lang, siteUrl: loaderData.siteUrl, noindex: true });
}

interface Suggestion {
  id: number;
  title: string;
  description: string | null;
  author: string;
  status: 'draft' | 'open' | 'merged' | 'sent_back' | 'withdrawn';
  submitted_at: string | null;
  created_at: string;
  checks: Array<{ check: string; status: 'pass' | 'warn' | 'fail'; message: string }>;
}

interface Detail {
  changeset: Suggestion;
  entries: Array<{ entityId: string; type: string; before: unknown; after: unknown; changes: Array<{ path: string; before?: unknown; after?: unknown }>; conflicts: unknown[]; withheld?: string }>;
  reviews: Array<{ reviewer: string; verdict: 'approve' | 'send_back'; body: string | null; created_at: string }>;
  names: Record<string, string>;
  files: Record<string, { url: string | null; mime: string; bytes: number; rights: string; similar?: Array<{ kind: 'same' | 'shares'; matched?: number; of?: number; items: Array<{ id: string; type: string; path: string | null }> }> }>;
  mayApprove: boolean;
  mine: boolean;
}

async function call<T>(path: string, init?: { method: 'POST'; body: unknown }): Promise<T> {
  const response = await fetch(`/_/suggestions${path}`, {
    method: init?.method ?? 'GET',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    body: init ? JSON.stringify(init.body) : undefined,
  });
  const json = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(json.message ?? response.statusText);
  return json;
}

/** A new item, as the reviewer needs it: what kind it is, its name, and its file to hear or read before approving. */
function NewItem({ type, data, files, lang }: { type: string; data: Record<string, unknown>; files: Detail['files']; lang: Lang }) {
  const sha = typeof data.file === 'string' ? data.file : null;
  const file = sha ? files[sha] : undefined;
  return (
    <div className="new-item">
      <p className="row-sub">
        {t(lang, 'newItem')}: {typeName(type, lang)}
        {file ? ` · ${(file.bytes / 1024 / 1024).toFixed(1)} MB` : ''}
      </p>
      {file?.url && file.mime.startsWith('audio/') ? <audio controls preload="none" src={file.url} /> : null}
      {file?.url && file.mime === 'application/pdf' ? (
        <a href={file.url} target="_blank" rel="noreferrer">
          {t(lang, 'openFile')}
        </a>
      ) : null}
      {file && !file.url ? <p className="row-sub">{t(lang, 'filePrivate')}</p> : null}
      {/* What the jobs found it looks like: a machine's guess, for the reviewer to check. */}
      {file?.similar?.map((s, i) => (
        <p key={i} className="row-sub unchecked">
          {st(lang, 'machineLooksLike')}{' '}
          {s.items.map((item) => (
            <Link key={item.id} to={href(item.path ?? `/${item.id}`, lang)}>
              {typeName(item.type, lang)}
            </Link>
          ))}
          {s.of ? ` (${s.matched}/${s.of} ${st(lang, 'pagesAlike')})` : ''}
        </p>
      ))}
    </div>
  );
}

function SuggestionCard({ detail, lang, onDone, open }: { detail: Detail; lang: Lang; onDone: () => void; open: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const cs = detail.changeset;
  const when = (iso: string) => new Intl.DateTimeFormat(lang === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'short' }).format(new Date(iso));

  const act = (path: string, body: unknown = {}) => async () => {
    setBusy(true);
    setError(null);
    try {
      await call(`/${cs.id}/${path}`, { method: 'POST', body });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const failed = cs.checks.filter((c) => c.status !== 'pass');
  const lastSendBack = [...detail.reviews].reverse().find((r) => r.verdict === 'send_back');
  return (
    <article className={`suggestion${open ? ' is-focused' : ''}`} id={`s${cs.id}`}>
      <header>
        <h2 className="suggestion-title">{cs.title}</h2>
        <p className="row-sub">
          {detail.names[cs.author] ?? cs.author} · {when(cs.submitted_at ?? cs.created_at)}
          {cs.status !== 'open' ? ` · ${t(lang, `status_${cs.status}`)}` : ''}
        </p>
      </header>
      {detail.entries.map((entry) => {
        const item = { id: entry.entityId, type: entry.type, data: (entry.after ?? entry.before ?? {}) as Record<string, unknown> };
        return (
          <div key={entry.entityId} className="suggestion-item">
            {/* A new item has no page until it is approved. */}
            {entry.before === null ? (
              <strong>{labelOf(item as Parameters<typeof labelOf>[0], lang)}</strong>
            ) : (
              <Link to={href(`/${entry.entityId}`, lang)}>{labelOf(item as Parameters<typeof labelOf>[0], lang)}</Link>
            )}
            {entry.withheld ? (
              <p className="row-sub">{t(lang, 'withheldChange')}</p>
            ) : entry.before === null ? (
              <NewItem data={item.data} files={detail.files} type={entry.type} lang={lang} />
            ) : (
              <ChangeTable changes={entry.changes} lang={lang} />
            )}
            {entry.conflicts.length ? <p className="row-sub">{t(lang, 'changedSince')}</p> : null}
          </div>
        );
      })}
      {cs.description ? <blockquote className="suggestion-note">{cs.description}</blockquote> : null}
      {failed.length ? (
        <ul className="checks">
          {failed.map((c) => (
            <li key={c.check} className={c.status}>
              {c.message}
            </li>
          ))}
        </ul>
      ) : null}
      {lastSendBack?.body && cs.status === 'sent_back' ? (
        <p className="note">
          <b>{detail.names[lastSendBack.reviewer] ?? lastSendBack.reviewer}:</b> {lastSendBack.body}
        </p>
      ) : null}
      {error ? (
        <p className="note" role="alert">
          {error}
        </p>
      ) : null}
      {cs.status === 'open' && detail.mayApprove ? (
        note === null ? (
          <div className="actions">
            <button type="button" onClick={act('approve')} disabled={busy}>
              {t(lang, 'approve')}
            </button>
            <button type="button" className="secondary" onClick={() => setNote('')} disabled={busy}>
              {t(lang, 'sendBack')}
            </button>
          </div>
        ) : (
          <div className="actions send-back">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={t(lang, 'sendBackWhy')} autoFocus />
            <button type="button" onClick={act('send-back', { note })} disabled={busy || !note.trim()}>
              {t(lang, 'sendBack')}
            </button>
            <button type="button" className="secondary" onClick={() => setNote(null)}>
              {t(lang, 'cancel')}
            </button>
          </div>
        )
      ) : null}
      {detail.mine && (cs.status === 'open' || cs.status === 'sent_back') ? (
        <div className="actions">
          <button type="button" className="secondary" onClick={act('withdraw')} disabled={busy}>
            {t(lang, 'withdraw')}
          </button>
        </div>
      ) : null}
    </article>
  );
}

export default function Review() {
  const lang = useLang();
  const account = useAccount();
  const [params] = useSearchParams();
  const focus = Number(params.get('s')) || null;
  const [waiting, setWaiting] = useState<Detail[] | null>(null);
  const [mine, setMine] = useState<Detail[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const details = (list: Suggestion[]) => Promise.all(list.map((s) => call<Detail>(`/${s.id}`)));
      const open = await call<{ suggestions: Suggestion[] }>('?status=open&limit=30');
      setWaiting(await details(open.suggestions));
      if (account) {
        const own = await call<{ suggestions: Suggestion[] }>(`?author=${encodeURIComponent(account.person.id)}&limit=100`);
        // Newest first; those still waiting are already listed above.
        setMine(await details(own.suggestions.filter((s) => s.status !== 'open' && s.status !== 'draft').reverse().slice(0, 10)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [account]);

  useEffect(() => {
    if (account !== undefined) void load();
  }, [account, load]);

  useEffect(() => {
    if (focus && waiting) document.getElementById(`s${focus}`)?.scrollIntoView({ block: 'start' });
  }, [focus, waiting]);

  return (
    <>
      <h1>{t(lang, 'reviewTitle')}</h1>
      <p className="subtitle">{t(lang, 'reviewIntro')}</p>
      {error ? (
        <p className="note" role="alert">
          {error}
        </p>
      ) : null}
      {waiting === null ? <p className="row-sub">{t(lang, 'waiting')}</p> : null}
      {waiting?.length === 0 ? <p>{t(lang, 'nothingWaiting')}</p> : null}
      {waiting?.map((d) => <SuggestionCard key={d.changeset.id} detail={d} lang={lang} onDone={load} open={d.changeset.id === focus} />)}
      {mine.length ? (
        <section>
          <h2 className="section-header">{t(lang, 'yourSuggestions')}</h2>
          {mine.map((d) => (
            <SuggestionCard key={d.changeset.id} detail={d} lang={lang} onDone={load} open={d.changeset.id === focus} />
          ))}
        </section>
      ) : null}
      {account === null ? (
        <p className="note">
          {t(lang, 'reviewSignIn')} <Link to={href('/signin', lang, { return: '/review' })}>{t(lang, 'signIn')}</Link>
        </p>
      ) : null}
    </>
  );
}
