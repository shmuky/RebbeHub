import { useRef, useState, type ReactNode } from 'react';
import type { Lang } from '../lib/i18n.js';
import { tu } from '../lib/i18nUi.js';
import { Avatar } from './primitives.js';
import { Icon, type IconName } from './Icon.js';

/**
 * The reviewer's box at the foot of a suggestion, as on a pull request:
 * what they have to say, and what they decide (comment, approve, send
 * back), each choice saying what it will do. The button says the choice.
 * Who may decide is the caller's to say; without `choices` it is a plain
 * comment box. `direct` puts each choice on its own button, as design/
 * draws the review (3m): the note, then Approve and Send back side by side.
 */

export interface ReviewChoice {
  value: string;
  label: string;
  hint: string;
  /** The button's words and colour when this choice is picked. */
  submit: string;
  /** The button's words while the choice is being sent ("Merging…"), when they differ from `submit`. */
  working?: string;
  tone?: 'approve' | 'primary' | 'danger';
  icon?: IconName;
  /** Whether a note must be written for this choice (sending back says why). */
  needsNote?: boolean;
}

export function reviewChoices(lang: Lang): ReviewChoice[] {
  return [
    { value: 'comment', label: tu(lang, 'comment'), hint: tu(lang, 'commentHint'), submit: tu(lang, 'addComment'), tone: 'primary', icon: 'discuss', needsNote: true },
    { value: 'approve', label: tu(lang, 'approve'), hint: tu(lang, 'approveHint'), submit: tu(lang, 'approveSuggestion'), working: tu(lang, 'merging'), tone: 'approve', icon: 'check' },
    { value: 'send_back', label: tu(lang, 'sendBack'), hint: tu(lang, 'sendBackHint'), submit: tu(lang, 'sendBackSuggestion'), tone: 'danger', icon: 'x', needsNote: true },
  ];
}

/** A direct button says what it does: send back is with a note, a comment changes nothing. */
const DIRECT: Record<string, Record<Lang, string>> = { send_back: { he: 'החזרה עם הערה', en: 'Send back with a note' }, comment: { he: 'הערה בלבד', en: 'Comment only' } };

const TONE_VAR: Record<string, string> = { approve: 'var(--open-strong)', primary: 'var(--accent-strong)', danger: 'var(--closed-strong)' };

export function ReviewBox({
  lang,
  me,
  title,
  choices,
  initial,
  placeholder,
  footnote,
  busy,
  error,
  onSubmit,
  name = 'verdict',
  extra,
  direct,
}: {
  lang: Lang;
  me: { name: string; id?: string } | null;
  title?: ReactNode;
  choices?: ReviewChoice[];
  initial?: string;
  placeholder?: string;
  footnote?: ReactNode;
  busy?: boolean;
  error?: string | null;
  /** Resolves when the choice has been sent; `false` when it was refused (the words are kept to send again). */
  onSubmit: (choice: string, note: string) => void | boolean | Promise<void | boolean>;
  name?: string;
  /** More actions beside the button (withdraw, cancel). */
  extra?: ReactNode;
  /** A button for each choice instead of picking one and sending it. */
  direct?: boolean;
}) {
  const [note, setNote] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const [choice, setChoice] = useState(initial ?? choices?.[0]?.value ?? 'comment');
  // Sent and not yet answered: the button says what it is doing and cannot be pressed again.
  const [sending, setSending] = useState(false);
  const picked = choices?.find((c) => c.value === choice);
  const tone = picked?.tone ?? 'primary';
  const blocked = busy || sending || ((picked?.needsNote ?? !choices) && !note.trim());
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const send = (value: string) => {
    setFailed(null);
    setSending(true);
    // A refused submit keeps the words and says why; the caller may say it too, through `error`.
    return Promise.resolve()
      .then(() => onSubmit(value, note.trim()))
      .then(
        (sent) => sent !== false && setNote(''),
        (e: unknown) => setFailed(e instanceof Error ? e.message : String(e)),
      )
      .finally(() => setSending(false));
  };
  if (direct && choices) {
    // A choice that needs a note (sending back says why) asks for it where it is written.
    const press = (c: ReviewChoice) => {
      if (busy || sending) return;
      setChoice(c.value);
      if (c.needsNote && !note.trim()) return noteRef.current?.focus();
      void send(c.value);
    };
    const order = ['approve', 'send_back', 'comment'];
    return (
      <form className="review-box direct" onSubmit={(e) => e.preventDefault()}>
        <label className="visually-hidden" htmlFor={`${name}-note`}>
          {tu(lang, 'comment')}
        </label>
        <textarea ref={noteRef} id={`${name}-note`} value={note} onChange={(e) => setNote(e.target.value)} placeholder={placeholder} rows={2} />
        {error || failed ? (
          <p className="rb-error" role="alert">
            <Icon name="warn" /> {error ?? failed}
          </p>
        ) : null}
        <div className="rb-f">
          <span className="rb-buttons">
            {[...choices]
              .sort((a, b) => order.indexOf(a.value) - order.indexOf(b.value))
              .map((c) => (
                <button key={c.value} type="button" className={`btn rb-${c.value}`} disabled={busy || sending} aria-busy={(sending && choice === c.value) || undefined} onClick={() => press(c)}>
                  {sending && choice === c.value ? <Icon name="loader" className="spin" /> : c.value === 'approve' ? <Icon name="check" /> : null}
                  {sending && choice === c.value && c.working ? c.working : (DIRECT[c.value]?.[lang] ?? c.label)}
                </button>
              ))}
            {extra}
          </span>
          <span className="rb-foot">{footnote}</span>
        </div>
      </form>
    );
  }
  return (
    <form
      className="review-box"
      onSubmit={(e) => {
        e.preventDefault();
        if (blocked) return;
        void send(choice);
      }}
    >
      <div className="rb-h">
        {me ? <Avatar name={me.name} id={me.id} size="sm" /> : null}
        {title ?? tu(lang, 'yourReview')}
      </div>
      <label className="visually-hidden" htmlFor={`${name}-note`}>
        {tu(lang, 'comment')}
      </label>
      <textarea id={`${name}-note`} value={note} onChange={(e) => setNote(e.target.value)} placeholder={placeholder} rows={3} />
      {choices && choices.length > 1 ? (
        <fieldset className="rb-choices">
          <legend className="visually-hidden">{tu(lang, 'yourReview')}</legend>
          {choices.map((c) => (
            <label key={c.value} className="rb-choice" style={{ ['--rb-tone' as string]: TONE_VAR[c.tone ?? 'primary'] }}>
              <input type="radio" name={name} value={c.value} checked={choice === c.value} onChange={() => setChoice(c.value)} />
              <span>
                <b>{c.label}</b>
                <span className="muted">{c.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {error || failed ? (
        <p className="rb-error" role="alert">
          <Icon name="warn" /> {error ?? failed}
        </p>
      ) : null}
      <div className="rb-f">
        <span>{footnote}</span>
        <span className="end">
          {extra}
          <button type="submit" className={`btn ${tone}`} disabled={blocked} aria-busy={busy || sending || undefined}>
            {busy || sending ? <Icon name="loader" className="spin" /> : <Icon name={picked?.icon ?? 'discuss'} />}
            {sending && picked?.working ? picked.working : (picked?.submit ?? tu(lang, 'addComment'))}
          </button>
        </span>
      </div>
    </form>
  );
}
