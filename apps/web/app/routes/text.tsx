import { useState } from 'react';
import { data, Link } from 'react-router';
import type { Route } from './+types/text';
import type { ScanText } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, t, type Lang } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { postJson } from '../lib/post.js';
import { pageMeta } from '../lib/seo.js';
import { useAccount } from '../lib/useAccount.js';
import { readHref } from './read.js';

/**
 * A scan's text, page by page (the plan, section 7: "Fix this line").
 * What the machine read is shown as machine reading until a person checks
 * it, line by line; a signed-in reader taps a line, corrects it, and it
 * goes for review. Pages change colour as they are checked: the strip of
 * pages shows which are not yet proofread, proofread once, and twice, and
 * "This page is right" raises a page a level. Beside it, the scan itself
 * at the same page, the text's layers (the machine's, and OCR people
 * uploaded, the keepers' pick marked), and a form to upload one's own.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const page = Math.max(1, Number(new URL(request.url).searchParams.get('page')) || 1);
  const scan = await api.entity(params.scan);
  if (!scan || scan.type !== 'scan') throw data('not found', { status: 404 });
  const d = scan.data as { publication?: string; file?: string };
  const [text, progress, publication, file] = await Promise.all([
    api.scanText(scan.id, page),
    api.scanProgress(scan.id),
    d.publication ? api.entity(d.publication) : null,
    d.file ? api.file(d.file) : null,
  ]);
  return { lang, siteUrl, scan, page, text, levels: progress?.levels ?? [], publication, fileUrl: file?.url ?? null };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { lang, siteUrl, scan, page, publication } = loaderData;
  const name = publication ? labelOf(publication, lang) : labelOf(scan, lang);
  return pageMeta({ title: `${name} · ${t(lang, 'page')} ${page}`, path: `/text/${scan.id}?page=${page}`, lang, siteUrl, noindex: true });
}

const LEVEL_NAMES = ['proofread0', 'proofread1', 'proofread2'] as const;

function Line({ scan, page, line, lang, canFix }: { scan: string; page: number; line: ScanText['lines'][number]; lang: Lang; canFix: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setState('busy');
    setError(null);
    try {
      await postJson(`scans/${scan}/text/fix`, { page, line: line.id, text: editing });
      setState('sent');
      setEditing(null);
    } catch (e) {
      setState('idle');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (editing !== null)
    return (
      <li className="text-line editing">
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
  const level = line.level ?? (line.checked ? 1 : 0);
  return (
    <li className={`text-line level-${level}${level === 0 ? ' unchecked' : ''}`} title={t(lang, LEVEL_NAMES[level])}>
      <span dir="rtl">{line.text}</span>
      {state === 'sent' ? <span className="row-sub"> · {t(lang, 'lineSent')}</span> : null}
      {canFix && state !== 'sent' ? (
        <button type="button" className="link-button" onClick={() => setEditing(line.text)} aria-label={t(lang, 'fixLine')}>
          {t(lang, 'fixLine')}
        </button>
      ) : null}
    </li>
  );
}

/** The scan's pages as a strip, each in the colour of how far it is proofread. */
function PageStrip({ scan, page, levels, lang }: { scan: string; page: number; levels: Array<0 | 1 | 2>; lang: Lang }) {
  if (levels.length < 2) return null;
  const count = (level: number) => levels.filter((l) => l === level).length;
  return (
    <section className="page-strip-box" aria-label={t(lang, 'pagesOfScan')}>
      <ol className="page-strip">
        {levels.map((level, i) => (
          <li key={i}>
            <Link
              to={href(`/text/${scan}`, lang, { page: String(i + 1) })}
              className={`level-${level}${i + 1 === page ? ' current' : ''}`}
              aria-current={i + 1 === page ? 'page' : undefined}
              title={`${t(lang, 'page')} ${i + 1}: ${t(lang, LEVEL_NAMES[level])}`}
            >
              {i + 1}
            </Link>
          </li>
        ))}
      </ol>
      <p className="page-legend row-sub">
        {[0, 1, 2].map((level) => (
          <span key={level}>
            <span className={`swatch level-${level}`} aria-hidden="true" /> {t(lang, LEVEL_NAMES[level as 0 | 1 | 2])} ({count(level)})
          </span>
        ))}
      </p>
    </section>
  );
}

function ConfirmPage({ scan, page, level, lang }: { scan: string; page: number; level: 0 | 1 | 2; lang: Lang }) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  if (level >= 2) return null;
  if (state === 'sent') return <p className="row-sub">{t(lang, 'pageSent')}</p>;
  return (
    <div className="confirm-page">
      <button
        type="button"
        disabled={state === 'busy'}
        onClick={async () => {
          setState('busy');
          setError(null);
          try {
            await postJson(`scans/${scan}/text/confirm`, { page });
            setState('sent');
          } catch (e) {
            setState('idle');
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        {t(lang, 'pageIsRight')}
      </button>
      <span className="row-sub"> {t(lang, 'pageIsRightHint')}</span>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

function Layers({ scan, layers, lang, signedIn }: { scan: string; layers: ScanText['layers']; lang: Lang; signedIn: boolean }) {
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ocr = layers.filter((l) => l.kind !== 'community');
  if (ocr.length < 2 && !signedIn) return null;
  return (
    <section>
      <h2 className="section-header">{t(lang, 'textLayers')}</h2>
      <ul className="rows">
        {ocr.map((l) => (
          <li key={l.id} className="row">
            <span className="row-main">
              <span className="row-title">
                {t(lang, l.kind === 'machine-ocr' ? 'layer_machine' : 'layer_uploaded')}
                {l.engine ? ` · ${l.engine.name} ${l.engine.version}` : ''}
              </span>
              <span className="row-sub">{l.seeds ? t(lang, 'layerSeeds') : sent === l.id ? t(lang, 'seedSent') : ''}</span>
            </span>
            {signedIn && !l.seeds && sent !== l.id ? (
              <button
                type="button"
                className="link-button"
                onClick={async () => {
                  setError(null);
                  try {
                    await postJson(`scans/${scan}/text/seed`, { layer: l.id });
                    setSent(l.id);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                {t(lang, 'seedFromThis')}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

function UploadOcr({ scan, lang }: { scan: string; lang: Lang }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [firstPage, setFirstPage] = useState('1');
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    setState('busy');
    setError(null);
    try {
      const content = await file.text();
      await postJson(`scans/${scan}/ocr`, { content, engine: { name, version }, firstPage: Number(firstPage) || 1 });
      setState('sent');
    } catch (e) {
      setState('idle');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <details className="report">
      <summary>{t(lang, 'uploadOcr')}</summary>
      {state === 'sent' ? (
        <p>{t(lang, 'ocrUploaded')}</p>
      ) : (
        <form onSubmit={send}>
          <p className="row-sub">{t(lang, 'uploadOcrIntro')}</p>
          <label>
            {t(lang, 'ocrFile')}
            <input type="file" accept=".hocr,.html,.htm,.xml,.txt,text/html,text/xml,application/xml,text/plain" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
          </label>
          <label>
            {t(lang, 'ocrEngine')}
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} dir="ltr" placeholder="ABBYY FineReader" />
          </label>
          <label>
            {t(lang, 'ocrVersion')}
            <input value={version} onChange={(e) => setVersion(e.target.value)} required maxLength={40} dir="ltr" placeholder="16" />
          </label>
          <label>
            {t(lang, 'ocrFirstPage')}
            <input value={firstPage} onChange={(e) => setFirstPage(e.target.value)} inputMode="numeric" dir="ltr" />
          </label>
          {error ? <p role="alert">{error}</p> : null}
          <div>
            <button type="submit" disabled={state === 'busy' || !file || !name.trim() || !version.trim()}>
              {t(lang, 'send')}
            </button>
          </div>
        </form>
      )}
    </details>
  );
}

export default function Text({ loaderData }: Route.ComponentProps) {
  const { lang, scan, page, text, levels, publication, fileUrl } = loaderData;
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
          <PageStrip scan={scan.id} page={page} levels={levels} lang={lang} />
          <nav className="pager">
            {page > 1 ? <Link to={to(page - 1)}>{t(lang, 'previousPage')}</Link> : <span />}
            <span className={`row-sub page-level level-${text.level ?? 0}`}>
              {page} / {text.pages} · {t(lang, LEVEL_NAMES[text.level ?? 0])}
            </span>
            {page < text.pages ? <Link to={to(page + 1)}>{t(lang, 'nextPage')}</Link> : <span />}
          </nav>
          <ol className="text-lines">
            {text.lines.map((line) => (
              <Line key={line.id} scan={scan.id} page={page} line={line} lang={lang} canFix={Boolean(account)} />
            ))}
          </ol>
          {account ? <ConfirmPage key={page} scan={scan.id} page={page} level={text.level ?? 0} lang={lang} /> : null}
          {account === null ? (
            <p className="row-sub">
              {t(lang, 'fixLineSignIn')} <Link to={href('/signin', lang, { return: `/text/${scan.id}?page=${page}` })}>{t(lang, 'signIn')}</Link>
            </p>
          ) : null}
          <Layers scan={scan.id} layers={text.layers ?? []} lang={lang} signedIn={Boolean(account)} />
        </>
      )}
      {fileUrl ? (
        <p>
          <Link to={readHref({ url: fileUrl, title: publication ? labelOf(publication, lang) : t(lang, 'textOfScan'), page }, lang)}>{t(lang, 'openScanAtPage')}</Link>
        </p>
      ) : null}
      {account ? <UploadOcr scan={scan.id} lang={lang} /> : null}
    </>
  );
}
