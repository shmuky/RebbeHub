import { useState } from 'react';
import { data, Link } from 'react-router';
import type { Route } from './+types/text';
import { siteOf } from '../lib/context.server.js';
import { langFrom, t, type Lang } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { useAccount } from '../lib/useAccount.js';
import { readHref } from './read.js';

/**
 * A scan's text, page by page (the plan, section 7: "Fix this line").
 * What the machine read is shown as machine reading until a person checks
 * it, line by line; a signed-in reader taps a line, corrects it, and it
 * goes for review. Beside it, the scan itself at the same page.
 *
 * A search hit opens here at its line (`?line=`), lit up and in view.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const found = url.searchParams.get('line');
  const scan = await api.entity(params.scan);
  if (!scan || scan.type !== 'scan') throw data('not found', { status: 404 });
  const d = scan.data as { publication?: string; file?: string };
  const [text, publication, file] = await Promise.all([
    api.scanText(scan.id, page),
    d.publication ? api.entity(d.publication) : null,
    d.file ? api.file(d.file) : null,
  ]);
  return { lang, siteUrl, scan, page, text, publication, fileUrl: file?.url ?? null, found };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { lang, siteUrl, scan, page, publication } = loaderData;
  const name = publication ? labelOf(publication, lang) : labelOf(scan, lang);
  return pageMeta({ title: `${name} · ${t(lang, 'page')} ${page}`, path: `/text/${scan.id}?page=${page}`, lang, siteUrl, noindex: true });
}

function Line({ scan, page, line, lang, canFix, found }: { scan: string; page: number; line: { id: string; text: string; checked: boolean }; lang: Lang; canFix: boolean; found: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setState('busy');
    setError(null);
    const response = await fetch(`/_/steward/scans/${scan}/text/fix`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ page, line: line.id, text: editing }),
    });
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) {
      setState('idle');
      return setError(body.message ?? response.statusText);
    }
    setState('sent');
    setEditing(null);
  }

  if (editing !== null)
    return (
      <li id={`line-${line.id}`} className="text-line editing">
        <form onSubmit={send}>
          <input value={editing} onChange={(e) => setEditing(e.target.value)} dir="rtl" autoFocus />
          <button type="submit" disabled={state === 'busy' || !editing.trim() || editing.trim() === line.text}>
            {t(lang, 'sendForReview')}
          </button>
          <button type="button" className="secondary" onClick={() => setEditing(null)}>
            {t(lang, 'cancel')}
          </button>
        </form>
        {error ? <p role="alert">{error}</p> : null}
      </li>
    );
  return (
    <li id={`line-${line.id}`} className={['text-line', line.checked ? '' : 'unchecked', found ? 'found' : ''].filter(Boolean).join(' ')} aria-current={found ? 'true' : undefined}>
      <span dir="rtl">{found ? <mark>{line.text}</mark> : line.text}</span>
      {state === 'sent' ? <span className="row-sub"> · {t(lang, 'lineSent')}</span> : null}
      {canFix && state !== 'sent' ? (
        <button type="button" className="link-button" onClick={() => setEditing(line.text)} aria-label={t(lang, 'fixLine')}>
          {t(lang, 'fixLine')}
        </button>
      ) : null}
    </li>
  );
}

export default function Text({ loaderData }: Route.ComponentProps) {
  const { lang, scan, page, text, publication, fileUrl, found } = loaderData;
  const account = useAccount();
  const to = (p: number) => href(`/text/${scan.id}`, lang, { page: String(p) });
  const unchecked = text ? text.lines.filter((l) => !l.checked).length : 0;
  return (
    <>
      <ol className="breadcrumbs">
        {publication ? (
          <li>
            <Link to={href(itemPath(publication), lang)}>{labelOf(publication, lang)}</Link>
          </li>
        ) : null}
      </ol>
      <h1>
        {t(lang, 'textOfScan')} · {t(lang, 'page')} {page}
      </h1>
      {!text ? (
        <p className="note">{t(lang, 'notReadYet')}</p>
      ) : (
        <>
          {unchecked ? (
            <p className="note machine-note">
              <strong>{t(lang, 'machineReading')}</strong>
              {text.engine ? ` (${text.engine.name} ${text.engine.version})` : ''} · {unchecked} {t(lang, 'linesUnchecked')}. {t(lang, 'machineText')}
            </p>
          ) : null}
          <nav className="pager">
            {page > 1 ? <Link to={to(page - 1)}>{t(lang, 'previousPage')}</Link> : <span />}
            <span className="row-sub">
              {page} / {text.pages}
            </span>
            {page < text.pages ? <Link to={to(page + 1)}>{t(lang, 'nextPage')}</Link> : <span />}
          </nav>
          <ol className="text-lines">
            {text.lines.map((line) => (
              <Line key={line.id} scan={scan.id} page={page} line={line} lang={lang} canFix={Boolean(account)} found={line.id === found} />
            ))}
          </ol>
          {account === null ? (
            <p className="row-sub">
              {t(lang, 'fixLineSignIn')} <Link to={href('/signin', lang, { return: `/text/${scan.id}?page=${page}` })}>{t(lang, 'signIn')}</Link>
            </p>
          ) : null}
        </>
      )}
      {fileUrl ? (
        <p>
          <Link to={readHref({ url: fileUrl, title: publication ? labelOf(publication, lang) : t(lang, 'textOfScan'), page }, lang)}>{t(lang, 'openScanAtPage')}</Link>
        </p>
      ) : null}
    </>
  );
}
