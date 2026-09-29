import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { PageSegment, PageSegmentKind } from '@rebbehub/model';
import { fill, readRuns } from '../lib/editorRuns.js';
import { t, type Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';

const WORDS = {
  bold: { he: 'מודגש', en: 'Bold' },
  italic: { he: 'נטוי', en: 'Italic' },
  underline: { he: 'קו תחתון', en: 'Underline' },
  addAfter: { he: 'הוספת פסקה אחריו', en: 'Add a segment after' },
  remove: { he: 'הסרה', en: 'Remove' },
  removeSure: { he: 'להציע להסיר את הקטע הזה?', en: 'Suggest taking this segment out?' },
  note: { he: 'מה תוקן? (לא חובה)', en: 'What did you fix? (optional)' },
  fixTitle: { he: 'תיקון בטקסט', en: 'A fix to the words' },
  addTitle: { he: 'הוספת קטע לטקסט', en: 'A segment added to the words' },
  removeTitle: { he: 'הסרת קטע מהטקסט', en: 'A segment taken out of the words' },
  startTitle: { he: 'הטקסט של הדף', en: "The page's words" },
  live: { he: 'נשמר.', en: 'Saved.' },
  changedSince: { he: 'הקטע השתנה מאז שנפתח. טענו את הדף מחדש.', en: 'This segment has changed since you opened it. Reload the page.' },
} as const;

export interface SentSuggestion {
  id: number;
  status: string;
}

/**
 * One segment's words, edited in place: typed straight into the page, with
 * bold, italic and underline, and sent for review as a Suggestion of its
 * own (`edit`); or a new segment after it (`add`), or a page's first words
 * (`start`). Pasted text comes in as plain words; footnote marks and
 * source markers stay as they are.
 */
export function SegmentEditor({
  entityId,
  version,
  segment,
  mode,
  kind,
  language,
  lang,
  labelOf = (note) => note,
  onClose,
  onSent,
  onAddAfter,
}: {
  entityId: string;
  version?: string;
  segment?: PageSegment;
  mode: 'edit' | 'add' | 'start';
  kind?: PageSegmentKind;
  language?: string;
  lang: Lang;
  labelOf?: (note: string) => string;
  onClose: () => void;
  onSent: (sent: SentSuggestion) => void;
  onAddAfter?: () => void;
}) {
  const box = useRef<HTMLSpanElement>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const original = mode === 'edit' ? (segment?.text ?? []) : [];

  useEffect(() => {
    if (!box.current) return;
    fill(box.current, original, labelOf);
    box.current.focus();
    try {
      document.execCommand('styleWithCSS', false, 'false');
    } catch {
      // older browsers: marks come as tags anyway
    }
    // Filled once, when opened; from then on the words are the person's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function send(change: 'edit' | 'add' | 'remove' | 'start') {
    setBusy(true);
    setError(null);
    const text = change === 'remove' ? undefined : readRuns(box.current!);
    const title = change === 'edit' ? WORDS.fixTitle[lang] : change === 'add' ? WORDS.addTitle[lang] : change === 'remove' ? WORDS.removeTitle[lang] : WORDS.startTitle[lang];
    try {
      const response = await fetch('/_/suggestions/words', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ entityId, change, version, segment: segment?.id, text, before: change === 'start' ? undefined : segment?.text ?? [], kind, language, title, note: note.trim() || undefined }),
      });
      const json = (await response.json().catch(() => ({}))) as { id?: number; status?: string; message?: string };
      if (response.status === 409) throw new Error(WORDS.changedSince[lang]);
      if (!response.ok) throw new Error(json.message ?? t(lang, 'error'));
      onSent({ id: json.id!, status: json.status ?? 'open' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const format = (command: 'bold' | 'italic' | 'underline') => (e: React.MouseEvent) => {
    e.preventDefault(); // keep the selection in the words
    document.execCommand(command);
  };

  return (
    <span className="words-editor">
      <span className="words-toolbar" role="toolbar">
        <button type="button" className="btn sm icon" onMouseDown={format('bold')} aria-label={WORDS.bold[lang]} title={WORDS.bold[lang]}>
          <b>B</b>
        </button>
        <button type="button" className="btn sm icon" onMouseDown={format('italic')} aria-label={WORDS.italic[lang]} title={WORDS.italic[lang]}>
          <i>I</i>
        </button>
        <button type="button" className="btn sm icon" onMouseDown={format('underline')} aria-label={WORDS.underline[lang]} title={WORDS.underline[lang]}>
          <u>U</u>
        </button>
      </span>
      <span
        ref={box}
        className="words-input"
        contentEditable={!busy}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        dir="auto"
        onPaste={(e) => {
          // Pasted words come in as words only.
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void send(mode === 'edit' ? 'edit' : mode);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            document.execCommand('insertLineBreak');
          }
        }}
      />
      <input className="words-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} dir="auto" placeholder={WORDS.note[lang]} aria-label={WORDS.note[lang]} />
      <span className="words-actions">
        <button type="button" className="btn sm primary" disabled={busy} onClick={() => void send(mode === 'edit' ? 'edit' : mode)}>
          {busy ? t(lang, 'waiting') : t(lang, 'sendForReview')}
        </button>
        {mode === 'edit' && onAddAfter ? (
          <button type="button" className="btn sm" disabled={busy} onClick={onAddAfter}>
            {WORDS.addAfter[lang]}
          </button>
        ) : null}
        {mode === 'edit' ? (
          <button type="button" className="btn sm danger" disabled={busy} onClick={() => window.confirm(WORDS.removeSure[lang]) && void send('remove')}>
            {WORDS.remove[lang]}
          </button>
        ) : null}
        <button type="button" className="btn sm" disabled={busy} onClick={onClose}>
          {t(lang, 'cancel')}
        </button>
      </span>
      {error ? (
        <span className="words-error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}

/** What a person sees once a segment's change is sent: where to follow it, or that it is already live. */
export function SentNote({ sent, lang }: { sent: SentSuggestion; lang: Lang }) {
  if (sent.status === 'merged') return <span className="words-sent row-sub">{WORDS.live[lang]}</span>;
  return (
    <span className="words-sent row-sub" role="status">
      {t(lang, 'suggestSent')} <Link to={href('/review', lang, { s: String(sent.id) })}>{t(lang, 'suggestSee')}</Link>
    </span>
  );
}
