import { MessageCircle, Radio } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { Lang } from '../lib/i18n.js';
import { clockOf } from '../lib/i18nNetwork.js';
import { href } from '../lib/links.js';
import { postJson } from '../lib/post.js';
import type { Span, Transcript } from '../lib/transcript.js';
import { usePlayer } from '../player/PlayerProvider.js';

/**
 * The timing tools, in the editor and while listening. "Exact timing"
 * takes the moment of the tap as where the paragraph starts (what follows
 * moves with it, core/sync.ts anchorSync), and asks once before it is sent,
 * so a stray tap never moves the sync. A listener's taps on one recording
 * are one suggestion, each going on from the last, so they never clash.
 * "The sync is right" marks the whole recording's sync checked. And words
 * nobody is sure of (`[words?]`) can be talked over on the recording's
 * talk page, with the words and where they are heard.
 */

const W = {
  saidNow: { he: 'תזמון מדוייק', en: 'Exact timing' },
  howSync: {
    he: '„תזמון מדוייק”: מתקן את התזמון, לא את המילים. לחצו בדיוק כשהרבי מתחיל את הפסקה, ואשרו. ההמשך זז איתה.',
    en: '"Exact timing": fixes the timing, not the words. Tap just as the Rebbe starts the paragraph, then confirm. What follows moves with it.',
  },
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

/** The editor's "Exact timing" under a paragraph: the tap takes the moment, Confirm sends it. */
export function SyncNow({ recording, segment, lang, onAnchored }: { recording: string; segment: string; lang: Lang; onAnchored: (spans: Span[]) => void }) {
  const player = usePlayer();
  const [at, setAt] = useState<number | null>(null);
  const [done, setDone] = useState(false);
  if (done) return <p className="row-sub tx-sent">{w(lang, 'syncFixed')}</p>;
  if (at !== null)
    return (
      <ConfirmTiming
        recording={recording}
        segment={segment}
        atMs={at}
        lang={lang}
        onCancel={() => setAt(null)}
        onDone={(spans) => {
          setDone(true);
          onAnchored(spans);
        }}
      />
    );
  return (
    <button type="button" className="tx-tool" onClick={() => setAt(Math.round(player.now() * 1000))} title={w(lang, 'howSync')}>
      <Radio size={16} aria-hidden />
      {w(lang, 'saidNow')}
    </button>
  );
}

export const timingWords = { howSync: W.howSync, timingMode: W.timingMode, timingModeHint: W.timingModeHint, syncFixed: W.syncFixed };

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
