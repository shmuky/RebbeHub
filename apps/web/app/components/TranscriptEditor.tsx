import { Check, CircleHelp, History, MessageCircle, Pencil, ShieldQuestion, Undo2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { markUnclear, spellingHints, unclearRanges } from '@rebbehub/model';
import { t, type Lang } from '../lib/i18n.js';
import { clockOf } from '../lib/i18nNetwork.js';
import { href } from '../lib/links.js';
import { useAccount } from '../lib/useAccount.js';
import { postJson } from '../lib/post.js';
import { get, pendingRanges, tokensOf, wholeWords, within, type Paragraph, type Pending, type Transcript, type TranscriptCommit } from '../lib/transcript.js';
import { wordDiff } from '../lib/wordDiff.js';
import { usePlayer, type Track } from '../player/PlayerProvider.js';
import { InlineDiff } from '../ui/Diff.js';
import { ConfirmSync, DiscussUnclear, discussLabel } from './TimingTools.js';
import { Bar, MachineLabel, RelativeTime } from '../ui/primitives.js';

/**
 * Checking what the machine heard, opened from a farbrengen's or a
 * recording's transcript by "Review machine text". The words are the
 * recording: tapping one plays from it. Selecting words opens a small
 * editor for just those, or marks them unclear (`[words?]`); the
 * paragraph's own tools (all exact, retype it, talk over unclear words, and its history) show under the paragraph being worked
 * on, each saying what it does. The recording pauses while words are being
 * fixed, and this browser remembers where the listener was. A fix of
 * some words is on the site once approved but leaves the paragraph the
 * machine's (`complete: false`, core/sync.ts fixParagraph), so it stays
 * labelled and is no training clip until someone checks all of it. Every
 * change anyone made is in one changelog, and per paragraph.
 */

const W = {
  title: { he: 'בדיקת טקסט המכונה', en: 'Review machine text' },
  back: { he: 'חזרה לתצוגת ההאזנה', en: 'Back to listening' },
  how: { he: 'איך בודקים', en: 'How to review' },
  howTap: { he: 'לחיצה על מילה מנגנת ממנה.', en: 'Tap a word to play from it.' },
  howSelect: { he: 'סמנו מילים (לחיצה ארוכה וגרירה) כדי לתקן רק אותן.', en: 'Select words (press and drag) to fix just those.' },
  howRight: { he: '„הכל מדוייק”: שמעתם, וכל המילים נכונות כפי שהמחשב שמע. כך היא נבדקת, ומלמדת את המודל הבא.', en: '"All exact": you listened and every word is right as the machine heard it. That checks it, and teaches the next model.' },
  howEdit: { he: '„עריכת הפסקה”: להקליד אותה מחדש. סמנו אם בדקתם את כולה; אם לא, היא נשארת טקסט מכונה.', en: '"Edit paragraph": retype it. Say whether you checked all of it; if not, it stays machine text.' },
  howUnclear: { he: '„לא ברור”: סמנו מילים שלא בטוח מה נאמר בהן. הן נשמרות כך [מילים?], ולא מלמדים מהן את המודל.', en: '"Unclear": mark words you are not sure of. They are kept as [words?], and the model does not learn from them.' },
  howPause: { he: 'בזמן עריכה ההקלטה נעצרת, וממשיכה מעט לפני כן כשמסיימים.', en: 'The recording pauses while you edit, and goes on from a little before when you finish.' },
  howHistory: { he: '„היסטוריה”: כל מה ששונה בפסקה, מי ומתי.', en: '"History": everything changed in the paragraph, by whom and when.' },
  progress: { he: '{n} מתוך {of} פסקאות נבדקו', en: '{n} of {of} paragraphs checked' },
  checked: { he: 'נבדק', en: 'Checked' },
  partly: { he: 'תוקן בחלקו', en: 'Partly fixed' },
  allRight: { he: 'הכל מדוייק', en: 'All exact' },
  edit: { he: 'עריכת הפסקה', en: 'Edit paragraph' },
  unclear: { he: 'לא ברור', en: 'Unclear' },
  markUnclear: { he: 'סימון כלא ברור', en: 'Mark as unclear' },
  continueHere: { he: 'כאן עצרת בפעם הקודמת', en: 'You stopped here last time' },
  history: { he: 'היסטוריה', en: 'History' },
  fixWords: { he: 'תיקון המילים שסומנו', en: 'Fix the selected words' },
  save: { he: 'שמירה', en: 'Save' },
  cancel: { he: 'ביטול', en: 'Cancel' },
  wholeRight: { he: 'בדקתי את כל הפסקה, והיא נכונה עכשיו', en: 'I checked the whole paragraph, and it is right now' },
  sent: { he: 'נשלח. יופיע באתר אחרי אישור.', en: 'Sent. It shows on the site once approved.' },
  saved: { he: 'נשמר.', en: 'Saved.' },
  yourFix: { he: 'התיקון שלך, מחכה לאישור', en: 'Your fix, waiting for approval' },
  theirFix: { he: 'תיקון של {name}, מחכה לאישור', en: "{name}'s fix, waiting for approval" },
  waitingTitle: { he: 'מחכים לאישור', en: 'Waiting for approval' },
  reviewAll: { he: 'לעבור על כל התיקונים', en: 'Go through all the fixes' },
  waitingCount: { he: '{n} תיקונים כאן מחכים לאישור, מסומנים בקו מקווקו', en: '{n} fixes here wait for approval, marked with a dashed line' },
  allChanges: { he: 'כל השינויים בתמלול', en: 'Every change to this transcript' },
  noChanges: { he: 'עוד אין שינויים מלבד שמיעת המחשב.', en: 'No changes yet besides what the machine heard.' },
  made: { he: 'המחשב שמע {n} פסקאות', en: 'The machine heard {n} paragraphs' },
  madeOne: { he: 'המחשב שמע את הפסקה', en: 'The machine heard the paragraph' },
  wasChecked: { he: 'סימן/ה שהפסקה נכונה', en: 'marked the paragraph correct' },
  fixedAll: { he: 'תיקן/ה ובדק/ה את כל הפסקה', en: 'fixed and checked the whole paragraph' },
  fixedSome: { he: 'תיקן/ה חלק מהמילים', en: 'fixed some of the words' },
  movedSync: { he: 'הזיז/ה את הסנכרון', en: 'moved the sync' },
  para: { he: 'פסקה', en: 'Paragraph' },
  suggestion: { he: 'הצעה', en: 'Suggestion' },
  fullHistory: { he: 'דף ההיסטוריה המלא', en: 'Full history page' },
  signIn: { he: 'כדי לתקן צריך להיכנס. ההאזנה והלחיצה על מילים פתוחות לכולם.', en: 'Sign in to fix. Listening and tapping words are open to all.' },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

/** The house spelling (the booklets'), where the words being written differ from it: a hint, never a change. */
function SpellingHints({ text, lang }: { text: string; lang: Lang }) {
  const hints = spellingHints(text);
  return (
    <p className="note spelling-hints">
      {t(lang, 'houseSpelling')}
      {hints.length ? (
        <>
          {' '}
          {hints.map((h, i) => (
            <span key={h.written} dir="rtl">
              {i ? ', ' : ''}
              {h.written} ← <strong>{h.house}</strong>
            </span>
          ))}
        </>
      ) : null}
    </p>
  );
}

interface Goal {
  model: string;
  hours: { done: number; target: number };
  farbrengens: { done: number; target: number };
  next: Array<{ event: string; path: string | null; title: { he: string; en?: string } | null; date: string | null; paragraphs: number; checked: number; mostWanted: boolean }>;
}

/**
 * What checking teaches: the next transcription model is trained once
 * people have checked enough farbrengens (core/trainingClips.ts), so the
 * goal is shown where they check, with the farbrengens most wanted next.
 */
export function TrainingGoalBar({ lang }: { lang: Lang }) {
  const [goal, setGoal] = useState<Goal | null>(null);
  useEffect(() => {
    let live = true;
    void get<{ goal: Goal }>('machine/training')
      .then((r) => live && setGoal(r.goal))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!goal) return null;
  const hours = (n: number) => (Math.round(n * 10) / 10).toLocaleString(lang);
  return (
    <div className="training-goal">
      <p className="row-sub">
        {t(lang, 'trainingGoal')
          .replace('{model}', goal.model)
          .replace('{done}', goal.farbrengens.done.toLocaleString(lang))
          .replace('{target}', goal.farbrengens.target.toLocaleString(lang))
          .replace('{hours}', hours(goal.hours.done))
          .replace('{targetHours}', hours(goal.hours.target))}
      </p>
      <progress max={goal.hours.target} value={Math.min(goal.hours.done, goal.hours.target)} />
      {goal.next.length ? (
        <details>
          <summary>{t(lang, 'trainingNext')}</summary>
          <ul>
            {goal.next.map((f) => (
              <li key={f.event}>
                {f.path ? <Link to={`${href(f.path, lang, { review: '1' })}#transcript`}>{f.title?.[lang === 'en' ? 'en' : 'he'] ?? f.title?.he ?? f.event}</Link> : (f.title?.he ?? f.event)}{' '}
                <span className="row-sub">
                  {f.checked.toLocaleString(lang)}/{f.paragraphs.toLocaleString(lang)}
                  {f.mostWanted ? ` · ${t(lang, 'mostWanted')}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

/** Where in a paragraph's text a point of the page is, as a character offset (its text is exactly the paragraph's content). */
function offsetIn(host: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.setStart(host, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

type Editing = { kind: 'words'; from: number; to: number; value: string } | { kind: 'all'; value: string; complete: boolean };
type Sent = { content: string; complete: boolean; merged: boolean };

/*
 * Where a listener was, kept in this browser: the paragraph they had open
 * (per recording) and a fix they had not sent yet (per paragraph), so a
 * reload, a lost signal or tomorrow picks up where they stopped. Storage
 * can be missing (private windows): then nothing is remembered.
 */
const PLACE = 'rebbehub.review.place.';
const DRAFT = 'rebbehub.review.draft.';
function recall<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function keep(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Not remembered; the editor works the same.
  }
}

/** One commit's changes, told in words. */
function ChangeRow({ commit, lang, numberOf, only }: { commit: TranscriptCommit; lang: Lang; numberOf: (segment: string) => number; only?: string }) {
  const changes = only ? commit.changes.filter((c) => c.segment === only) : commit.changes;
  if (!changes.length) return null;
  const made = changes.filter((c) => c.kind === 'made');
  const who = commit.authorIsBot ? null : (commit.authorName ?? commit.author);
  return (
    <li className="tx-change">
      <div className="tx-change-head">
        {who ? <b>{who}</b> : <MachineLabel lang={lang} size="sm" />}
        <RelativeTime at={commit.at} lang={lang} className="row-sub" />
        {commit.suggestion ? (
          <Link className="row-sub" to={href(`/suggestions/${commit.suggestion}`, lang)}>
            {w(lang, 'suggestion')} #{commit.suggestion}
          </Link>
        ) : null}
      </div>
      {made.length ? <p className="row-sub">{made.length === 1 && only ? w(lang, 'madeOne') : w(lang, 'made').replace('{n}', made.length.toLocaleString(lang))}</p> : null}
      {changes
        .filter((c) => c.kind !== 'made')
        .map((c, i) => (
          <div key={i} className="tx-change-item">
            {!only ? (
              <a className="row-sub" href={`#p-${c.segment}`}>
                {w(lang, 'para')} {numberOf(c.segment)}
              </a>
            ) : null}{' '}
            <span className="row-sub">{c.kind === 'checked' ? w(lang, 'wasChecked') : c.kind === 'sync' ? w(lang, 'movedSync') : w(lang, c.complete ? 'fixedAll' : 'fixedSome')}</span>
            {c.kind === 'words' ? (
              <p className="tx-diff" dir="auto">
                <InlineDiff parts={wordDiff(c.before ?? '', c.after ?? '')} />
              </p>
            ) : null}
          </div>
        ))}
    </li>
  );
}

function Para({
  n,
  recording,
  paragraph,
  open,
  active,
  found,
  resumed,
  nowMs,
  playing,
  canFix,
  history,
  lang,
  onOpen,
  onPlayFrom,
  onFixed,
  pickWords,
  numberOf,
  waiting,
  me,
}: {
  n: number;
  recording: string;
  paragraph: Paragraph;
  open: boolean;
  active: boolean;
  found: boolean;
  /** Where this listener stopped last time. */
  resumed: boolean;
  nowMs: number;
  playing: boolean;
  canFix: boolean;
  history: TranscriptCommit[] | null;
  lang: Lang;
  onOpen: () => void;
  onPlayFrom: (ms: number) => void;
  onFixed: (content: string, complete: boolean, merged: boolean) => void;
  pickWords: { from: number; to: number; unclear?: boolean } | null;
  numberOf: (segment: string) => number;
  /** Fixes of this paragraph's words that wait for approval, and who is signed in, to tell theirs from others'. */
  waiting: Pending[];
  me: string | null;
}) {
  const player = usePlayer();
  const ref = useRef<HTMLLIElement>(null);
  // An unsent fix of this paragraph, from before a reload, opens again as it was left.
  const [editing, setEditingNow] = useState<Editing | null>(() => (typeof window !== 'undefined' ? recall<Editing>(DRAFT + paragraph.id) : null));
  const setEditing = (next: Editing | null) => {
    keep(DRAFT + paragraph.id, next);
    setEditingNow(next);
  };
  const [sent, setSent] = useState<Sent | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [discussing, setDiscussing] = useState<{ from: number; to: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (active && !editing) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active, editing]);
  useEffect(() => {
    if (found) ref.current?.scrollIntoView({ block: 'center' });
  }, [found]);
  // Words picked in the text open their editor here, already marked when they were picked as unclear.
  useEffect(() => {
    if (!pickWords || !canFix) return;
    const words = base.slice(pickWords.from, pickWords.to);
    setEditing({ kind: 'words', from: pickWords.from, to: pickWords.to, value: pickWords.unclear ? markUnclear(words) : words });
    // Only a new pick opens it; the words changing under it (an approved fix) must not open it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickWords]);

  // The recording waits while the words are being fixed, and goes on from a little before, so nothing is missed.
  const resume = useRef(false);
  const isEditing = editing !== null;
  useEffect(() => {
    if (isEditing && playing && player.playing) {
      player.toggle();
      resume.current = true;
    } else if (!isEditing && resume.current) {
      resume.current = false;
      if (playing && !player.playing) {
        player.seek(Math.max(0, player.now() - 2));
        player.toggle();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing]);

  async function send(content: string, complete: boolean) {
    setError(null);
    setBusy(true);
    try {
      const row = await postJson<{ status?: string }>(`recordings/${recording}/transcript/fix`, { segment: paragraph.id, content, complete });
      const merged = row.status === 'merged';
      setSent({ content, complete, merged });
      setEditing(null);
      if (merged) onFixed(content, complete, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }


  const pending = sent && !sent.merged ? sent : null;
  // This listener's own fix that still waits: they go on from it, so it is never typed twice and a new fix never undoes their last.
  const mine = pending ?? [...waiting].reverse().find((x) => x.author === me) ?? null;
  const base = mine?.content ?? paragraph.content;
  const shown = base === paragraph.content ? paragraph : { ...paragraph, content: base, words: null };
  const tokens = tokensOf(shown);
  const marks = unclearRanges(base);
  // Fixes already sent by others, or by this listener before, and not yet approved: their words are shown as they will be, below.
  const others = waiting.filter((x) => x.content !== sent?.content);
  const changing = mine ? pendingRanges(base, paragraph.content) : others.flatMap((x) => pendingRanges(paragraph.content, x.content));
  const text: React.ReactNode[] = [];
  let at = 0;
  for (const [i, tk] of tokens.entries()) {
    if (tk.from > at) text.push(base.slice(at, tk.from));
    const next = tokens[i + 1]?.ms ?? paragraph.endMs ?? Infinity;
    const state = active && tk.ms !== null ? (nowMs >= tk.ms && nowMs < next ? ' w-now' : nowMs >= next ? ' w-past' : '') : '';
    const picked = editing?.kind === 'words' && tk.from < editing.to && tk.to > editing.from ? ' w-picked' : '';
    const unclear = marks.some((m) => tk.from < m.to && tk.to > m.from);
    const pendingWord = changing.some((m) => tk.from < m.to && tk.to > m.from);
    const title = [unclear ? t(lang, 'unclearWords') : '', pendingWord ? t(lang, 'pendingFix') : ''].filter(Boolean).join(' · ');
    text.push(
      <span key={i} className={`word${state}${picked}${unclear ? ' w-unclear' : ''}${pendingWord ? ' w-pending' : ''}`} data-ms={tk.ms ?? undefined} title={title || undefined}>
        {base.slice(tk.from, tk.to)}
      </span>,
    );
    at = tk.to;
  }
  if (at < base.length) text.push(base.slice(at));

  const status = paragraph.checked ? 'checked' : paragraph.edited ? 'partly' : 'machine';
  const classes = ['tx-para', open ? 'open' : '', active ? 'active' : '', found ? 'found' : '', `is-${status}`].filter(Boolean).join(' ');

  return (
    <li ref={ref} id={`p-${paragraph.id}`} className={classes}>
      <div className="tx-para-head">
        <span className="tx-n">{n}</span>
        {paragraph.startMs !== null ? (
          <button type="button" className="tx-time" onClick={() => onPlayFrom(paragraph.startMs ?? 0)}>
            {clockOf(paragraph.startMs)}
          </button>
        ) : null}
        {status === 'checked' ? (
          <span className="tx-state ok">
            <Check size={12} aria-hidden />
            {w(lang, 'checked')}
          </span>
        ) : status === 'partly' ? (
          <span className="tx-state partly">{w(lang, 'partly')}</span>
        ) : (
          <MachineLabel lang={lang} size="sm" />
        )}
        {resumed ? <span className="tx-state resumed">{w(lang, 'continueHere')}</span> : null}
      </div>

      <div
        className="tx-text"
        data-para={paragraph.id}
        dir="auto"
        onClick={(e) => {
          if (!document.getSelection()?.isCollapsed) return;
          onOpen();
          const ms = (e.target as HTMLElement).closest<HTMLElement>('[data-ms]')?.dataset.ms;
          onPlayFrom(ms ? Number(ms) : (paragraph.startMs ?? 0));
        }}
      >
        {text}
      </div>

      {others.map((x) => (
        <div key={`${x.suggestion}:${x.at}`} className="tx-pending">
          <span className="row-sub">
            {x.author === me ? w(lang, 'yourFix') : w(lang, 'theirFix').replace('{name}', x.authorName ?? x.author)}
            {x.suggestion !== null ? (
              <>
                {' · '}
                <Link to={href(`/suggestions/${x.suggestion}`, lang)}>#{x.suggestion}</Link>
              </>
            ) : null}
          </span>
          <p className="tx-diff" dir="auto">
            <InlineDiff parts={wordDiff(paragraph.content, x.content)} />
          </p>
        </div>
      ))}

      {pending ? (
        <div className="tx-pending">
          <span className="row-sub">{w(lang, 'yourFix')}</span>
          <p className="tx-diff" dir="auto">
            <InlineDiff parts={wordDiff(paragraph.content, pending.content)} />
          </p>
        </div>
      ) : null}

      {editing?.kind === 'words' ? (
        <div className="tx-edit">
          <label className="row-sub" htmlFor={`fix-${paragraph.id}`}>
            {w(lang, 'fixWords')}
          </label>
          <input id={`fix-${paragraph.id}`} className="input" dir="auto" autoFocus value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} onKeyDown={(e) => e.key === 'Escape' && setEditing(null)} />
          <SpellingHints text={editing.value} lang={lang} />
          <div className="actions">
            <button
              type="button"
              className="btn primary"
              disabled={busy || editing.value === base.slice(editing.from, editing.to)}
              onClick={() => send(`${base.slice(0, editing.from)}${editing.value}${base.slice(editing.to)}`, false)}
            >
              {w(lang, 'save')}
            </button>
            {!/^\[.*\?\]$/.test(editing.value.trim()) ? (
              <button type="button" className="btn" onClick={() => setEditing({ ...editing, value: markUnclear(editing.value.trim()) })}>
                <ShieldQuestion size={15} aria-hidden />
                {w(lang, 'markUnclear')}
              </button>
            ) : null}
            <button type="button" className="btn" onClick={() => setEditing(null)}>
              {w(lang, 'cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {editing?.kind === 'all' ? (
        <div className="tx-edit">
          <textarea value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })} rows={6} dir="auto" autoFocus />
          <SpellingHints text={editing.value} lang={lang} />
          <label className="tx-complete">
            <input type="checkbox" checked={editing.complete} onChange={(e) => setEditing({ ...editing, complete: e.target.checked })} />
            {w(lang, 'wholeRight')}
          </label>
          <div className="actions">
            <button type="button" className="btn primary" disabled={busy || !editing.value.trim() || (editing.value.trim() === base && !editing.complete)} onClick={() => send(editing.value, editing.complete)}>
              {w(lang, 'save')}
            </button>
            <button type="button" className="btn" onClick={() => setEditing(null)}>
              {w(lang, 'cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {open && !editing ? (
        <div className="tx-tools">
          {canFix && !paragraph.checked && !sent ? (
            <button type="button" className="tx-tool" onClick={() => send(base, true)} disabled={busy}>
              <Check size={16} aria-hidden />
              {w(lang, 'allRight')}
            </button>
          ) : null}
          {canFix ? (
            <button type="button" className="tx-tool" onClick={() => setEditing({ kind: 'all', value: base, complete: true })}>
              <Pencil size={16} aria-hidden />
              {w(lang, 'edit')}
            </button>
          ) : null}
          {marks.map((m) => (
            <button key={m.from} type="button" className={discussing?.from === m.from ? 'tx-tool on' : 'tx-tool'} onClick={() => setDiscussing(discussing?.from === m.from ? null : m)}>
              <MessageCircle size={16} aria-hidden />
              {discussLabel[lang]} · <span dir="auto">{base.slice(m.from, m.to)}</span>
            </button>
          ))}
          <button type="button" className={showHistory ? 'tx-tool on' : 'tx-tool'} onClick={() => setShowHistory((s) => !s)} aria-expanded={showHistory}>
            <History size={16} aria-hidden />
            {w(lang, 'history')}
          </button>
        </div>
      ) : null}

      {open && discussing ? (
        <DiscussUnclear
          recording={recording}
          words={base.slice(discussing.from, discussing.to)}
          atMs={tokens.find((tk) => tk.to > discussing.from && tk.ms !== null)?.ms ?? paragraph.startMs}
          lang={lang}
          signedIn={canFix}
          onClose={() => setDiscussing(null)}
        />
      ) : null}

      {sent ? <p className="row-sub tx-sent">{w(lang, sent.merged ? 'saved' : 'sent')}</p> : null}
      {error ? <p role="alert">{error}</p> : null}

      {open && showHistory ? (
        <div className="tx-history">
          {history === null ? (
            <p className="row-sub">…</p>
          ) : (
            <ul>
              {history.map((c) => (
                <ChangeRow key={c.commit} commit={c} lang={lang} numberOf={numberOf} only={paragraph.id} />
              ))}
            </ul>
          )}
          <Link className="row-sub" to={href(`/history/${paragraph.id}`, lang)}>
            {w(lang, 'fullHistory')}
          </Link>
        </div>
      ) : null}
    </li>
  );
}

export function TranscriptEditor({
  transcripts,
  tracks,
  lang,
  nowMs,
  found,
  account,
  onBack,
  onFixed,
}: {
  transcripts: Transcript[];
  tracks: Track[];
  lang: Lang;
  nowMs: number;
  found: string | null;
  account: unknown;
  onBack: () => void;
  onFixed: (recording: string, segment: string, content: string, complete: boolean) => void;
}) {
  const player = usePlayer();
  // Where this listener stopped last time in these recordings, unless a link names a paragraph.
  const placeKey = PLACE + transcripts.map((tr) => tr.recording).join(',');
  const [start] = useState<string | null>(() => found ?? (typeof window !== 'undefined' ? recall<string>(placeKey) : null));
  const [open, setOpenNow] = useState<string | null>(start);
  const setOpen = (segment: string) => {
    keep(placeKey, segment);
    setOpenNow(segment);
  };
  const [pick, setPick] = useState<{ segment: string; from: number; to: number; unclear?: boolean } | null>(null);
  const [offer, setOffer] = useState<{ segment: string; from: number; to: number; words: string } | null>(null);
  const [history, setHistory] = useState<Record<string, TranscriptCommit[]>>({});
  const [showAll, setShowAll] = useState(false);
  const canFix = Boolean(account);
  const me = useAccount()?.person.id ?? null;
  const waitingAll = transcripts.flatMap((tr) => tr.pending ?? []);

  // The changelog of every part, read once, when it is first wanted.
  const wanted = showAll || open !== null;
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    for (const tr of transcripts) {
      if (history[tr.recording]) continue;
      void get<{ history: TranscriptCommit[] }>(`recordings/${tr.recording}/transcript/history`)
        .then((r) => live && setHistory((h) => ({ ...h, [tr.recording]: r.history })))
        .catch(() => live && setHistory((h) => ({ ...h, [tr.recording]: [] })));
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, transcripts.map((tr) => tr.recording).join(',')]);

  // Words selected inside one paragraph's text are offered for fixing, widened to whole words.
  useEffect(() => {
    if (!canFix) return;
    const onSelection = () => {
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return setOffer(null);
      const range = sel.getRangeAt(0);
      const hostOf = (n: Node) => (n instanceof Element ? n : n.parentElement)?.closest<HTMLElement>('[data-para]') ?? null;
      const host = hostOf(range.startContainer);
      if (!host || host !== hostOf(range.endContainer)) return setOffer(null);
      const segment = host.dataset.para!;
      const paragraph = transcripts.flatMap((tr) => tr.paragraphs).find((p) => p.id === segment);
      if (!paragraph) return setOffer(null);
      // The words as shown: the listener's own waiting fix, where they have one.
      const content = host.textContent ?? paragraph.content;
      const span = wholeWords(content, offsetIn(host, range.startContainer, range.startOffset), offsetIn(host, range.endContainer, range.endOffset));
      setOffer(span.to > span.from ? { segment, ...span, words: content.slice(span.from, span.to) } : null);
    };
    document.addEventListener('selectionchange', onSelection);
    return () => document.removeEventListener('selectionchange', onSelection);
  }, [canFix, transcripts]);

  const all = transcripts.flatMap((tr) => tr.paragraphs);
  const checked = all.filter((p) => p.checked).length;
  const numbers = new Map(all.map((p, i) => [p.id, i + 1]));
  const numberOf = (segment: string) => numbers.get(segment) ?? 0;
  const commits = transcripts.flatMap((tr) => history[tr.recording] ?? []).sort((a, b) => b.commit - a.commit);
  const offered = offer ? all.find((p) => p.id === offer.segment) : undefined;

  return (
    <>
      <div className="review-head">
        <h2 className="section-header">{w(lang, 'title')}</h2>
        <button type="button" className="btn" onClick={onBack}>
          <Undo2 size={16} aria-hidden />
          {w(lang, 'back')}
        </button>
      </div>

      <div className="tx-top">
        <div className="tx-progress">
          <span className="row-sub">{w(lang, 'progress').replace('{n}', checked.toLocaleString(lang)).replace('{of}', all.length.toLocaleString(lang))}</span>
          <Bar value={checked} max={all.length || 1} tone="open" />
        </div>
        <details className="tx-how">
          <summary>
            <CircleHelp size={15} aria-hidden />
            {w(lang, 'how')}
          </summary>
          <ul>
            <li>{w(lang, 'howTap')}</li>
            <li>{w(lang, 'howSelect')}</li>
            <li>{w(lang, 'howRight')}</li>
            <li>{w(lang, 'howEdit')}</li>
            <li>{w(lang, 'howUnclear')}</li>
            <li>{w(lang, 'howPause')}</li>
            <li>{w(lang, 'howHistory')}</li>
          </ul>
        </details>
        <p className="note machine-note">{t(lang, 'lyricsMachineHint')}</p>
        {waitingAll.length ? (
          <p className="row-sub tx-waiting-note">
            {w(lang, 'waitingCount').replace('{n}', waitingAll.length.toLocaleString(lang))}
            {' · '}
            <Link to={href('/review', lang, { view: 'transcripts' })}>{w(lang, 'reviewAll')}</Link>
          </p>
        ) : null}
        {canFix && checked < all.length ? <TrainingGoalBar lang={lang} /> : null}
        {!canFix ? (
          <p className="row-sub">
            {w(lang, 'signIn')} <Link to={href('/signin', lang)}>{t(lang, 'signIn')}</Link>
          </p>
        ) : null}
        <details className="tx-all" open={showAll} onToggle={(e) => setShowAll((e.target as HTMLDetailsElement).open)}>
          <summary>
            <History size={15} aria-hidden />
            {w(lang, 'allChanges')}
          </summary>
          {showAll && waitingAll.length ? (
            <div className="tx-waiting">
              <h4 className="row-sub">
                {w(lang, 'waitingTitle')} · {waitingAll.length.toLocaleString(lang)}
                {' · '}
                <Link to={href('/review', lang, { view: 'transcripts' })}>{w(lang, 'reviewAll')}</Link>
              </h4>
              <ul>
                {waitingAll.map((x) => (
                  <li key={`${x.suggestion}:${x.segment}`}>
                    <button type="button" className="tx-waiting-n" onClick={() => setOpen(x.segment)}>
                      ¶{numberOf(x.segment)}
                    </button>{' '}
                    <span className="row-sub">
                      {x.authorName ?? x.author}
                      {x.suggestion !== null ? ` · #${x.suggestion}` : ''}
                    </span>
                    <p className="tx-diff" dir="auto">
                      <InlineDiff parts={wordDiff(all.find((p) => p.id === x.segment)?.content ?? '', x.content)} />
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {showAll ? (
            transcripts.some((tr) => !history[tr.recording]) ? (
              <p className="row-sub">…</p>
            ) : commits.some((c) => c.changes.some((x) => x.kind !== 'made')) ? (
              <ul>
                {commits.map((c) => (
                  <ChangeRow key={c.commit} commit={c} lang={lang} numberOf={numberOf} />
                ))}
              </ul>
            ) : (
              <p className="row-sub">{w(lang, 'noChanges')}</p>
            )
          ) : null}
        </details>
      </div>

      {transcripts.map((tr) => {
        const index = tracks.findIndex((track) => track.id === tr.recording);
        const playing = player.current?.id === tr.recording;
        const playFrom = (ms: number) => (playing ? player.seek(ms / 1000) : player.play(tracks, index, ms / 1000));
        return (
          <div key={tr.recording}>
            {transcripts.length > 1 ? <h3>{tracks[index]?.title}</h3> : null}
            <ol className="tx-list">
              {tr.paragraphs.map((p) => (
                <Para
                  key={p.id}
                  n={numberOf(p.id)}
                  recording={tr.recording}
                  paragraph={p}
                  open={open === p.id}
                  active={playing && within(nowMs, p)}
                  found={p.id === start}
                  resumed={p.id === start && !found}
                  nowMs={nowMs}
                  playing={playing}
                  canFix={canFix}
                  history={history[tr.recording] ?? null}
                  lang={lang}
                  onOpen={() => setOpen(p.id)}
                  onPlayFrom={(ms) => {
                    playFrom(ms);
                    if (playing && !player.playing) player.toggle();
                  }}
                  onFixed={(content, complete) => onFixed(tr.recording, p.id, content, complete)}
                  pickWords={pick?.segment === p.id ? pick : null}
                  numberOf={numberOf}
                  waiting={(tr.pending ?? []).filter((x) => x.segment === p.id)}
                  me={me}
                />
              ))}
            </ol>
            {canFix && tr.paragraphs.some((p) => p.syncChecked === false) ? <ConfirmSync recording={tr.recording} lang={lang} /> : null}
          </div>
        );
      })}

      {offer && offered ? (
        <div className="tx-pick" role="dialog" aria-label={w(lang, 'fixWords')}>
          <span className="tx-pick-words" dir="auto">
            {offer.words}
          </span>
          <button
            type="button"
            className="btn primary"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setOpen(offer.segment);
              setPick({ ...offer });
              setOffer(null);
              document.getSelection()?.removeAllRanges();
            }}
          >
            <Pencil size={15} aria-hidden />
            {w(lang, 'fixWords')}
          </button>
          <button
            type="button"
            className="btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setOpen(offer.segment);
              setPick({ ...offer, unclear: true });
              setOffer(null);
              document.getSelection()?.removeAllRanges();
            }}
          >
            <ShieldQuestion size={15} aria-hidden />
            {w(lang, 'unclear')}
          </button>
          <button type="button" className="icon-button" aria-label={w(lang, 'cancel')} onClick={() => (document.getSelection()?.removeAllRanges(), setOffer(null))}>
            <X size={16} />
          </button>
        </div>
      ) : null}
    </>
  );
}
