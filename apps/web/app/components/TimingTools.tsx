import { MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import type { Lang } from '../lib/i18n.js';
import { clockOf } from '../lib/i18nNetwork.js';
import { href } from '../lib/links.js';
import { postJson } from '../lib/post.js';

/**
 * Tools while listening. Nobody moves the sync by hand here: Shmuly had
 * the "Timing" and "Exact timing" buttons taken out, as the model's sync
 * is already good and taps made clashing suggestions. "The sync is right"
 * marks the whole recording's sync checked. And words nobody is sure of
 * (`[words?]`) can be talked over on the recording's talk page, with the
 * words and where they are heard.
 */

const W = {
  cancel: { he: 'ביטול', en: 'Cancel' },
  syncRight: { he: 'הסנכרון של כל ההקלטה נכון', en: 'The sync of the whole recording is right' },
  syncRightHint: { he: 'אחרי שהאזנתם ובדקתם שהסימון תואם לשמע.', en: 'After listening and seeing the highlight follows the audio.' },
  syncRightSent: { he: 'נשלח לאישור.', en: 'Sent for approval.' },
  discuss: { he: 'לפתוח דיון', en: 'Discuss' },
  discussTitle: { he: 'דיון על מילים לא ברורות', en: 'Talk about unclear words' },
  discussPlaceholder: { he: 'מה נשמע לך כאן? (לא חובה)', en: 'What do you hear here? (optional)' },
  send: { he: 'שליחה', en: 'Send' },
  discussSent: { he: 'הדיון נפתח בדף השיחה.', en: 'Started on the talk page.' },
  openTalk: { he: 'לדף השיחה', en: 'Open the talk page' },
  unclearAt: { he: 'לא ברור ({at}): «{words}»', en: 'Unclear ({at}): "{words}"' },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang] as string;

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
