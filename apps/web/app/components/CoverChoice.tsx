import { useState } from 'react';
import { Link } from 'react-router';
import type { Entity, WorkCover } from '../lib/api.js';
import { href } from '../lib/links.js';
import type { Lang } from '../lib/i18n.js';
import { ps } from '../lib/pageStrings.js';
import { useAccount } from '../lib/useAccount.js';

/**
 * A sefer's cover as its page says it: which page of which PDF it is, and
 * whether a machine or a person chose it; and "Choose another page as the
 * title page", a Suggestion that sets the sefer's `cover` for its keepers
 * to approve. The jobs draw the page a person chose (`rebbehub covers`).
 */
export function CoverChoice({ work, cover, lang }: { work: Pick<Entity, 'id' | 'path' | 'data'>; cover: WorkCover; lang: Lang }) {
  const account = useAccount();
  const [file, setFile] = useState(cover.chosen?.file ?? cover.cover?.file ?? cover.sources[0]?.sha256 ?? '');
  const [page, setPage] = useState(String(cover.chosen?.page ?? cover.cover?.page ?? 1));
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!cover.cover && !cover.sources.length) return null;
  const pages = cover.sources.find((s) => s.sha256 === file)?.pages ?? null;

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/_/suggestions/quick', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ entityId: work.id, data: { ...(work.data as object), cover: { file, page: Number(page) } }, title: `${ps(lang, 'chooseCover')}: ${ps(lang, 'pageNumber')} ${page}` }),
      });
      const body = (await response.json().catch(() => ({}))) as { id?: number; message?: string };
      if (!response.ok) throw new Error(body.message ?? response.statusText);
      setSent(body.id!);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const here = work.path ?? `/${work.id}`;
  return (
    <div className="cover-choice">
      {cover.cover ? (
        <p className="row-sub">
          {ps(lang, 'coverFrom')} {cover.cover.page} (<Link to={href(`/files/${cover.cover.file}`, lang)}>PDF</Link>) · {cover.cover.machine ? ps(lang, 'coverMachine') : ps(lang, 'coverPerson')}
          {cover.cover.credit ? ` · ${cover.cover.credit}` : ''}
        </p>
      ) : null}
      {cover.sources.length ? (
        <details className="report" id="cover">
          <summary>{ps(lang, 'chooseCover')}</summary>
          {account === null ? (
            <p>
              <Link to={href('/signin', lang, { return: `${here}#cover` })}>{ps(lang, 'signInToAdd')}</Link>
            </p>
          ) : sent !== null ? (
            <p role="status">
              {ps(lang, 'sent')} <Link to={href('/review', lang, { s: String(sent) })}>#{sent}</Link>
            </p>
          ) : (
            <form onSubmit={send}>
              <p>{ps(lang, 'chooseCoverHow')}</p>
              <label>
                PDF
                <select value={file} onChange={(e) => setFile(e.target.value)}>
                  {cover.sources.map((s) => (
                    <option key={s.sha256} value={s.sha256}>
                      {s.sha256.slice(0, 12)}
                      {s.pages ? ` · ${s.pages} ${ps(lang, 'pages')}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {ps(lang, 'pageNumber')}
                <input type="number" min={1} max={pages ?? 100000} value={page} onChange={(e) => setPage(e.target.value)} required />
              </label>
              <button type="submit" disabled={busy || !file}>
                {ps(lang, 'send')}
              </button>
              {error ? <p role="alert">{`${ps(lang, 'failed')} ${error}`}</p> : null}
            </form>
          )}
        </details>
      ) : null}
    </div>
  );
}
