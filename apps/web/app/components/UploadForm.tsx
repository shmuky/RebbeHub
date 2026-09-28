import { useState } from 'react';
import { Link } from 'react-router';
import type { Entity } from '../lib/api.js';
import { nameOf, t, type Lang } from '../lib/i18n.js';
import { href, itemPath } from '../lib/links.js';
import { st } from '../lib/scanStrings.js';
import { useAccount } from '../lib/useAccount.js';

/**
 * "Add a recording" to a farbrengen, "Add a scan" to a sefer, a printing
 * or the Teshuros set (the plan, section 7): pick the file, say what it is
 * and what you know of its rights, send. For a scan the browser first
 * measures the file (its sha256, a dozen pages' hashes) and the server
 * says whether we have it already, and guesses what it is - another scan
 * of a printing, a new printing, or a new teshura - for the person to
 * confirm ("uploads guess first and ask second"). The server keeps the
 * file where its rights put it and sends a suggestion for review.
 */

const RIGHTS = ['mine', 'free', 'public-domain', 'unsure'] as const;
type Rights = (typeof RIGHTS)[number];
type Kind = 'scan-of' | 'printing' | 'teshura';

type Result = { existed: true; usedBy: Array<{ id: string; type: string; path: string | null }> } | { existed: false; served: boolean; suggestion: number };

interface Printing {
  id: string;
  path: string | null;
  kind?: string;
  title?: { he: string; en?: string };
  publisher: string | null;
  date: string | null;
  gregorianYear: number | null;
  printing: number | null;
}

interface Check {
  proposal:
    | { as: 'existing'; usedBy: Array<{ id: string; type: string; path: string | null }> }
    | { as: 'duplicate'; scan: string; publication: string | null; matched: number; of: number }
    | { as: 'scan-of'; reason: string; publication: string }
    | { as: 'teshura'; reason: string }
    | { as: 'printing'; reason: string };
  similar: Array<{ kind: 'same' | 'shares'; matched?: number; of?: number; items: Array<{ id: string; type: string; path: string | null; publication: string | null }> }>;
  publications: Printing[];
}

const itemHref = (item: { id: string; path: string | null }, lang: Lang) => href(itemPath({ id: item.id, path: item.path } as Entity), lang);

export function UploadForm({ entity, lang, teshuros = false }: { entity: Pick<Entity, 'id' | 'type' | 'path' | 'data'>; lang: Lang; teshuros?: boolean }) {
  const account = useAccount();
  const what = entity.type === 'event' ? 'recording' : 'scan';
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [rights, setRights] = useState<Rights | null>(null);
  const [kind, setKind] = useState<Kind>(teshuros ? 'teshura' : entity.type === 'publication' ? 'scan-of' : 'printing');
  const [publication, setPublication] = useState(entity.type === 'publication' ? entity.id : '');
  const [fields, setFields] = useState({ publisher: '', year: '', printing: '', families: '', date: '' });
  const [check, setCheck] = useState<Check | null>(null);
  const [checking, setChecking] = useState(false);
  const [goOn, setGoOn] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const field = (name: keyof typeof fields) => ({ value: fields[name], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFields({ ...fields, [name]: e.target.value }) });

  /** Measures the chosen PDF in the browser and asks the server what it is. A failure here only means no guess. */
  async function measure(chosen: File) {
    setCheck(null);
    setGoOn(false);
    if (what !== 'scan') return;
    setChecking(true);
    try {
      const { sha256OfFile, pdfPageHashes } = await import('../reader/pageHashes.js');
      const [sha256, pageHashes] = await Promise.all([sha256OfFile(chosen), pdfPageHashes(chosen).catch(() => [])]);
      const response = await fetch('/_/uploads/check', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ for: entity.id, sha256, pageHashes, title: title || chosen.name }),
      });
      if (!response.ok) return;
      const found = (await response.json()) as Check;
      setCheck(found);
      const p = found.proposal;
      if (p.as === 'scan-of') {
        setKind('scan-of');
        setPublication(p.publication);
      } else if (p.as === 'duplicate' && p.publication) {
        setKind('scan-of');
        setPublication(p.publication);
      } else if (p.as === 'teshura' || p.as === 'printing') {
        setKind(p.as);
      }
    } catch {
      // No guess: the person says what it is.
    } finally {
      setChecking(false);
    }
  }

  function send(event: React.FormEvent) {
    event.preventDefault();
    if (!file || !rights) return;
    setError(null);
    setProgress(0);
    // XMLHttpRequest, for the progress bar a large file needs.
    const request = new XMLHttpRequest();
    const query = new URLSearchParams({ what, for: entity.id, rights, title: title.trim() });
    if (what === 'scan') {
      query.set('as', kind);
      if (kind === 'scan-of') query.set('publication', publication);
      if (kind === 'printing') for (const name of ['publisher', 'year', 'printing'] as const) if (fields[name].trim()) query.set(name, fields[name].trim());
      if (kind === 'teshura') for (const name of ['families', 'date'] as const) if (fields[name].trim()) query.set(name, fields[name].trim());
    }
    request.open('POST', `/_/uploads?${query}`);
    request.setRequestHeader('Content-Type', file.type || (what === 'scan' ? 'application/pdf' : 'audio/mpeg'));
    request.upload.onprogress = (e) => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
    request.onload = () => {
      setProgress(null);
      const body = JSON.parse(request.responseText || '{}') as Result & { message?: string };
      if (request.status >= 400) setError(body.message ?? request.statusText);
      else setResult(body);
    };
    request.onerror = () => {
      setProgress(null);
      setError(t(lang, 'uploadFailed'));
    };
    request.send(file);
  }

  const here = entity.path ?? `/${entity.id}`;
  const proposal = check?.proposal;
  const printings = check?.publications ?? [];
  const printingLabel = (p: Printing) => [nameOf(p.title, lang) || p.id, p.publisher, p.date ?? p.gregorianYear, p.printing ? `${st(lang, 'printingNo')} ${p.printing}` : null].filter(Boolean).join(' · ');
  const stop = proposal?.as === 'existing' || (proposal?.as === 'duplicate' && !goOn);
  const summary = teshuros ? st(lang, 'addTeshura') : t(lang, what === 'recording' ? 'addRecording' : 'addScan');
  return (
    <details className="report upload" id="upload">
      <summary>{summary}</summary>
      {account === null ? (
        <p>
          {t(lang, 'uploadSignIn')} <Link to={href('/signin', lang, { return: `${here}#upload` })}>{t(lang, 'signIn')}</Link>
        </p>
      ) : result?.existed ? (
        <p role="status">
          {t(lang, 'uploadExisted')}{' '}
          {result.usedBy.map((u) => (
            <Link key={u.id} to={itemHref(u, lang)}>
              {t(lang, 'here')}
            </Link>
          ))}
        </p>
      ) : result ? (
        <p role="status">
          {t(lang, result.served ? 'uploadSent' : 'uploadSentPrivate')} <Link to={href('/review', lang, { s: String(result.suggestion) })}>{t(lang, 'suggestSee')}</Link>
        </p>
      ) : (
        <form onSubmit={send}>
          <label>
            {t(lang, what === 'recording' ? 'uploadAudio' : 'uploadPdf')}
            <input
              type="file"
              accept={what === 'recording' ? 'audio/*' : 'application/pdf'}
              onChange={(e) => {
                const chosen = e.target.files?.[0] ?? null;
                setFile(chosen);
                if (chosen) void measure(chosen);
              }}
              required
            />
          </label>
          <p className="row-sub">{t(lang, 'uploadLimit')}</p>
          {checking ? <p className="row-sub" role="status">{st(lang, 'checking')}</p> : null}
          {proposal?.as === 'existing' ? (
            <p role="status">
              {st(lang, 'weHaveIt')}{' '}
              {proposal.usedBy.map((u) => (
                <Link key={u.id} to={itemHref(u, lang)}>
                  {t(lang, 'here')}
                </Link>
              ))}
            </p>
          ) : null}
          {check?.similar.length && proposal?.as !== 'existing' ? (
            // A machine's guess, said as one.
            <div className="upload-guess" role="status">
              {check.similar.map((s, i) => (
                <p key={i} className="row-sub">
                  {st(lang, s.kind === 'same' ? 'looksSame' : 'sharesPages')}{' '}
                  {s.items.map((item) => (
                    <Link key={item.id} to={itemHref(item, lang)}>
                      {t(lang, 'here')}
                    </Link>
                  ))}{' '}
                  ({s.matched}/{s.of} {st(lang, 'pagesAlike')})
                </p>
              ))}
              {proposal?.as === 'duplicate' && !goOn ? (
                <button type="button" className="secondary" onClick={() => setGoOn(true)}>
                  {st(lang, 'sendAnyway')}
                </button>
              ) : null}
            </div>
          ) : null}
          {stop ? null : (
            <>
              {what === 'scan' ? (
                <fieldset className="rights-choice">
                  <legend>{st(lang, 'whatIsIt')}</legend>
                  {(['scan-of', 'printing', 'teshura'] as const)
                    .filter((k) => (k === 'scan-of' ? printings.length > 0 || entity.type === 'publication' : k === 'printing' ? entity.type === 'work' : true))
                    .map((k) => (
                      <label key={k}>
                        <input type="radio" name="as" value={k} checked={kind === k} onChange={() => setKind(k)} /> {st(lang, k === 'scan-of' ? 'asScanOf' : k === 'printing' ? 'asPrinting' : 'asTeshura')}
                      </label>
                    ))}
                  {proposal && 'reason' in proposal && ['shares-pages', 'same-year', 'title'].includes(proposal.reason) ? (
                    <p className="row-sub">
                      {st(lang, 'guessedBecause')} {st(lang, `reason_${proposal.reason.replace('-', '_')}` as 'reason_title')}
                    </p>
                  ) : null}
                </fieldset>
              ) : null}
              {what === 'scan' && kind === 'scan-of' && entity.type !== 'publication' ? (
                <label>
                  {st(lang, 'whichPrinting')}
                  <select value={publication} onChange={(e) => setPublication(e.target.value)} required>
                    <option value="" disabled>
                      …
                    </option>
                    {printings.map((p) => (
                      <option key={p.id} value={p.id}>
                        {printingLabel(p)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {what === 'recording' || kind !== 'scan-of' ? (
                <label>
                  {t(lang, what === 'recording' ? 'recordingName' : 'printingName')}
                  <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} dir="auto" placeholder={t(lang, what === 'recording' ? 'recordingNameHint' : 'printingNameHint')} />
                </label>
              ) : null}
              {what === 'scan' && kind === 'printing' ? (
                <>
                  <label>
                    {st(lang, 'publisher')}
                    <input {...field('publisher')} maxLength={300} dir="auto" />
                  </label>
                  <label>
                    {st(lang, 'year')}
                    <input {...field('year')} maxLength={20} dir="auto" placeholder={st(lang, 'yearHint')} />
                  </label>
                  <label>
                    {st(lang, 'printingNumber')}
                    <input {...field('printing')} inputMode="numeric" pattern="[1-9][0-9]{0,2}" maxLength={3} />
                  </label>
                </>
              ) : null}
              {what === 'scan' && kind === 'teshura' ? (
                <>
                  <label>
                    {st(lang, 'families')}
                    <input {...field('families')} maxLength={300} dir="auto" placeholder={st(lang, 'familiesHint')} required />
                  </label>
                  <label>
                    {st(lang, 'simchaDate')}
                    <input {...field('date')} maxLength={12} dir="ltr" placeholder={st(lang, 'simchaDateHint')} pattern="\d{4}(-(0[1-9]|1[0-3]|06A|06B)(-\d{2})?)?" />
                  </label>
                  <p className="row-sub">{st(lang, 'teshuraRights')}</p>
                </>
              ) : null}
              <fieldset className="rights-choice">
                <legend>{t(lang, 'rightsQuestion')}</legend>
                {RIGHTS.map((r) => (
                  <label key={r}>
                    <input type="radio" name="rights" value={r} checked={rights === r} onChange={() => setRights(r)} required /> {t(lang, `rights_${r}`)}
                  </label>
                ))}
              </fieldset>
              {error ? <p role="alert">{error}</p> : null}
              {progress !== null ? <progress max={100} value={progress} /> : null}
              <div>
                <button type="submit" disabled={!file || !rights || progress !== null || checking}>
                  {progress !== null ? `${progress}%` : t(lang, 'sendForReview')}
                </button>
              </div>
              <p className="row-sub">{t(lang, 'uploadHow')}</p>
            </>
          )}
        </form>
      )}
    </details>
  );
}
