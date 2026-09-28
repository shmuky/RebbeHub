import { useState } from 'react';
import { Link } from 'react-router';
import type { Entity } from '../lib/api.js';
import { t, type Lang } from '../lib/i18n.js';
import { href, itemPath } from '../lib/links.js';
import { useAccount } from '../lib/useAccount.js';

/**
 * "Add a recording" to a farbrengen, "Add a scan" to a sefer (the plan,
 * section 7): pick the file, give it a name, say what you know of its
 * rights, send. The server hashes it ("we already have this — here"),
 * keeps it where its rights put it, and sends a suggestion for review.
 */

const RIGHTS = ['mine', 'free', 'public-domain', 'unsure'] as const;
type Rights = (typeof RIGHTS)[number];

type Result = { existed: true; usedBy: Array<{ id: string; type: string; path: string | null }> } | { existed: false; served: boolean; suggestion: number };

export function UploadForm({ entity, lang }: { entity: Pick<Entity, 'id' | 'type' | 'path'>; lang: Lang }) {
  const account = useAccount();
  const what = entity.type === 'event' ? 'recording' : 'scan';
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [rights, setRights] = useState<Rights | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  function send(event: React.FormEvent) {
    event.preventDefault();
    if (!file || !rights) return;
    setError(null);
    setProgress(0);
    // XMLHttpRequest, for the progress bar a large file needs.
    const request = new XMLHttpRequest();
    const query = new URLSearchParams({ what, for: entity.id, rights, title: title.trim() });
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
  return (
    <details className="report upload" id="upload">
      <summary>{t(lang, what === 'recording' ? 'addRecording' : 'addScan')}</summary>
      {account === null ? (
        <p>
          {t(lang, 'uploadSignIn')} <Link to={href('/signin', lang, { return: `${here}#upload` })}>{t(lang, 'signIn')}</Link>
        </p>
      ) : result?.existed ? (
        <p role="status">
          {t(lang, 'uploadExisted')}{' '}
          {result.usedBy.map((u) => (
            <Link key={u.id} to={href(itemPath({ id: u.id, path: u.path } as Entity), lang)}>
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
            <input type="file" accept={what === 'recording' ? 'audio/*' : 'application/pdf'} onChange={(e) => setFile(e.target.files?.[0] ?? null)} required />
          </label>
          <p className="row-sub">{t(lang, 'uploadLimit')}</p>
          <label>
            {t(lang, what === 'recording' ? 'recordingName' : 'printingName')}
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} dir="auto" placeholder={t(lang, what === 'recording' ? 'recordingNameHint' : 'printingNameHint')} />
          </label>
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
            <button type="submit" disabled={!file || !rights || progress !== null}>
              {progress !== null ? `${progress}%` : t(lang, 'sendForReview')}
            </button>
          </div>
          <p className="row-sub">{t(lang, 'uploadHow')}</p>
        </form>
      )}
    </details>
  );
}
