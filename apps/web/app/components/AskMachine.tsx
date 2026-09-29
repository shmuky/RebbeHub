import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import type { Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { href } from '../lib/links.js';
import { postJson } from '../lib/post.js';
import { useAccount } from '../lib/useAccount.js';
import { Icon } from '../ui/Icon.js';

/**
 * "Read this scan" / "Transcribe this recording": asks the machines for
 * the work (core/machineWork.ts, POST /v1/machine/requests). Shows where
 * the request stands: waiting and its place in line, being done, or why
 * it failed. Anyone signed in may ask; the machines are free CPU engines,
 * and what they make is labelled as machine output until people check it.
 */

export type MachineKind = 'ocr' | 'transcript';

export interface MachineRequest {
  id: number;
  kind: MachineKind;
  item: string;
  status: 'waiting' | 'running' | 'done' | 'failed';
  note: string | null;
  position: number | null;
}

const W = {
  ocr: { he: 'לקרוא את הסריקה במחשב', en: 'Read this scan by machine' },
  transcript: { he: 'לתמלל את ההקלטה במחשב', en: 'Transcribe this recording by machine' },
  ocrHint: { he: 'המחשב יקרא את הסריקה שורה אחר שורה, כדי שאפשר יהיה לחפש בה ולהגיה אותה.', en: 'The machine reads the scan line by line, so it can be searched and proofread.' },
  transcriptHint: { he: 'המחשב ישמע את ההקלטה ויכתוב אותה, מסונכרנת לפי פסקאות.', en: 'The machine hears the recording and writes it out, synced paragraph by paragraph.' },
  waiting: { he: 'ממתין בתור', en: 'Waiting in line' },
  inLine: { he: 'מקום בתור', en: 'place in line' },
  running: { he: 'המחשב עובד על זה עכשיו', en: 'The machine is on it now' },
  startsNow: { he: 'המחשב מתחיל עכשיו; התוצאה תופיע כאן כשתהיה מוכנה.', en: 'The machine is starting now; the result shows here when it is ready.' },
  nextRun: { he: 'המחשב יגיע לזה בריצה הבאה שלו, בדרך כלל תוך יום.', en: 'The machine takes it on its next run, usually within a day.' },
  failed: { he: 'המחשב לא הצליח', en: 'The machine could not do it' },
  askAgain: { he: 'לבקש שוב', en: 'Ask again' },
  signIn: { he: 'כניסה כדי לבקש', en: 'Sign in to ask' },
} as const;

const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

async function current(kind: MachineKind, item: string): Promise<MachineRequest | null> {
  const response = await fetch(`/_/steward/machine/requests?item=${encodeURIComponent(item)}&kind=${kind}&limit=1`, { credentials: 'same-origin', headers: { accept: 'application/json' } });
  if (!response.ok) return null;
  const { requests } = (await response.json()) as { requests: MachineRequest[] };
  return requests[0] ?? null;
}

export function AskMachine({ kind, item, lang }: { kind: MachineKind; item: string; lang: Lang }) {
  const account = useAccount();
  const location = useLocation();
  const [request, setRequest] = useState<MachineRequest | null>(null);
  const [startsAtOnce, setStartsAtOnce] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void current(kind, item).then((r) => live && setRequest(r));
    return () => {
      live = false;
    };
  }, [kind, item]);

  async function ask() {
    setBusy(true);
    setError(null);
    try {
      const made = await postJson<{ request: MachineRequest; startsAtOnce: boolean }>('machine/requests', { kind, item });
      setRequest(made.request);
      setStartsAtOnce(made.startsAtOnce);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const open = request && (request.status === 'waiting' || request.status === 'running');
  return (
    <div className="ask-machine stack" data-kind={kind}>
      {open ? (
        <p className="note" role="status">
          <Icon name={request.status === 'running' ? 'loader' : 'clock'} size={14} />{' '}
          {request.status === 'running' ? w(lang, 'running') : `${w(lang, 'waiting')}${request.position ? ` · ${w(lang, 'inLine')} ${num(request.position, lang)}` : ''}`}
          {startsAtOnce !== null ? ` · ${w(lang, startsAtOnce ? 'startsNow' : 'nextRun')}` : ''}
        </p>
      ) : (
        <>
          {request?.status === 'failed' ? (
            <p className="alert negative">
              <Icon name="warn" />
              {w(lang, 'failed')}
              {request.note ? `: ${request.note}` : ''}
            </p>
          ) : (
            <p className="note">{w(lang, kind === 'ocr' ? 'ocrHint' : 'transcriptHint')}</p>
          )}
          <div className="btn-row">
            {account ? (
              <button type="button" className="btn primary" onClick={ask} disabled={busy}>
                <Icon name="bot" />
                {request?.status === 'failed' ? w(lang, 'askAgain') : w(lang, kind)}
              </button>
            ) : account === null ? (
              <Link className="btn" to={href('/signin', lang, { return: `${location.pathname}${location.search}` })}>
                <Icon name="bot" />
                {w(lang, 'signIn')}
              </Link>
            ) : null}
          </div>
        </>
      )}
      {error ? (
        <p className="alert negative" role="alert">
          <Icon name="warn" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
