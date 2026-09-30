import { MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { Lang } from '../lib/i18n.js';
import { clockOf } from '../lib/i18nNetwork.js';
import { href } from '../lib/links.js';
import { postJson } from '../lib/post.js';
import type { Span, Transcript } from '../lib/transcript.js';

/**
 * The timing tools while listening. "Timing" takes the moment a paragraph
 * is tapped as where it starts (what follows moves with it, core/sync.ts
 * anchorSync), and asks once before it is sent, so a stray tap never moves
 * the sync. There is no "Exact timing" button under a paragraph in the
 * editor: Shmuly had it removed. A listener's taps on one recording
 * are one suggestion, each going on from the last, so they never clash.
 * "The sync is right" marks the whole recording's sync checked. And words
 * nobody is sure of (`[words?]`) can be talked over on the recording's
 * talk page, with the words and where they are heard.
 */

const W = {
  saidNow: { he: 'תזמון', en: 'Timing' },
  startsAt: { he: 'הפסקה תתחיל ב־{at}', en: 'The paragraph will start at {at}' },
  confirm: { he: 'לאשר', en: 'Confirm' },
  cancel: { he: 'ביטול', en: 'Cancel' },
  syncFixed: { he: 'התזמון תוקן מכאן. נשלח לאישור.', en: 'Timing fixed from here. Sent for approval.' },
  syncRight: { he: 'הסנכרון של כל ההקלטה נכון', en: 'The sync of the whole recording is right' },
  syncRightHint: { he: 'אחרי שהאזנתם ובדקתם שהסימון תואם לשמע.', en: 'After listening and seeing the highlight follows the audio.' },
  syncRightSent: { he: 'נשלח לאישור.', en: 'Sent for approval.' },
  timingMode: { he: 'תזמון', en: 'Timing' },
  timingModeHint: {
    he: 'מצב תזמון: לחצו על פסקה בדיוק כשהרבי מתחיל אותה, ואשרו.',
    en: 'Timing mode: tap a paragraph just as the Rebbe starts it, then confirm.',
  },
  discuss: { he: 'לפתוח דיון', en: 'Discuss' },
  discussTitle: { he: 'דיון על מילים לא ברורות', en: 'Talk about unclear words' },
  discussPlaceholder: { he: 'מה נשמע לך כאן? (לא חובה)', en: 'What do you hear here? (optional)' },
  send: { he: 'שליחה', en: 'Send' },
  discussSent: { he: 'הדיון נפתח בדף השיחה.', en: 'Started on the talk page.' },
  openTalk: { he: 'לדף השיחה', en: 'Open the talk page' },
  unclearAt: { he: 'לא ברור ({at}): «{words}»', en: 'Unclear ({at}): "{words}"' },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang] as string;

/** A recording's sync as the API answered it, applied to what is on screen at once. */
export function withSpans(transcripts: Transcript[], recording: string, spans: Span[]): Transcript[] {
  const bySegment = new Map(spans.map((s) => [s.segment, s]));
  return transcripts.map((tr) =>
    tr.recording !== recording
      ? tr
      : { ...tr, paragraphs: tr.paragraphs.map((p) => (bySegment.has(p.id) ? { ...p, ...bySegment.get(p.id)!, syncChecked: bySegment.get(p.id)!.locked || p.syncChecked } : p)) },
  );
}

/** A moment taken, waiting for Confirm; then sent. */
export function ConfirmTiming({ recording, segment, atMs, lang, onDone, onCancel }: { recording: string; segment: string; atMs: number; lang: Lang; onDone: (spans: Span[]) => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="tx-timing" role="group" aria-label={w(lang, 'saidNow')}>
      <span>{w(lang, 'startsAt').replace('{at}', clockOf(atMs))}</span>
      <button
        type="button"
        className="btn sm primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const fix = await postJson<{ spans: Span[] }>(`recordings/${recording}/sync/anchor`, { segment, atMs });
            onDone(fix.spans);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {w(lang, 'confirm')}
      </button>
      <button type="button" className="btn sm" onClick={onCancel}>
        {w(lang, 'cancel')}
      </button>
      {error ? <span role="alert">{error}</span> : null}
    </div>
  );
}

export const timingWords = { timingMode: W.timingMode, timingModeHint: W.timingModeHint, syncFixed: W.syncFixed };

/** "The sync of the whole recording is right". */
export function ConfirmSync({ recording, lang }: { recording: string; lang: Lang }) {
  const [state, setState] = useState<'idle' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);
  if (state === 'sent') return <p className="row-sub">{w(lang, 'syncRightSent')}</p>;
  return (
    <p className="confirm-page">
      <button
        type="button"
        className="btn"
        onClick={async () => {
          try {
            await postJson(`recordings/${recording}/sync/confirm`);
            setState('sent');
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        {w(lang, 'syncRight')}
      </button>
      <span className="row-sub"> {w(lang, 'syncRightHint')}</span>
      {error ? <span role="alert"> {error}</span> : null}
    </p>
  );
}

/** Words nobody is sure of, talked over on the recording's talk page: the words and where they are heard start the conversation. */
export function DiscussUnclear({ recording, words, atMs, lang, signedIn, onClose }: { recording: string; words: string; atMs: number | null; lang: Lang; signedIn: boolean; onClose: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const talk = href(`/talk/${recording}`, lang);
  const head = w(lang, 'unclearAt')
    .replace('{at}', atMs !== null ? clockOf(atMs) : '–')
    .replace('{words}', words);
  return (
    <div className="tx-discuss" role="dialog" aria-label={w(lang, 'discussTitle')}>
      <p className="tx-discuss-head" dir="auto">
        {head}
      </p>
      {sent ? (
        <p className="row-sub">
          {w(lang, 'discussSent')} <Link to={talk}>{w(lang, 'openTalk')}</Link>
        </p>
      ) : signedIn ? (
        <>
          <textarea dir="auto" rows={2} value={note} placeholder={w(lang, 'discussPlaceholder')} onChange={(e) => setNote(e.target.value)} />
          <div className="actions">
            <button
              type="button"
              className="btn sm primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await postJson(`entities/${recording}/talk`, { body: [head, note.trim()].filter(Boolean).join('\n\n') });
                  setSent(true);
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <MessageCircle size={14} aria-hidden />
              {w(lang, 'send')}
            </button>
            <button type="button" className="btn sm" onClick={onClose}>
              {w(lang, 'cancel')}
            </button>
          </div>
        </>
      ) : (
        <p className="row-sub">
          <Link to={talk}>{w(lang, 'openTalk')}</Link>
        </p>
      )}
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}

export const discussLabel = W.discuss;
