import { useEffect, useRef, useState, type Ref, type RefObject } from 'react';
import { Link } from 'react-router';
import { ChangeDiff } from './ChangeDiff.js';
import { PlainWords } from './PlainWords.js';
import type { ChangeGroup, SuggestionDetail } from '../lib/api.js';
import { t, typeName, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { labelOf } from '../lib/labels.js';
import { st } from '../lib/scanStrings.js';
import { href } from '../lib/links.js';
import { LABELS, detailLabels, stateOf, stateWord } from '../lib/suggestions.js';
import { Icon } from '../ui/Icon.js';
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
  reviews: Array<{ reviewer: string; verdict: 'approve' | 'send_back'; body: string | null; created_at: string }>;
  names: Record<string, string>;
  files: Record<string, { url: string | null; mime: string; bytes: number; rights: string; similar?: Array<{ kind: 'same' | 'shares'; matched?: number; of?: number; items: Array<{ id: string; type: string; path: string | null }> }> }>;
  mayApprove: boolean;
  mine: boolean;
  /** The reviewer's advice, written by a machine (null until one has been written). */
  advice: { summary: string; model: string; at: string; machine: true } | null;
}

/** Items read at a time. */
export const REVIEW_PAGE = 25;

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
  new: { he: 'חדשים', en: 'new' },
  deleted: { he: 'נמחקים', en: 'deleted' },
  all: { he: 'הכול', en: 'all' },
  loadError: { he: 'לא נטען. לנסות שוב', en: "Didn't load. Try again" },
} as const;

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
  const json = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new Error(json.message ?? response.statusText);
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

/** Every item, grouped by how it changes: "500 × unit · /links: links to the proxy → links to Drive", with a few examples each. */
export function ChangeSummary({ groups, total, lang }: { groups: ChangeGroup[]; total: number; lang: Lang }) {
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
        {groups.map((g, i) => (
          <li key={i}>
            <span className="rq-summary-n num">{num(g.count, lang)}</span>
            <span className="rq-summary-what">
              <b>{typeName(g.type, lang)}</b>
              {g.kind !== 'changed' ? <span className="subtle"> · {W[g.kind][lang]}</span> : null}
              {g.fields.map((f) => (
                <span key={f.path} className="rq-summary-field">
                  <code dir="ltr">{f.path.replace(/^\//, '') || W.all[lang]}</code> <del>{valueWords(f.before, lang)}</del>
                  <Icon name="arrow" size={12} className="flip" />
                  <ins>{valueWords(f.after, lang)}</ins>
                </span>
              ))}
              <span className="rq-summary-ex subtle">
                {W.examples[lang]}:{' '}
                {g.examples.map((id, j) => (
                  <span key={id}>
                    {j > 0 ? ', ' : ''}
                    <Link to={href(`/${id}`, lang)} className="num" dir="ltr">
                      {id}
                    </Link>
                  </span>
                ))}
              </span>
            </span>
          </li>
        ))}
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
      setDetail((d) => (d ? { ...d, entries: [...d.entries, ...page.entries], files: { ...d.files, ...page.files }, next: page.next ?? null } : d));
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
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const cs = detail?.changeset ?? row;
  const author = person?.name ?? detail?.names[cs.author] ?? cs.author;
  const bot = person?.bot ?? cs.author.startsWith('bot:');
  const live = cs.post_review === 'pending';
  const state = live ? 'open' : stateOf(cs.status);
  const total = detail?.total ?? row.items ?? detail?.entries.length ?? 0;

  const act = (path: string, body: unknown = {}) => async () => {
    setBusy(true);
    setError(null);
    try {
      await call(`/${cs.id}/${path}`, { method: 'POST', body });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

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
            <span className="machine rq-live">
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
            <PlainWords text={cs.description} lang={lang} />
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
        {detail?.entries.map((entry) => {
          const item = { id: entry.entityId, type: entry.type, data: (entry.after ?? entry.before ?? {}) as Record<string, unknown> };
          const name = labelOf(item as Parameters<typeof labelOf>[0], lang);
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
                  where={typeName(entry.type, lang)}
                  changes={entry.changes.flatMap(leafChanges)}
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
        {error ? (
          <p className="alert negative" role="alert">
            <Icon name="warn" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>

      <footer className="rq-f">
        {cs.status === 'open' && mayApprove ? (
          note === null ? (
            <>
              <button type="button" className="btn approve" onClick={act('approve')} disabled={busy} aria-busy={busy || undefined}>
                <Icon name="check" />
                {t(lang, 'approve')}
                {allOf}
              </button>
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
                <button type="button" className="btn danger" onClick={act('send-back', { note })} disabled={busy || !note.trim()}>
                  <Icon name="x" />
                  {t(lang, 'sendBack')}
                </button>
                <button type="button" className="btn ghost" onClick={() => setNote(null)}>
                  {t(lang, 'cancel')}
                </button>
              </span>
            </div>
          )
        ) : null}
        {live && mayApprove ? (
          <>
            <button type="button" className="btn approve" onClick={act('review-live', { verdict: 'approve' })} disabled={busy}>
              <Icon name="check" />
              {t(lang, 'keepLive')}
            </button>
            <button type="button" className="btn danger" onClick={act('review-live', { verdict: 'revert' })} disabled={busy}>
              <Icon name="history" />
              {t(lang, 'undoLive')}
            </button>
          </>
        ) : null}
        {detail?.mine && (cs.status === 'open' || cs.status === 'sent_back') ? (
          <button type="button" className="btn" onClick={act('withdraw')} disabled={busy}>
            <Icon name="x" />
            {t(lang, 'withdraw')}
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
