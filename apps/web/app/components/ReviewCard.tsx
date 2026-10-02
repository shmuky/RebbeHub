import { useEffect, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react';
import { Clamp } from '../ui/Clamp.js';
import { Link } from 'react-router';
import { ChangeDiff } from './ChangeDiff.js';
import { fieldName, isInfoOnly, onlyInfo } from './ChangeTable.js';
import { PlainWords } from './PlainWords.js';
import type { ChangeGroup, SuggestionDetail } from '../lib/api.js';
import { t, typeName, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { labelOf } from '../lib/labels.js';
import { st } from '../lib/scanStrings.js';
import { href } from '../lib/links.js';
import { LABELS, detailLabels, stateOf, stateWord } from '../lib/suggestions.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { Avatar, Label, MachineLabel, RelativeTime, Skeleton, StateIcon, StatusBadge } from '../ui/primitives.js';

/**
 * One Suggestion in the review queue (routes/review.tsx). Drawn at once
 * from the list (its title, who sent it, how many items it changes), and
 * its changes read only when it comes into view, a page of items at a
 * time: a bot's Suggestion can change 500 items, and a queue of them must
 * still open on a phone. Items that change the same way are summed up
 * first ("500 units: links on the media proxy became links on Drive"),
 * so a keeper can look at a few and approve them all. A bot's Suggestion
 * is shown as the bot's, marked as a machine's work until a person
 * checks it. Approve and Send back act on the whole Suggestion, however
 * few of its items have been read.
 */

export interface ReviewRow {
  id: number;
  /** Its #number, shared with issues; imports have none. */
  number?: number | null;
  title: string;
  description: string | null;
  author: string;
  status: 'draft' | 'open' | 'merged' | 'sent_back' | 'withdrawn';
  kind: 'suggestion' | 'import' | 'revert' | 'live';
  post_review: 'pending' | 'done' | null;
  submitted_at: string | null;
  created_at: string;
  /** Only a Suggestion read on its own carries its checks; a list row has none until its changes are read. */
  checks?: Array<{ check: string; status: 'pass' | 'warn' | 'fail'; message: string }>;
  /** How many items it changes. */
  items?: number;
}

export interface ReviewPerson {
  name: string;
  bot: boolean;
}

export interface ReviewDetail {
  changeset: ReviewRow;
  entries: Array<{ entityId: string; type: string; before: unknown; after: unknown; changes: Array<{ path: string; before?: unknown; after?: unknown }>; conflicts: unknown[]; withheld?: string }>;
  total?: number;
  next?: number | null;
  summary?: ChangeGroup[];
  /** With the summary: how many items clash with a later change on the site, and how many the site already holds as suggested. */
  clashes?: number;
  unchanged?: number;
  reviews: Array<{ reviewer: string; verdict: 'approve' | 'send_back'; body: string | null; created_at: string }>;
  names: Record<string, string>;
  /** The items its changes point at, by what they are called (a part moved to another sefer reads as that sefer's name). */
  items?: Record<string, { type: string; data: Record<string, unknown> }>;
  files: Record<string, { url: string | null; mime: string; bytes: number; rights: string; similar?: Array<{ kind: 'same' | 'shares'; matched?: number; of?: number; items: Array<{ id: string; type: string; path: string | null }> }> }>;
  mayApprove: boolean;
  mine: boolean;
  /** The reviewer's advice, written by a machine (null until one has been written). */
  advice: { summary: string; model: string; at: string; machine: true } | null;
}

/** Items read at a time: a few to look at, the rest on "Show more" (a phone drew 25 of a bot's items at once and stopped). */
export const REVIEW_PAGE = 10;

const W = {
  suggested: { he: 'הציע', en: 'suggested' },
  wentLive: { he: 'עלה מיד · נבדק אחרי', en: 'Went live · reviewed after' },
  discussion: { he: 'לדיון המלא', en: 'Full discussion' },
  checks: { he: 'בדיקות', en: 'Checks' },
  sentBackBy: { he: 'הוחזרה בידי', en: 'Sent back by' },
  cantApprove: { he: 'רק אחראי האוסף מאשרים', en: 'Only the keepers approve' },
  bot: { he: 'בוט', en: 'bot' },
  items: { he: 'פריטים', en: 'items' },
  item: { he: 'פריט אחד', en: '1 item' },
  showMore: { he: 'להציג עוד', en: 'Show more' },
  left: { he: 'נותרו', en: 'left' },
  shown: { he: 'מוצגים', en: 'Showing' },
  of: { he: 'מתוך', en: 'of' },
  summary: { he: 'מה משתנה', en: 'What changes' },
  summaryNote: {
    he: 'הפריטים מקובצים לפי השינוי: אותם שדות, באותו אופן. בודקים כמה דוגמאות, והאישור חל על כולם.',
    en: 'Items grouped by their change: the same fields, changed the same way. Look at a few examples; approving approves them all.',
  },
  examples: { he: 'דוגמאות', en: 'Examples' },
  example: { he: 'דוגמה', en: 'Example' },
  words: { he: 'הטקסט', en: 'The words' },
  changes: { he: 'משתנה', en: 'changed' },
  added: { he: 'נוסף', en: 'added' },
  removed: { he: 'נמחק', en: 'removed' },
  moreFields: { he: 'שדות נוספים', en: 'more' },
  moreWays: { he: 'ועוד סוגי שינויים', en: 'more kinds of change' },
  new: { he: 'חדשים', en: 'new' },
  deleted: { he: 'נמחקים', en: 'deleted' },
  all: { he: 'הכול', en: 'all' },
  loadError: { he: 'לא נטען. לנסות שוב', en: "Didn't load. Try again" },
  clashTitle: { he: 'פריטים שהשתנו באתר מאז', en: 'Items changed on the site since' },
  clashWhy: {
    he: 'באתר שונו השדות האלה אחרי שההצעה נכתבה. בוחרים פעם אחת מה נשאר בכולם:',
    en: 'These fields were changed on the site after this was suggested. Choose once what stays in all of them:',
  },
  keepSite: { he: 'לאשר, להשאיר את מה שבאתר', en: "Approve, keep what's on the site" },
  takeSuggested: { he: 'לאשר, לקחת את ההצעה', en: 'Approve, take the suggestion' },
  unchanged: { he: 'כבר באתר כפי שהוצע', en: 'already on the site as suggested' },
  merging: { he: 'ממזג…', en: 'Merging…' },
  sendingBack: { he: 'מחזיר…', en: 'Sending back…' },
  withdrawing: { he: 'מבטל…', en: 'Withdrawing…' },
  keeping: { he: 'משאיר…', en: 'Keeping…' },
  undoing: { he: 'מבטל…', en: 'Undoing…' },
  merged: { he: 'מוזג', en: 'Merged' },
  sentBack: { he: 'הוחזרה למציע', en: 'Sent back' },
  withdrawn: { he: 'בוטלה', en: 'Withdrawn' },
  kept: { he: 'נשאר', en: 'Kept' },
  undone: { he: 'בוטל', en: 'Undone' },
} as const;

/** A decision a keeper (or the author) makes on the card, and the API's address for it. Approving over clashes takes the site's version or the suggestion's. */
export type Doing = 'approve' | 'approve-theirs' | 'send-back' | 'withdraw' | 'keep-live' | 'undo-live';

const DECISIONS: Record<Doing, { path: string; working: keyof typeof W; done: keyof typeof W }> = {
  approve: { path: 'approve', working: 'merging', done: 'merged' },
  'approve-theirs': { path: 'approve', working: 'merging', done: 'merged' },
  'send-back': { path: 'send-back', working: 'sendingBack', done: 'sentBack' },
  withdraw: { path: 'withdraw', working: 'withdrawing', done: 'withdrawn' },
  'keep-live': { path: 'review-live', working: 'keeping', done: 'kept' },
  'undo-live': { path: 'review-live', working: 'undoing', done: 'undone' },
};

/**
 * What the Suggestion is once the API has said yes to a decision: an
 * approval merges it there and then (Catalog.merge), so the card can draw
 * it merged at once, without waiting for the queue to be read again.
 */
export function decidedAs(doing: Doing): Pick<ReviewRow, 'status'> | Pick<ReviewRow, 'post_review'> {
  if (doing === 'approve' || doing === 'approve-theirs') return { status: 'merged' };
  if (doing === 'send-back') return { status: 'sent_back' };
  if (doing === 'withdraw') return { status: 'withdrawn' };
  return { post_review: 'done' };
}

/** A card's decision as it stands: being sent, answered, or refused. */
export interface Decision {
  /** Sent and not yet answered: its button says so, and no button can be pressed again. */
  doing: Doing | null;
  /** Answered: what was decided, drawn over the card's own copy of the Suggestion. */
  done: Doing | null;
  error: string | null;
  /** Clashes found by Approve itself, where the summary had not counted them (a page read without it). */
  refused: number | null;
}

export const UNDECIDED: Decision = { doing: null, done: null, error: null, refused: null };

/** One decision for every clash: `*` stands for every item and every field. In a merge "ours" is the site's version, "theirs" the suggestion's. */
export const KEEP_SITE = { '*': { '*': { take: 'ours' } } } as const;
export const TAKE_SUGGESTED = { '*': { '*': { take: 'theirs' } } } as const;

/** An answer the API refused, with the clashes it names when that was the reason. */
class CallError extends Error {
  constructor(
    message: string,
    readonly conflicts: unknown[] | undefined,
  ) {
    super(message);
  }
}

/** What a field was or became, as the summary says it: a kind of value, or links and the sites they point to. */
const KINDS: Record<string, { he: string; en: string }> = {
  none: { he: 'ריק', en: 'empty' },
  text: { he: 'טקסט', en: 'text' },
  number: { he: 'מספר', en: 'a number' },
  list: { he: 'רשימה', en: 'a list' },
  object: { he: 'ערכים', en: 'fields' },
  true: { he: 'כן', en: 'yes' },
  false: { he: 'לא', en: 'no' },
};

export function valueWords(value: string, lang: Lang): string {
  if (value.startsWith('link:')) return `${lang === 'he' ? 'קישורים אל' : 'links to'} ${value.slice(5)}`;
  return KINDS[value]?.[lang] ?? value;
}

type Change = ReviewDetail['entries'][number]['changes'][number];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A change to a list or a set of fields, down to the values that changed
 * in it (`/links/0/url`: the old address and the new), so an example of a
 * bulk change shows what it does rather than "(changed)".
 */
export function leafChanges(change: Change): Change[] {
  const walk = (path: string, before: unknown, after: unknown): Change[] => {
    if (JSON.stringify(before) === JSON.stringify(after)) return [];
    if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) return before.flatMap((b, i) => walk(`${path}/${i}`, b, after[i]));
    if (isRecord(before) && isRecord(after)) return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((k) => walk(`${path}/${k}`, before[k], after[k]));
    return [{ path, before, after }];
  };
  const out = walk(change.path, change.before, change.after);
  return out.length ? out : [change];
}

async function call<T>(path: string, init?: { method: 'POST'; body: unknown }): Promise<T> {
  const response = await fetch(`/_/suggestions${path}`, {
    method: init?.method ?? 'GET',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    body: init ? JSON.stringify(init.body) : undefined,
  });
  const json = (await response.json().catch(() => ({}))) as T & { message?: string; conflicts?: unknown[] };
  if (!response.ok) throw new CallError(json.message ?? response.statusText, json.conflicts);
  return json;
}

export { call as suggestionCall };

/** A new item, as the reviewer needs it: what kind it is, its name, and its file to hear or read before approving. */
function NewItem({ type, data, files, lang }: { type: string; data: Record<string, unknown>; files: ReviewDetail['files']; lang: Lang }) {
  const sha = typeof data.file === 'string' ? data.file : null;
  const file = sha ? files[sha] : undefined;
  const title = labelOf({ id: '', type, data } as Parameters<typeof labelOf>[0], lang);
  return (
    <section className="diff rq-new">
      <header className="diff-h">
        <Icon name="plus" />
        <b>{title}</b>
        <span className="subtle">
          {t(lang, 'newItem')}: {typeName(type, lang)}
        </span>
        {file ? <span className="end num subtle">{`${(file.bytes / 1024 / 1024).toLocaleString(lang === 'he' ? 'he-IL' : 'en-US', { maximumFractionDigits: 1 })} MB`}</span> : null}
      </header>
      <div className="rq-new-b">
        {file?.url && file.mime.startsWith('audio/') ? <audio controls preload="none" src={file.url} /> : null}
        {file?.url && file.mime === 'application/pdf' ? (
          <a className="btn sm" href={file.url} target="_blank" rel="noreferrer">
            <Icon name="file" />
            {t(lang, 'openFile')}
          </a>
        ) : null}
        {file && !file.url ? (
          <p className="subtle">
            <Icon name="lock" size={14} /> {t(lang, 'filePrivate')}
          </p>
        ) : null}
        {sha ? (
          <Link className="num subtle rq-sha" to={href(`/files/${sha}`, lang)} dir="ltr">
            {sha.slice(0, 12)}…
          </Link>
        ) : null}
        {/* What the jobs found it looks like: a machine's guess, for the reviewer to check. */}
        {file?.similar?.map((s, i) => (
          <p key={i} className="rq-similar">
            <MachineLabel lang={lang} size="sm" />
            {st(lang, 'machineLooksLike')}{' '}
            {s.items.map((item, j) => (
              <span key={item.id}>
                {j > 0 ? ', ' : ''}
                <Link to={href(item.path ?? `/${item.id}`, lang)}>{typeName(item.type, lang)}</Link>
              </span>
            ))}
            {s.of ? ` (${s.matched}/${s.of} ${st(lang, 'pagesAlike')})` : ''}
          </p>
        ))}
      </div>
    </section>
  );
}

/** The reviewer's advice: a machine's summary in English, said to be one, deciding nothing. */
function Advice({ advice, lang }: { advice: NonNullable<ReviewDetail['advice']>; lang: Lang }) {
  return (
    <aside className="rq-advice" aria-label={t(lang, 'adviceTitle')}>
      <header>
        <Icon name="bot" />
        <b>{t(lang, 'adviceTitle')}</b>
        <MachineLabel lang={lang} size="sm" />
        <span className="end subtle num" dir="ltr">
          {advice.model}
        </span>
      </header>
      <p dir="ltr" lang="en">
        {advice.summary}
      </p>
      <footer>{t(lang, 'adviceNote')}</footer>
    </aside>
  );
}

/** At most this many kinds of change, and fields in each, on the card: a phone draws a few lines, not a bot's every field (Shmuly, 30 Tishrei). */
const SUMMARY_GROUPS = 5;
const SUMMARY_FIELDS = 3;

/** A field in the summary as people say it, and what became of it, when that says something. */
export interface SummaryLine {
  name: string;
  before?: string;
  after?: string;
  /** Only `added`, `removed` or `changes`, when the kinds say nothing ("a list → a list"). */
  what?: 'added' | 'removed' | 'changes';
}

/**
 * A group's fields as a reader takes them in: a page's words (every
 * segment, printed line and note under /body) are one line, "The words
 * changes"; a sync's timings and a machine's details are left out (they
 * are not the words or the file); a field by its name, not its path; links
 * by the sites they point to; anything else only as added, removed or
 * changed. At most `limit` lines; `more` counts the rest.
 */
export function summaryLines(fields: ChangeGroup['fields'], lang: Lang, limit = SUMMARY_FIELDS): { lines: SummaryLine[]; more: number } {
  const byName = new Map<string, SummaryLine>();
  for (const f of fields) {
    if (isInfoOnly(f.path)) continue;
    const words = f.path.startsWith('/body');
    const name = words ? W.words[lang] : fieldName(f.path.replace(/\/\*(?=\/|$)/g, ''), lang) || W.all[lang];
    const links = f.before.startsWith('link:') || f.after.startsWith('link:');
    const line: SummaryLine =
      !words && links
        ? { name, before: valueWords(f.before, lang), after: valueWords(f.after, lang) }
        : { name, what: words ? 'changes' : f.before === 'none' ? 'added' : f.after === 'none' ? 'removed' : 'changes' };
    const had = byName.get(name);
    if (!had) byName.set(name, line);
    else if (had.what !== line.what || had.before !== line.before || had.after !== line.after) byName.set(name, { name, what: 'changes' });
  }
  const lines = [...byName.values()];
  return { lines: lines.slice(0, limit), more: Math.max(0, lines.length - limit) };
}

/** Every item, grouped by how it changes: "500 × farbrengen · Links: links to the proxy → links to Drive", with a few examples each. */
export function ChangeSummary({ groups, total, lang }: { groups: ChangeGroup[]; total: number; lang: Lang }) {
  // Groups the API kept apart (their words changed in different segments) read the same here: one line for them all.
  const alike = new Map<string, { group: ChangeGroup; summary: ReturnType<typeof summaryLines> }>();
  for (const g of groups) {
    const summary = summaryLines(g.fields, lang);
    const key = JSON.stringify([g.type, g.kind, summary]);
    const had = alike.get(key);
    if (had) had.group = { ...had.group, count: had.group.count + g.count, examples: [...had.group.examples, ...g.examples].slice(0, 3) };
    else alike.set(key, { group: g, summary });
  }
  const merged = [...alike.values()].sort((a, b) => b.group.count - a.group.count);
  const shown = merged.slice(0, SUMMARY_GROUPS);
  const rest = merged.slice(SUMMARY_GROUPS).reduce((n, g) => n + g.group.count, 0);
  return (
    <section className="rq-summary" aria-label={W.summary[lang]}>
      <header>
        <Icon name="layers" />
        <b>{W.summary[lang]}</b>
        <span className="end subtle num">
          {num(total, lang)} {W.items[lang]}
        </span>
      </header>
      <ul>
        {shown.map(({ group: g, summary: { lines, more } }, i) => {
          return (
            <li key={i}>
              <span className="rq-summary-n num">{num(g.count, lang)}</span>
              <span className="rq-summary-what">
                <b>
                  {typeName(g.type, lang)}
                  {g.kind !== 'changed' ? <span className="subtle"> · {W[g.kind][lang]}</span> : null}
                </b>
                {lines.map((l) => (
                  <span key={l.name} className="rq-summary-field">
                    <span>{l.name}</span>
                    {l.what ? (
                      <span className="subtle">{W[l.what][lang]}</span>
                    ) : (
                      <>
                        <del>{l.before}</del>
                        <Icon name="arrow" size={12} className="flip" />
                        <ins>{l.after}</ins>
                      </>
                    )}
                  </span>
                ))}
                {more ? (
                  <span className="subtle">
                    +{num(more, lang)} {W.moreFields[lang]}
                  </span>
                ) : null}
                {/* An item to look at, by its place in the list: its id says nothing to a reader. */}
                <span className="rq-summary-ex subtle">
                  {g.examples.map((id, j) => (
                    <span key={id}>
                      {j > 0 ? ' · ' : ''}
                      <Link to={href(`/${id}`, lang)}>
                        {W.example[lang]} {num(j + 1, lang)}
                      </Link>
                    </span>
                  ))}
                </span>
              </span>
            </li>
          );
        })}
        {rest ? (
          <li>
            <span className="rq-summary-n num">{num(rest, lang)}</span>
            <span className="rq-summary-what subtle">{W.moreWays[lang]}</span>
          </li>
        ) : null}
      </ul>
      <footer>{W.summaryNote[lang]}</footer>
    </section>
  );
}

/** Whether an element has come near the screen (at once where the browser cannot tell, and when `eager`). */
function useSeen(ref: RefObject<HTMLElement | null>, eager: boolean): boolean {
  const [seen, setSeen] = useState(eager);
  useEffect(() => {
    if (seen) return;
    if (eager) return setSeen(true);
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setSeen(true);
    const io = new IntersectionObserver((all) => {
      if (all.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen, eager, ref]);
  return seen;
}

/** A Suggestion from the list, whose changes are read when it comes into view, a page at a time. */
export function ReviewCard({ row, person, lang, open, onDone, onDecidable }: { row: ReviewRow; person?: ReviewPerson; lang: Lang; open: boolean; onDone: () => void; onDecidable?: (id: number, mayApprove: boolean) => void }) {
  const ref = useRef<HTMLElement | null>(null);
  const seen = useSeen(ref, open);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!seen) return;
    let live = true;
    setLoadError(null);
    call<ReviewDetail>(`/${row.id}?limit=${REVIEW_PAGE}&summary=1`)
      .then((d) => {
        if (!live) return;
        setDetail(d);
        onDecidable?.(row.id, d.mayApprove);
      })
      .catch((e) => live && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen, row.id, attempt]);

  const more = async () => {
    if (!detail || detail.next === null || detail.next === undefined) return;
    setLoading(true);
    try {
      const page = await call<ReviewDetail>(`/${row.id}?offset=${detail.next}&limit=${REVIEW_PAGE}`);
      setDetail((d) => (d ? { ...d, entries: [...d.entries, ...page.entries], files: { ...d.files, ...page.files }, items: { ...d.items, ...page.items }, next: page.next ?? null } : d));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return <SuggestionCard cardRef={ref} row={row} person={person} detail={detail} lang={lang} open={open} onDone={onDone} onMore={more} loadingMore={loading} loadError={loadError} onRetry={() => setAttempt((n) => n + 1)} />;
}

/** One Suggestion as the queue draws it: from its list row alone until its changes are read. */
export function SuggestionCard({
  row,
  person,
  detail,
  lang,
  open,
  onDone,
  onMore,
  loadingMore = false,
  loadError = null,
  onRetry,
  cardRef,
  decision: shown,
}: {
  row: ReviewRow;
  person?: ReviewPerson;
  detail: ReviewDetail | null;
  lang: Lang;
  open: boolean;
  onDone: () => void;
  onMore?: () => void;
  loadingMore?: boolean;
  loadError?: string | null;
  onRetry?: () => void;
  cardRef?: Ref<HTMLElement>;
  /** A decision to draw in place of the card's own (a test draws each stage of one). */
  decision?: Decision;
}) {
  const [own, setDecision] = useState<Decision>(UNDECIDED);
  const decision = shown ?? own;
  const { doing, done, error, refused } = decision;
  // Pressed once: the button is off from that moment, before React draws it so, and a second press does nothing.
  const sending = useRef(false);
  const busy = doing !== null;
  const [note, setNote] = useState<string | null>(null);
  // Once the API has answered, the card is the Suggestion as it now is: merged, sent back or withdrawn, its buttons gone.
  const cs = { ...(detail?.changeset ?? row), ...(done ? decidedAs(done) : {}) };
  const author = person?.name ?? detail?.names[cs.author] ?? cs.author;
  const bot = person?.bot ?? cs.author.startsWith('bot:');
  const live = cs.post_review === 'pending';
  const state = live ? 'open' : stateOf(cs.status);
  const total = detail?.total ?? row.items ?? detail?.entries.length ?? 0;

  const act = (what: Doing, body: unknown = {}) => async () => {
    if (sending.current) return;
    sending.current = true;
    setDecision((d) => ({ ...d, doing: what, error: null }));
    try {
      await call(`/${cs.id}/${DECISIONS[what].path}`, { method: 'POST', body });
      // Drawn as decided now; the queue is read again behind it, and drops or moves the card when it has.
      setDecision({ ...UNDECIDED, done: what });
      onDone();
    } catch (e) {
      const clashes = e instanceof CallError && e.conflicts?.length ? new Set(e.conflicts.map((c) => String((c as { path?: string }).path ?? '').split('/')[0])).size : null;
      setDecision((d) => ({ ...d, doing: null, refused: clashes ?? d.refused, error: clashes ? null : e instanceof Error ? e.message : String(e) }));
    } finally {
      sending.current = false;
    }
  };
  // The pressed button's words while it waits ("Merging…") and a turning mark, or its own.
  const says = (what: Doing, words: ReactNode) => (doing === what ? W[DECISIONS[what].working][lang] : words);
  const icon = (what: Doing, name: IconName) => (doing === what ? <Icon name="loader" className="spin" /> : <Icon name={name} />);

  const failed = (cs.checks ?? []).filter((c) => c.status !== 'pass');
  const lastSendBack = detail ? [...detail.reviews].reverse().find((r) => r.verdict === 'send_back') : undefined;
  const labels = detail ? detailLabels(detail as unknown as Pick<SuggestionDetail, 'entries'>) : [];
  const page = cs.number ? href(`/suggestions/${cs.number}`, lang) : null;
  const mayApprove = detail?.mayApprove ?? false;
  const deciding = (cs.status === 'open' || live) && mayApprove;
  const grouped = detail?.summary && total > 1 && detail.summary.some((g) => g.count > 1) ? detail.summary : null;
  const left = detail ? total - detail.entries.length : 0;
  // All of a large Suggestion is approved at once: the button says how many.
  const allOf = detail && total > detail.entries.length ? <span className="num"> · {num(total, lang)}</span> : null;
  // Clashing items are decided before Approve, all at once, not found by it one merge later.
  const clashes = refused ?? detail?.clashes ?? 0;
  return (
    <article ref={cardRef} className={`rq-card${open ? ' focused' : ''}${live ? ' live' : ''}`} id={`s${cs.id}`}>
      <header className="rq-h">
        <StateIcon kind="suggestion" state={cs.status === 'merged' && !live ? 'approved' : state === 'closed' ? 'closed' : 'open'} />
        <div className="rq-title">
          <h2>
            {page ? <Link to={page}>{cs.title}</Link> : cs.title}
            {cs.number ? <span className="num"> #{cs.number}</span> : null}
          </h2>
          <p className="rq-meta">
            {bot ? <Icon name="bot" size={16} /> : <Avatar name={author} id={cs.author} size="xs" />}
            <b>{author}</b>
            {bot ? <span className="subtle">({W.bot[lang]})</span> : null} {W.suggested[lang]} <RelativeTime at={cs.submitted_at ?? cs.created_at} lang={lang} />
            {total ? <span className="rq-count num">· {total === 1 ? W.item[lang] : `${num(total, lang)} ${W.items[lang]}`}</span> : null}
            {/* A bot's work is a machine's until a person approves it. */}
            {bot && cs.status !== 'merged' ? <MachineLabel lang={lang} size="sm" /> : null}
            {labels.map((l) => (LABELS[l] ? <Label key={l} tone={LABELS[l]!.tone} size="sm">{LABELS[l]![lang]}</Label> : null))}
          </p>
        </div>
        <div className="rq-state">
          {live ? (
            <span className="machine-label rq-live">
              <Icon name="pulse" size={12} />
              {W.wentLive[lang]}
            </span>
          ) : cs.status !== 'open' ? (
            <StatusBadge state={stateOf(cs.status) === 'approved' ? 'approved' : stateOf(cs.status) === 'draft' ? 'draft' : 'closed'} size="sm">
              {stateWord(cs.status, lang)}
            </StatusBadge>
          ) : null}
        </div>
      </header>

      <div className="rq-b">
        {cs.description ? (
          <div className="rq-desc">
            <Clamp text={cs.description} lang={lang} render={(text) => <PlainWords text={text} lang={lang} />} />
          </div>
        ) : null}
        {detail === null && !loadError ? <Skeleton rows={2} lang={lang} /> : null}
        {loadError && detail === null ? (
          <p className="alert negative" role="alert">
            <Icon name="warn" />
            <span>{loadError}</span>
            {onRetry ? (
              <button type="button" className="btn sm" onClick={onRetry}>
                {W.loadError[lang]}
              </button>
            ) : null}
          </p>
        ) : null}
        {grouped ? <ChangeSummary groups={grouped} total={total} lang={lang} /> : null}
        {detail?.entries.map((entry, _, all) => {
          const anyReal = all.some((e) => e.before === null || e.after === null || e.withheld || !onlyInfo(e.changes.flatMap(leafChanges)));
          const item = { id: entry.entityId, type: entry.type, data: (entry.after ?? entry.before ?? {}) as Record<string, unknown> };
          const name = labelOf(item as Parameters<typeof labelOf>[0], lang);
          // Only its details changed (a paragraph re-timed because its words were fixed): nothing to show.
          if (anyReal && entry.before !== null && entry.after !== null && !entry.withheld && onlyInfo(entry.changes.flatMap(leafChanges))) return null;
          if (entry.before === null && !entry.withheld) return <NewItem key={entry.entityId} data={item.data} files={detail.files} type={entry.type} lang={lang} />;
          return (
            <div key={entry.entityId}>
              {entry.withheld ? (
                <section className="diff">
                  <header className="diff-h">
                    <Icon name="lock" />
                    <b>{name}</b>
                  </header>
                  <p className="rq-withheld">{t(lang, 'withheldChange')}</p>
                </section>
              ) : (
                <ChangeDiff
                  title={<Link to={href(`/${entry.entityId}`, lang)}>{name}</Link>}
                  where={entry.after === null ? t(lang, 'itemDeleted') : typeName(entry.type, lang)}
                  // An item taken out (merged into another) is said by its header alone: its old fields are nothing to read.
                  changes={entry.after === null ? [] : entry.changes.flatMap(leafChanges)}
                  items={detail.items}
                  lang={lang}
                  icon={entry.type === 'recording' ? 'audio' : entry.type === 'event' ? 'cal' : 'file'}
                />
              )}
              {entry.conflicts.length ? (
                <p className="alert negative rq-conflict">
                  <Icon name="warn" />
                  <span>{t(lang, 'changedSince')}</span>
                </p>
              ) : null}
            </div>
          );
        })}
        {detail && left > 0 ? (
          <div className="rq-more-items">
            <span className="subtle num">
              {W.shown[lang]} {num(detail.entries.length, lang)} {W.of[lang]} {num(total, lang)}
            </span>
            {onMore ? (
              <button type="button" className="btn sm" onClick={onMore} disabled={loadingMore} aria-busy={loadingMore || undefined}>
                <Icon name="down" />
                {W.showMore[lang]} <span className="subtle num">({num(left, lang)} {W.left[lang]})</span>
              </button>
            ) : null}
          </div>
        ) : null}
        {detail?.advice && (cs.status === 'open' || live) ? <Advice advice={detail.advice} lang={lang} /> : null}
        {failed.length ? (
          <ul className="rq-checks" aria-label={W.checks[lang]}>
            {failed.map((c) => (
              <li key={c.check} className={c.status}>
                <Icon name={c.status === 'fail' ? 'x' : 'warn'} size={14} />
                {c.message}
              </li>
            ))}
          </ul>
        ) : null}
        {detail && lastSendBack?.body && cs.status === 'sent_back' ? (
          <div className="rq-sentback">
            <Avatar name={detail.names[lastSendBack.reviewer] ?? lastSendBack.reviewer} id={lastSendBack.reviewer} size="xs" />
            <div>
              <p className="subtle">
                {W.sentBackBy[lang]} <b>{detail.names[lastSendBack.reviewer] ?? lastSendBack.reviewer}</b> · <RelativeTime at={lastSendBack.created_at} lang={lang} />
              </p>
              <PlainWords text={lastSendBack.body} lang={lang} />
            </div>
          </div>
        ) : null}
        {clashes > 0 && cs.status === 'open' && mayApprove ? (
          <div className="alert info rq-clashes" role="status">
            <Icon name="warn" />
            <span>
              <b>
                {W.clashTitle[lang]}: <span className="num">{num(clashes, lang)}</span>
              </b>
              {detail?.unchanged ? (
                <span className="subtle">
                  {' '}
                  · <span className="num">{num(detail.unchanged, lang)}</span> {W.unchanged[lang]}
                </span>
              ) : null}
              <br />
              {W.clashWhy[lang]}
            </span>
          </div>
        ) : null}
        {error ? (
          <p className="alert negative" role="alert">
            <Icon name="warn" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>

      <footer className="rq-f">
        {done ? (
          <StatusBadge state={done === 'approve' || done === 'approve-theirs' || done === 'keep-live' ? 'approved' : 'closed'} size="sm" icon={done === 'send-back' || done === 'withdraw' ? 'x' : done === 'undo-live' ? 'history' : 'check'}>
            <span role="status">{W[DECISIONS[done].done][lang]}</span>
          </StatusBadge>
        ) : null}
        {cs.status === 'open' && mayApprove ? (
          note === null ? (
            <>
              {clashes > 0 ? (
                <>
                  <button type="button" className="btn approve" onClick={act('approve', { resolutions: KEEP_SITE })} disabled={busy} aria-busy={doing === 'approve' || undefined}>
                    {icon('approve', 'check')}
                    {says('approve', <>{W.keepSite[lang]}{allOf}</>)}
                  </button>
                  <button type="button" className="btn" onClick={act('approve-theirs', { resolutions: TAKE_SUGGESTED })} disabled={busy} aria-busy={doing === 'approve-theirs' || undefined}>
                    {doing === 'approve-theirs' ? icon('approve-theirs', 'check') : null}
                    {says('approve-theirs', W.takeSuggested[lang])}
                  </button>
                </>
              ) : (
                <button type="button" className="btn approve" onClick={act('approve')} disabled={busy} aria-busy={doing === 'approve' || undefined}>
                  {icon('approve', 'check')}
                  {says('approve', <>{t(lang, 'approve')}{allOf}</>)}
                </button>
              )}
              <button type="button" className="btn danger" onClick={() => setNote('')} disabled={busy}>
                <Icon name="x" />
                {t(lang, 'sendBack')}
              </button>
            </>
          ) : (
            <div className="rq-sendback">
              <label className="visually-hidden" htmlFor={`note-${cs.id}`}>
                {t(lang, 'sendBackWhy')}
              </label>
              <textarea id={`note-${cs.id}`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder={t(lang, 'sendBackWhy')} autoFocus dir="auto" />
              <span className="btn-row">
                <button type="button" className="btn danger" onClick={act('send-back', { note })} disabled={busy || !note.trim()} aria-busy={doing === 'send-back' || undefined}>
                  {icon('send-back', 'x')}
                  {says('send-back', t(lang, 'sendBack'))}
                </button>
                <button type="button" className="btn ghost" onClick={() => setNote(null)} disabled={busy}>
                  {t(lang, 'cancel')}
                </button>
              </span>
            </div>
          )
        ) : null}
        {live && mayApprove ? (
          <>
            <button type="button" className="btn approve" onClick={act('keep-live', { verdict: 'approve' })} disabled={busy} aria-busy={doing === 'keep-live' || undefined}>
              {icon('keep-live', 'check')}
              {says('keep-live', t(lang, 'keepLive'))}
            </button>
            <button type="button" className="btn danger" onClick={act('undo-live', { verdict: 'revert' })} disabled={busy} aria-busy={doing === 'undo-live' || undefined}>
              {icon('undo-live', 'history')}
              {says('undo-live', t(lang, 'undoLive'))}
            </button>
          </>
        ) : null}
        {detail?.mine && (cs.status === 'open' || cs.status === 'sent_back') ? (
          <button type="button" className="btn" onClick={act('withdraw')} disabled={busy} aria-busy={doing === 'withdraw' || undefined}>
            {icon('withdraw', 'x')}
            {says('withdraw', t(lang, 'withdraw'))}
          </button>
        ) : null}
        {detail && !deciding && cs.status === 'open' && !detail.mine ? (
          <span className="subtle rq-who">
            <Icon name="lock" size={14} /> {W.cantApprove[lang]}
          </span>
        ) : null}
        {page ? (
          <Link className="rq-more" to={page}>
            <Icon name="discuss" />
            {W.discussion[lang]}
          </Link>
        ) : null}
      </footer>
    </article>
  );
}
