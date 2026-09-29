import { useState } from 'react';
import { data, Link } from 'react-router';
import type { Route } from './+types/text';
import type { ScanPages, ScanText } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, t, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { postJson } from '../lib/post.js';
import { pageMeta } from '../lib/seo.js';
import { useAccount } from '../lib/useAccount.js';
import { Icon } from '../ui/Icon.js';
import { Breadcrumbs, EmptyState, MachineLabel, MachineNote, Panel, StatusBadge, cx } from '../ui/primitives.js';
import { PageThumb } from '../ui/Shaar.js';
import { readHref } from './read.js';
import '../styles/pages/text.css';

/**
 * A scan's text, page by page (the plan, section 7: "Fix this line").
 * The page of the scan and the lines read from it sit side by side, so a
 * line is checked against the page itself. What the machine read is shown
 * as machine reading until a person checks it, line by line; a signed-in
 * reader taps a line, corrects it, and it goes for review. Pages change
 * colour as they are checked: the strip of pages shows which are not yet
 * proofread, proofread once, and twice, and "This page is right" raises a
 * page a level. Beneath, the text's layers (the machine's, and OCR people
 * uploaded, the keepers' pick marked), and a form to upload one's own.
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
  const [text, progress, publication, file, images] = await Promise.all([
    api.scanText(scan.id, page),
    api.scanProgress(scan.id),
    d.publication ? api.entity(d.publication) : null,
    d.file ? api.file(d.file) : null,
    api.scanPages(scan.id).catch(() => null as ScanPages | null),
  ]);
  const image = images?.pages.find((p) => p.page === page) ?? null;
  return { lang, siteUrl, scan, page, text, levels: progress?.levels ?? [], publication, fileUrl: file?.url ?? null, found, image, pageCount: images?.pages.length ?? null };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { lang, siteUrl, scan, page, publication } = loaderData;
  const name = publication ? labelOf(publication, lang) : labelOf(scan, lang);
  return pageMeta({ title: `${name} · ${t(lang, 'page')} ${page}`, path: `/text/${scan.id}?page=${page}`, lang, siteUrl, noindex: true });
}

const LEVEL_NAMES = ['proofread0', 'proofread1', 'proofread2'] as const;

const W = {
  lede: { he: 'הסריקה והטקסט שנקרא ממנה, זה מול זה. כל שורה שקריאת המכונה שלה לא נבדקה מסומנת; אפשר לתקן שורה, והתיקון נשלח לבדיקה.', en: 'The scan and the text read from it, side by side. Every line whose machine reading nobody checked is marked; fix a line and the fix goes for review.' },
  pageOf: { he: 'מתוך', en: 'of' },
  scanOfPage: { he: 'הסריקה', en: 'The scan' },
  linesOfPage: { he: 'שורות העמוד', en: 'The page’s lines' },
  lines: { he: 'שורות', en: 'lines' },
  readScan: { he: 'קריאה', en: 'Read' },
  noImage: { he: 'לעמוד הזה עוד אין תמונה. אפשר לפתוח את הסריקה עצמה בעמוד הזה.', en: 'This page has no image yet. The scan itself can be opened at this page.' },
  checkedLine: { he: 'נבדקה', en: 'checked' },
  checkedTwice: { he: 'נבדקה פעמיים', en: 'checked twice' },
  strip: { he: 'הגהה לפי עמודים', en: 'Proofreading by page' },
  legend: { he: 'מקרא', en: 'Legend' },
  engine: { he: 'קריאה', en: 'Read by' },
  uploadHint: { he: 'hOCR, ALTO או טקסט, עמוד אחר עמוד', en: 'hOCR, ALTO or text, page by page' },
  layersHint: { he: 'מכונה, העלאות, והנבחרת', en: 'machine, uploads, and the chosen one' },
  seedsBadge: { he: 'נבחרה', en: 'Chosen' },
  signInToFix: { he: 'כניסה לתיקון שורות', en: 'Sign in to fix lines' },
  lineN: { he: 'שורה', en: 'Line' },
} as const;

const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

function Line({ n, scan, page, line, lang, canFix, found }: { n: number; scan: string; page: number; line: ScanText['lines'][number]; lang: Lang; canFix: boolean; found: boolean }) {
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
      <li id={`line-${line.id}`} className="text-line editing">
        <span className="ln">{n}</span>
        <form onSubmit={send} className="line-form">
          <input className="input torah" value={editing} onChange={(e) => setEditing(e.target.value)} dir="rtl" autoFocus aria-label={`${w(lang, 'lineN')} ${n}`} />
          <div className="btn-row">
            <button className="btn primary sm" type="submit" disabled={state === 'busy' || !editing.trim() || editing.trim() === line.text}>
              <Icon name="suggest" />
              {t(lang, 'sendForReview')}
            </button>
            <button type="button" className="btn sm" onClick={() => setEditing(null)}>
              {t(lang, 'cancel')}
            </button>
          </div>
          {error ? (
            <p className="alert negative" role="alert">
              <Icon name="warn" />
              {error}
            </p>
          ) : null}
        </form>
      </li>
    );
  const level = line.level ?? (line.checked ? 1 : 0);
  return (
    <li id={`line-${line.id}`} className={`text-line level-${level}${level === 0 ? ' unchecked' : ''}${found ? ' found' : ''}`} title={t(lang, LEVEL_NAMES[level])} aria-current={found ? 'true' : undefined}>
      <span className="ln">{n}</span>
      <span className="lt torah" dir="rtl">
        {found ? <mark>{line.text}</mark> : line.text}
      </span>
      <span className="lm">
        {state === 'sent' ? (
          <span className="sent">
            <Icon name="suggest" size={14} />
            {t(lang, 'lineSent')}
          </span>
        ) : level > 0 ? (
          <Icon name="check" size={14} className={level === 2 ? 'twice' : 'once'} label={level === 2 ? w(lang, 'checkedTwice') : w(lang, 'checkedLine')} />
        ) : null}
        {canFix && state !== 'sent' ? (
          <button type="button" className="btn ghost sm fix" onClick={() => setEditing(line.text)} aria-label={`${t(lang, 'fixLine')}: ${w(lang, 'lineN')} ${n}`} title={t(lang, 'fixLine')}>
            <Icon name="pencil" size={14} />
            <span className="fix-word">{t(lang, 'fixLine')}</span>
          </button>
        ) : null}
      </span>
    </li>
  );
}

/** The scan's pages as squares, each in the colour of how far it is proofread; the page shown is ringed. */
function PageStrip({ scan, page, levels, lang }: { scan: string; page: number; levels: Array<0 | 1 | 2>; lang: Lang }) {
  if (levels.length < 2) return null;
  const count = (level: number) => levels.filter((l) => l === level).length;
  const numbered = levels.length <= 80;
  return (
    <section className="box page-strip-box" aria-label={t(lang, 'pagesOfScan')}>
      <div className="box-h">
        <Icon name="layers" className="subtle" />
        {w(lang, 'strip')}
        <span className="end strip-legend">
          {[0, 1, 2].map((level) => (
            <span key={level}>
              <i className={`sw level-${level}`} aria-hidden="true" />
              {t(lang, LEVEL_NAMES[level as 0 | 1 | 2])} <span className="subtle">{num(count(level), lang)}</span>
            </span>
          ))}
        </span>
      </div>
      <ol className={cx('page-strip', numbered && 'numbered')}>
        {levels.map((level, i) => (
          <li key={i}>
            <Link
              to={href(`/text/${scan}`, lang, { page: String(i + 1) })}
              className={`level-${level}${i + 1 === page ? ' current' : ''}`}
              aria-current={i + 1 === page ? 'page' : undefined}
              title={`${t(lang, 'page')} ${i + 1}: ${t(lang, LEVEL_NAMES[level])}`}
              preventScrollReset
            >
              {numbered ? i + 1 : <span className="visually-hidden">{i + 1}</span>}
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ConfirmPage({ scan, page, level, lang }: { scan: string; page: number; level: 0 | 1 | 2; lang: Lang }) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  if (level >= 2) return null;
  if (state === 'sent')
    return (
      <div className="box-f confirm-page">
        <Icon name="check" className="ok" />
        <span>{t(lang, 'pageSent')}</span>
      </div>
    );
  return (
    <div className="box-f confirm-page">
      <button
        type="button"
        className="btn approve sm"
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
        <Icon name="check" />
        {t(lang, 'pageIsRight')}
      </button>
      <span className="subtle">{t(lang, 'pageIsRightHint')}</span>
      {error ? (
        <span className="alert negative" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

function Layers({ scan, layers, lang, signedIn }: { scan: string; layers: ScanText['layers']; lang: Lang; signedIn: boolean }) {
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ocr = layers.filter((l) => l.kind !== 'community');
  if (ocr.length < 2 && !signedIn) return null;
  return (
    <Panel id="layers" icon="layers" title={t(lang, 'textLayers')} hint={`${num(ocr.length, lang)} · ${w(lang, 'layersHint')}`} open>
      <ul className="box layer-rows">
        {ocr.map((l) => (
          <li key={l.id} className="row">
            <Icon name={l.kind === 'machine-ocr' ? 'bot' : 'upload'} className="subtle" />
            <span className="row-main">
              <span className="row-title">
                {t(lang, l.kind === 'machine-ocr' ? 'layer_machine' : 'layer_uploaded')}
                {l.engine ? <span className="mono subtle"> · {`${l.engine.name} ${l.engine.version}`}</span> : null}
              </span>
              {l.seeds || sent === l.id ? <span className="row-sub">{l.seeds ? t(lang, 'layerSeeds') : t(lang, 'seedSent')}</span> : null}
            </span>
            {l.seeds ? (
              <StatusBadge state="open" size="sm" icon="check">
                {w(lang, 'seedsBadge')}
              </StatusBadge>
            ) : l.kind === 'machine-ocr' ? (
              <MachineLabel lang={lang} size="sm" />
            ) : null}
            {signedIn && !l.seeds && sent !== l.id ? (
              <button
                type="button"
                className="btn sm"
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
      {error ? (
        <p className="alert negative" role="alert">
          <Icon name="warn" />
          {error}
        </p>
      ) : null}
    </Panel>
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
    <Panel id="upload-ocr" icon="upload" title={t(lang, 'uploadOcr')} hint={w(lang, 'uploadHint')}>
      {state === 'sent' ? (
        <p className="alert positive" role="status">
          <Icon name="check" />
          {t(lang, 'ocrUploaded')}
        </p>
      ) : (
        <form onSubmit={send} className="form stack">
          <p className="subtle">{t(lang, 'uploadOcrIntro')}</p>
          <label className="field">
            <span>{t(lang, 'ocrFile')}</span>
            <input type="file" accept=".hocr,.html,.htm,.xml,.txt,text/html,text/xml,application/xml,text/plain" onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
          </label>
          <div className="form-row ocr-fields">
            <label className="field">
              <span>{t(lang, 'ocrEngine')}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} dir="ltr" placeholder="ABBYY FineReader" />
            </label>
            <label className="field">
              <span>{t(lang, 'ocrVersion')}</span>
              <input value={version} onChange={(e) => setVersion(e.target.value)} required maxLength={40} dir="ltr" placeholder="16" />
            </label>
            <label className="field">
              <span>{t(lang, 'ocrFirstPage')}</span>
              <input value={firstPage} onChange={(e) => setFirstPage(e.target.value)} inputMode="numeric" dir="ltr" />
            </label>
          </div>
          {error ? (
            <p className="alert negative" role="alert">
              <Icon name="warn" />
              {error}
            </p>
          ) : null}
          <div className="form-actions">
            <button type="submit" className="btn primary" disabled={state === 'busy' || !file || !name.trim() || !version.trim()}>
              <Icon name="upload" />
              {t(lang, 'send')}
            </button>
          </div>
        </form>
      )}
    </Panel>
  );
}

export default function Text({ loaderData }: Route.ComponentProps) {
  const { lang, scan, page, text, levels, publication, fileUrl, found, image, pageCount } = loaderData;
  const account = useAccount();
  const to = (p: number) => href(`/text/${scan.id}`, lang, { page: String(p) });
  const unchecked = text ? text.lines.filter((l) => !l.checked).length : 0;
  const pages = text?.pages ?? pageCount ?? levels.length;
  const name = publication ? labelOf(publication, lang) : t(lang, 'textOfScan');
  const reader = fileUrl ? readHref({ url: fileUrl, title: name, page }, lang) : null;
  const level = text?.level ?? 0;
  return (
    <div className="text-page">
      <div className="phead">
        <div className="wrap">
          <Breadcrumbs lang={lang} items={[...(publication ? [{ label: labelOf(publication, lang), to: href(itemPath(publication), lang) }] : []), { label: t(lang, 'textOfScan') }]} />
          <div className="phead-row">
            <div>
              <h1 className="page-title torah">
                {name} <span className="num">· {t(lang, 'page')} {num(page, lang)}</span>
              </h1>
              <p className="lede">{w(lang, 'lede')}</p>
            </div>
            <div className="phead-acts">
              {reader ? (
                <Link className="btn" to={reader}>
                  <Icon name="book" />
                  {w(lang, 'readScan')}
                </Link>
              ) : null}
              <nav className="btn-group" aria-label={t(lang, 'pagesOfScan')}>
                {page > 1 ? (
                  <Link className="btn" to={to(page - 1)} rel="prev" aria-label={t(lang, 'previousPage')} title={t(lang, 'previousPage')}>
                    <Icon name="chevr" className="flip-ltr" />
                  </Link>
                ) : (
                  <span className="btn" aria-disabled="true">
                    <Icon name="chevr" className="flip-ltr" />
                  </span>
                )}
                <span className="btn-mid">
                  {num(page, lang)} {pages ? `${w(lang, 'pageOf')} ${num(pages, lang)}` : ''}
                </span>
                {!pages || page < pages ? (
                  <Link className="btn" to={to(page + 1)} rel="next" aria-label={t(lang, 'nextPage')} title={t(lang, 'nextPage')}>
                    <Icon name="chev" className="flip-ltr" />
                  </Link>
                ) : (
                  <span className="btn" aria-disabled="true">
                    <Icon name="chev" className="flip-ltr" />
                  </span>
                )}
              </nav>
            </div>
          </div>
          {text ? (
            <div className="facts-row">
              <span>
                <StatusBadge state={level === 0 ? 'neutral' : 'approved'} size="sm" icon={level === 0 ? 'dot' : 'check'}>
                  {t(lang, LEVEL_NAMES[level])}
                </StatusBadge>
              </span>
              <span>
                <Icon name="file" className="subtle" />
                <span>
                  <b>{num(text.lines.length, lang)}</b> {w(lang, 'lines')}
                </span>
              </span>
              {text.engine ? (
                <span>
                  <Icon name="bot" className="subtle" />
                  <span>
                    {w(lang, 'engine')}: <b className="mono">{`${text.engine.name} ${text.engine.version}`}</b>
                  </span>
                </span>
              ) : null}
              {unchecked ? (
                <span>
                  <MachineLabel lang={lang} size="sm">
                    {num(unchecked, lang)} {t(lang, 'linesUnchecked')}
                  </MachineLabel>
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="phead-pad" />
        </div>
      </div>

      <div className="wrap page stack">
        {!text ? (
          <EmptyState icon="scan" title={t(lang, 'notReadYet')} actions={reader ? <Link className="btn" to={reader}>{t(lang, 'openScanAtPage')}</Link> : undefined} />
        ) : (
          <>
            {unchecked ? (
              <MachineNote>
                <b>{t(lang, 'machineReading')}</b>
                {text.engine ? ` (${text.engine.name} ${text.engine.version})` : ''} · {num(unchecked, lang)} {t(lang, 'linesUnchecked')}. {t(lang, 'machineText')}
              </MachineNote>
            ) : null}
            <PageStrip scan={scan.id} page={page} levels={levels} lang={lang} />
            <div className="text-split">
              <figure className="box scan-side">
                <figcaption className="box-h">
                  <Icon name="scan" className="subtle" />
                  {w(lang, 'scanOfPage')}
                  <span className="end">
                    {reader ? (
                      <Link to={reader} className="small">
                        {t(lang, 'openScanAtPage')}
                      </Link>
                    ) : null}
                  </span>
                </figcaption>
                {image ? (
                  <div className="scan-img">
                    <img src={image.image} width={image.width} height={image.height} alt={`${name}, ${t(lang, 'page')} ${page}`} />
                  </div>
                ) : (
                  <div className="scan-none">
                    <PageThumb seed={page} />
                    <p className="subtle">{w(lang, 'noImage')}</p>
                  </div>
                )}
              </figure>
              <section className="box lines-side" aria-labelledby="lines-h">
                <div className="box-h">
                  <Icon name="file" className="subtle" />
                  <span id="lines-h">{w(lang, 'linesOfPage')}</span>
                  <span className="end">{unchecked ? <MachineLabel lang={lang} size="sm" /> : null}</span>
                </div>
                <ol className="text-lines">
                  {text.lines.map((line, i) => (
                    <Line key={line.id} n={i + 1} scan={scan.id} page={page} line={line} lang={lang} canFix={Boolean(account)} found={line.id === found} />
                  ))}
                </ol>
                {account ? <ConfirmPage key={page} scan={scan.id} page={page} level={level} lang={lang} /> : null}
                {account === null ? (
                  <div className="box-f">
                    <Icon name="lock" className="subtle" />
                    <span className="subtle">{t(lang, 'fixLineSignIn')}</span>
                    <Link className="btn sm end-btn" to={href('/signin', lang, { return: `/text/${scan.id}?page=${page}` })}>
                      {t(lang, 'signIn')}
                    </Link>
                  </div>
                ) : null}
              </section>
            </div>
            <div className="panels">
              <Layers scan={scan.id} layers={text.layers ?? []} lang={lang} signedIn={Boolean(account)} />
              {account ? <UploadOcr scan={scan.id} lang={lang} /> : null}
            </div>
          </>
        )}
        {!text && account ? (
          <div className="panels">
            <UploadOcr scan={scan.id} lang={lang} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
