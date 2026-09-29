import { Bot, CircleCheck, Clock, FileDiff, MessageSquare, MessageSquarePlus, Pencil, RotateCw, Settings, X } from 'lucide-react';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { data, Link, useNavigate } from 'react-router';
import type { Route } from './+types/suggestion';
import { fieldName, valueText } from '../components/ChangeTable.js';
import { PersonLink, SuggestionState, TimeAgo } from '../components/threads/Bits.js';
import { Composer } from '../components/threads/Composer.js';
import { Picker } from '../components/threads/Picker.js';
import { RichText } from '../components/threads/RichText.js';
import { loadPeople, SubscribeBox, useReadOnOpen } from '../components/threads/Side.js';
import { Timeline } from '../components/threads/Timeline.js';
import { langFrom, typeName, type Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { threads, ThreadsError, type People, type TimelineItem } from '../lib/threads.js';
import { tt } from '../lib/threadStrings.js';
import { useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';

/**
 * One suggestion, as GitHub shows a pull request: its conversation (the
 * description, comments, reviews and everything that happened, in order)
 * and its changes, field by field, where a comment can be written on any
 * one field. A review is one act: Comment, Approve (which merges it into
 * the catalog) or Request changes (which sends it back), with the field
 * comments gathered on the way. Beside it: who is asked to review it (the
 * set's keepers are asked on their own, as CODEOWNERS are), the issues it
 * closes ("Fixes #12" in its description), and following it.
 */
export function loader({ request, params }: Route.LoaderArgs) {
  if (!/^\d{1,9}$/.test(params.number)) throw data('not found', { status: 404 });
  return { lang: langFrom(request), siteUrl: new URL(request.url).origin, number: Number(params.number) };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: `#${loaderData.number}`, path: `/suggestions/${loaderData.number}`, lang: loaderData.lang, siteUrl: loaderData.siteUrl, noindex: true });
}

interface Change {
  path: string;
  before?: unknown;
  after?: unknown;
}

interface Detail {
  changeset: { id: number; number: number; title: string; description: string | null; author: string; status: 'draft' | 'open' | 'merged' | 'sent_back' | 'withdrawn'; kind: string; created_at: string; submitted_at: string | null };
  entries: Array<{ entityId: string; type: string; before: unknown; after: unknown; changes: Change[]; conflicts: unknown[]; withheld?: string }>;
  names: Record<string, string>;
  mayApprove: boolean;
  mine: boolean;
  advice: { summary: string; model: string; at: string; machine: true } | null;
}

interface Conversation {
  number: number;
  timeline: TimelineItem[];
  people: People;
  reviewRequests: Array<{ reviewer: string; requestedBy: string | null; at: string }>;
  fixes: Array<{ number: number; title: string | null; state: 'open' | 'closed'; private: boolean }>;
  subscribed: boolean;
}

interface Pending {
  entity: string;
  field: string;
  body: string;
}

export default function SuggestionPage({ loaderData }: Route.ComponentProps) {
  const { number } = loaderData;
  const lang = useLang();
  const account = useAccount();
  const navigate = useNavigate();
  const [id, setId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [talk, setTalk] = useState<Conversation | null>(null);
  const [missing, setMissing] = useState(false);
  const [tab, setTab] = useState<'conversation' | 'changes'>('conversation');
  const [reviewing, setReviewing] = useState(false);
  const [pending, setPending] = useState<Pending[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    threads<{ kind: string; id: number }>(`threads/${number}`).then(
      (thread) => {
        if (!live) return;
        if (thread.kind === 'issue') navigate(href(`/issues/${number}`, lang), { replace: true });
        else setId(thread.id);
      },
      () => live && setMissing(true),
    );
    return () => {
      live = false;
    };
  }, [number, lang, navigate]);

  const load = useCallback(async () => {
    if (id === null) return;
    try {
      const [d, c] = await Promise.all([threads<Detail>(`suggestions/${id}`), threads<Conversation>(`suggestions/${id}/conversation`)]);
      setDetail(d);
      setTalk(c);
    } catch (e) {
      if (e instanceof ThreadsError && e.status === 404) setMissing(true);
      else setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);
  useEffect(() => {
    if (account !== undefined) void load();
  }, [load, account]);
  useReadOnOpen('changeset', id, Boolean(account));

  if (missing) return <p className="note">{lang === 'he' ? `לא נמצא #${number}.` : `#${number} not found.`}</p>;
  if (!detail || !talk || id === null) return error ? <p className="th-error">{error}</p> : <p className="note">…</p>;

  const cs = detail.changeset;
  const people = talk.people;
  const viewer = account?.person.id ?? null;
  const live = cs.status === 'open' || cs.status === 'sent_back';
  const fieldLabel = (a: { entity: string; field: string }) => `${detail.names[a.entity] ?? a.entity} › ${fieldName(a.field, lang)}`;
  const changeCount = detail.entries.reduce((n, e) => n + Math.max(e.changes.length, 1), 0);

  async function act<T>(run: () => Promise<T>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await run();
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const comment = () => act(() => threads(`suggestions/${id}/comments`, { body: { body: draft.trim() } })).then((ok) => ok && setDraft(''));
  const withdraw = () =>
    act(async () => {
      const response = await fetch(`/_/suggestions/${id}/withdraw`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', accept: 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { message?: string }).message ?? response.statusText);
    });

  // Who reviewed last, and how: the side column's reviewers, as on GitHub.
  const lastVerdict = new Map<string, 'approve' | 'send_back' | 'comment'>();
  for (const item of talk.timeline) if (item.type === 'review') lastVerdict.set(item.author, item.verdict);
  const reviewers = [...new Set([...talk.reviewRequests.map((r) => r.reviewer), ...lastVerdict.keys()])].filter((r) => r !== cs.author);
  const asked = new Set(talk.reviewRequests.map((r) => r.reviewer));
  const handle = (who: string) => people[who]?.username ?? who;

  return (
    <div className="th-page">
      <Header cs={cs} people={people} lang={lang} changes={detail.entries.length} mayEdit={Boolean(viewer && (viewer === cs.author || account?.person.steward))} onSave={(title) => act(() => threads(`suggestions/${id}`, { method: 'PATCH', body: { title } }))} />
      <div className="th-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'conversation'} onClick={() => setTab('conversation')}>
          <MessageSquare size={14} aria-hidden="true" /> {tt(lang, 'tabConversation')}
          <span className="th-count">{talk.timeline.filter((i) => i.type === 'comment').length}</span>
        </button>
        <button type="button" role="tab" aria-selected={tab === 'changes'} onClick={() => setTab('changes')}>
          <FileDiff size={14} aria-hidden="true" /> {tt(lang, 'tabChanges')}
          <span className="th-count">{changeCount}</span>
        </button>
        <span style={{ flex: 1 }} />
        {account && live ? (
          <button type="button" onClick={() => setReviewing(!reviewing)} aria-expanded={reviewing} className={reviewing ? '' : 'secondary'} style={{ marginBlockEnd: '0.25rem' }}>
            {tt(lang, 'reviewChanges')}
            {pending.length ? <span className="th-count">{pending.length}</span> : null}
          </button>
        ) : null}
      </div>
      {reviewing && account ? (
        <ReviewBox
          lang={lang}
          id={id}
          thread={`changeset:${id}`}
          pending={pending}
          mayDecide={detail.mayApprove && !detail.mine}
          onDropPending={(i) => setPending(pending.filter((_, j) => j !== i))}
          onDone={async () => {
            setPending([]);
            setReviewing(false);
            await load();
          }}
          fieldLabel={fieldLabel}
        />
      ) : null}
      <div className="th-layout">
        <div style={{ display: 'grid', gap: '1rem', alignContent: 'start' }}>
          {tab === 'conversation' ? (
            <>
              <Description cs={cs} people={people} lang={lang} mayEdit={Boolean(viewer && (viewer === cs.author || account?.person.steward))} onSave={(description) => act(() => threads(`suggestions/${id}`, { method: 'PATCH', body: { description } }))} />
              <Timeline
                items={talk.timeline.filter((i) => !(i.type === 'event' && i.kind === 'opened'))}
                people={people}
                lang={lang}
                viewer={viewer}
                thread={`changeset:${id}`}
                fieldLabel={fieldLabel}
                mayResolve={Boolean(viewer && (viewer === cs.author || detail.mayApprove))}
                mayReply={Boolean(account)}
                reply={(body, parent) => threads(`suggestions/${id}/comments`, { body: { body, parent } })}
                changed={() => void load()}
              />
              {account ? (
                <Composer lang={lang} value={draft} onChange={setDraft} onSubmit={() => void comment()} submitLabel={tt(lang, 'comment')} busy={busy} thread={`changeset:${id}`} error={error}>
                  {detail.mine && live ? (
                    <button type="button" className="secondary" disabled={busy} onClick={() => void withdraw()}>
                      {tt(lang, 'withdraw')}
                    </button>
                  ) : null}
                </Composer>
              ) : (
                <p className="note">
                  <Link to={href('/signin', lang, { return: `/suggestions/${number}` })}>{tt(lang, 'signInToJoin')}</Link>
                </p>
              )}
            </>
          ) : (
            <Changes
              detail={detail}
              timeline={talk.timeline}
              people={people}
              lang={lang}
              viewer={viewer}
              signedIn={Boolean(account)}
              id={id}
              onPending={(p) => {
                setPending([...pending, p]);
                setReviewing(true);
              }}
              changed={() => void load()}
            />
          )}
        </div>
        <aside className="th-side">
          <section>
            <h2>
              {tt(lang, 'reviewers')}
              {account && live ? (
                <Picker
                  lang={lang}
                  title={tt(lang, 'requestReview')}
                  button={<Settings size={14} aria-label={tt(lang, 'requestReview')} />}
                  selected={[...asked].map(handle)}
                  load={(q) => loadPeople(q, `changeset:${id}`)}
                  onApply={(values) =>
                    void act(async () => {
                      const now = [...asked].map(handle);
                      const add = values.filter((v) => !now.includes(v));
                      const drop = now.filter((v) => !values.includes(v));
                      if (add.length) await threads(`suggestions/${id}/review-requests`, { body: { reviewers: add } });
                      for (const name of drop) await threads(`suggestions/${id}/review-requests/${encodeURIComponent(name)}`, { method: 'DELETE' });
                    })
                  }
                />
              ) : null}
            </h2>
            {reviewers.length ? (
              <ul>
                {reviewers.map((who) => {
                  const verdict = lastVerdict.get(who);
                  const waiting = asked.has(who);
                  return (
                    <li key={who} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <PersonLink id={who} people={people} lang={lang} />
                      <span style={{ flex: 1 }} />
                      {waiting ? (
                        <Clock size={14} className="th-icon attention" aria-label={tt(lang, 'awaiting')} />
                      ) : verdict === 'approve' ? (
                        <CircleCheck size={14} className="th-icon open" aria-label={tt(lang, 'approved')} />
                      ) : verdict === 'send_back' ? (
                        <FileDiff size={14} className="th-icon attention" aria-label={tt(lang, 'sentBack')} />
                      ) : (
                        <MessageSquare size={14} className="th-icon closed" aria-label={tt(lang, 'reviewedComment')} />
                      )}
                      {!waiting && live && account && who !== viewer ? (
                        <button type="button" className="th-gear" title={tt(lang, 'reRequest')} onClick={() => void act(() => threads(`suggestions/${id}/review-requests`, { body: { reviewers: [handle(who)] } }))}>
                          <RotateCw size={12} aria-label={tt(lang, 'reRequest')} />
                        </button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="th-hint">{tt(lang, 'noReviewers')}</p>
            )}
          </section>
          <section>
            <h2>{tt(lang, 'fixes')}</h2>
            {talk.fixes.length ? (
              <ul>
                {talk.fixes.map((f) => (
                  <li key={f.number}>
                    <Link className="th-ref" to={href(`/issues/${f.number}`, lang)}>
                      #{f.number}
                    </Link>{' '}
                    {f.title ?? ''} {f.state === 'closed' ? <CircleCheck size={12} className="th-icon done" aria-hidden="true" /> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="th-hint">{tt(lang, 'fixesHint')}</p>
            )}
          </section>
          {detail.advice ? (
            <section>
              <h2>
                <span>
                  <Bot size={14} aria-hidden="true" /> {lang === 'he' ? 'סיכום מכונה' : 'Machine summary'}
                </span>
              </h2>
              <p className="th-hint" style={{ margin: 0 }}>
                {detail.advice.summary}
              </p>
              <p className="th-hint">
                {detail.advice.model} · {lang === 'he' ? 'לא נבדק על ידי אדם; אינו מחליט דבר' : 'not checked by a person; decides nothing'}
              </p>
            </section>
          ) : null}
          <SubscribeBox lang={lang} kind="changeset" id={id} subscribed={talk.subscribed} signedIn={Boolean(account)} />
        </aside>
      </div>
    </div>
  );
}

function Header({ cs, people, lang, changes, mayEdit, onSave }: { cs: Detail['changeset']; people: People; lang: Lang; changes: number; mayEdit: boolean; onSave: (title: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(cs.title);
  return (
    <header style={{ display: 'grid', gap: '0.5rem' }}>
      <div className="th-head">
        {editing ? (
          <form
            className="th-filters"
            style={{ flex: 1 }}
            onSubmit={(e) => {
              e.preventDefault();
              void onSave(value.trim()).then((ok) => ok && setEditing(false));
            }}
          >
            <input type="search" value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} aria-label={tt(lang, 'title')} autoFocus dir="auto" />
            <button type="submit">{tt(lang, 'save')}</button>
            <button type="button" className="secondary" onClick={() => setEditing(false)}>
              {tt(lang, 'cancel')}
            </button>
          </form>
        ) : (
          <>
            <h1 dir="auto">
              {cs.title} <span className="th-number">#{cs.number}</span>
            </h1>
            {mayEdit ? (
              <button type="button" className="secondary" onClick={() => (setValue(cs.title), setEditing(true))}>
                {tt(lang, 'edit')}
              </button>
            ) : null}
          </>
        )}
      </div>
      <div className="th-meta">
        <SuggestionState status={cs.status} lang={lang} />
        <span>
          <PersonLink id={cs.author} people={people} lang={lang} /> · {changes} {lang === 'he' ? 'פריטים' : changes === 1 ? 'item' : 'items'} · <TimeAgo at={cs.submitted_at ?? cs.created_at} lang={lang} />
        </span>
      </div>
    </header>
  );
}

function Description({ cs, people, lang, mayEdit, onSave }: { cs: Detail['changeset']; people: People; lang: Lang; mayEdit: boolean; onSave: (text: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(cs.description ?? '');
  return (
    <article className="th-card">
      <header className="th-card-head">
        <PersonLink id={cs.author} people={people} lang={lang} /> {tt(lang, 'openedSuggestion')} <TimeAgo at={cs.created_at} lang={lang} />
        <span className="th-spacer" />
        {mayEdit && !editing ? (
          <button type="button" className="link-button" onClick={() => (setValue(cs.description ?? ''), setEditing(true))}>
            <Pencil size={12} aria-hidden="true" /> {tt(lang, 'edit')}
          </button>
        ) : null}
      </header>
      <div className="th-card-body">
        {editing ? (
          <Composer lang={lang} value={value} onChange={setValue} onSubmit={() => void onSave(value.trim()).then((ok) => ok && setEditing(false))} submitLabel={tt(lang, 'save')} thread={`changeset:${cs.id}`} autoFocus>
            <button type="button" className="secondary" onClick={() => setEditing(false)}>
              {tt(lang, 'cancel')}
            </button>
          </Composer>
        ) : cs.description ? (
          <RichText text={cs.description} lang={lang} />
        ) : (
          <p className="th-empty">{tt(lang, 'noDescription')}</p>
        )}
      </div>
    </article>
  );
}

/** The change, item by item and field by field; a comment can be written on any field, now or as part of a review. */
function Changes({
  detail,
  timeline,
  people,
  lang,
  viewer,
  signedIn,
  id,
  onPending,
  changed,
}: {
  detail: Detail;
  timeline: TimelineItem[];
  people: People;
  lang: Lang;
  viewer: string | null;
  signedIn: boolean;
  id: number;
  onPending: (p: Pending) => void;
  changed: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const comments = timeline.filter((i): i is Extract<TimelineItem, { type: 'comment' }> => i.type === 'comment' && i.anchor !== null && i.parent === null);

  async function now(entity: string, field: string) {
    setError(null);
    try {
      await threads(`suggestions/${id}/comments`, { body: { body: draft.trim(), anchor: { entity, field } } });
      setDraft('');
      setOpen(null);
      changed();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {detail.entries.map((entry) => {
        const rows: Change[] = entry.changes.length ? entry.changes : [{ path: '', before: entry.before === null ? undefined : '…', after: entry.after === null ? undefined : '…' }];
        return (
          <section key={entry.entityId} className="th-change">
            <div className="th-change-head">
              <Link to={href(`/${entry.entityId}`, lang)}>{detail.names[entry.entityId] ?? entry.entityId}</Link> <span className="th-dim">· {typeName(entry.type, lang)}</span>
              {entry.before === null ? <span className="th-dim"> · {tt(lang, 'newItemLine')}</span> : null}
            </div>
            {entry.withheld ? (
              <p className="note" style={{ padding: '0.5rem 0.75rem' }}>
                {entry.withheld}
              </p>
            ) : (
              <table className="th-fields">
                <tbody>
                  {rows.map((change) => {
                    const key = `${entry.entityId}|${change.path}`;
                    const here = comments.filter((c) => c.anchor!.entity === entry.entityId && c.anchor!.field === change.path);
                    return (
                      <Fragment key={key}>
                        <tr>
                          <th scope="row">{change.path ? fieldName(change.path, lang) : typeName(entry.type, lang)}</th>
                          <td className="was" dir="auto">
                            {valueText(change.path, change.before, lang)}
                          </td>
                          <td className="now" dir="auto">
                            {valueText(change.path, change.after, lang)}
                          </td>
                          <td style={{ inlineSize: '2rem' }}>
                            {signedIn ? (
                              <button type="button" className="th-gear th-add-comment" title={tt(lang, 'commentField')} aria-label={tt(lang, 'commentField')} onClick={() => (setOpen(open === key ? null : key), setDraft(''), setError(null))}>
                                <MessageSquarePlus size={14} aria-hidden="true" />
                              </button>
                            ) : null}
                          </td>
                        </tr>
                        {here.length || open === key ? (
                          <tr className="th-field-thread">
                            <td colSpan={4}>
                              <div style={{ display: 'grid', gap: '0.5rem' }}>
                                {here.length ? (
                                  <Timeline
                                    items={timeline.filter((i) => i.type === 'comment' && (here.some((h) => h.id === i.id) || here.some((h) => h.id === i.parent))).map((i) => (i.type === 'comment' ? { ...i, review: null } : i))}
                                    people={people}
                                    lang={lang}
                                    viewer={viewer}
                                    thread={`changeset:${id}`}
                                    mayResolve={Boolean(viewer && (viewer === detail.changeset.author || detail.mayApprove))}
                                    mayReply={signedIn}
                                    reply={(body, parent) => threads(`suggestions/${id}/comments`, { body: { body, parent } })}
                                    changed={changed}
                                  />
                                ) : null}
                                {open === key ? (
                                  <Composer lang={lang} value={draft} onChange={setDraft} onSubmit={() => void now(entry.entityId, change.path)} submitLabel={tt(lang, 'comment')} thread={`changeset:${id}`} autoFocus error={error}>
                                    <button type="button" className="secondary" onClick={() => setOpen(null)}>
                                      {tt(lang, 'cancel')}
                                    </button>
                                    <button
                                      type="button"
                                      className="secondary"
                                      disabled={!draft.trim()}
                                      onClick={() => {
                                        onPending({ entity: entry.entityId, field: change.path, body: draft.trim() });
                                        setDraft('');
                                        setOpen(null);
                                      }}
                                    >
                                      {tt(lang, 'addToReview')}
                                    </button>
                                  </Composer>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Finishing a review: the words, the verdict, and the field comments gathered on the way, sent as one. */
function ReviewBox({
  lang,
  id,
  thread,
  pending,
  mayDecide,
  onDropPending,
  onDone,
  fieldLabel,
}: {
  lang: Lang;
  id: number;
  thread: string;
  pending: Pending[];
  mayDecide: boolean;
  onDropPending: (index: number) => void;
  onDone: () => Promise<void>;
  fieldLabel: (a: { entity: string; field: string }) => string;
}) {
  const [body, setBody] = useState('');
  const [verdict, setVerdict] = useState<'comment' | 'approve' | 'request_changes'>('comment');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsWords = verdict === 'request_changes' || (verdict === 'comment' && pending.length === 0);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await threads(`suggestions/${id}/reviews`, { body: { verdict, body: body.trim(), comments: pending } });
      setBody('');
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const choice = (value: typeof verdict, label: 'verdictComment' | 'verdictApprove' | 'verdictRequestChanges', hint: 'verdictCommentHint' | 'verdictApproveHint' | 'verdictRequestChangesHint', disabled = false) => (
    <label aria-disabled={disabled}>
      <input type="radio" name="verdict" value={value} checked={verdict === value} disabled={disabled} onChange={() => setVerdict(value)} />
      <strong>{tt(lang, label)}</strong>
      <small>{tt(lang, hint)}</small>
    </label>
  );

  return (
    <section className="th-card th-review-box" aria-label={tt(lang, 'reviewChanges')}>
      <div className="th-card-body" style={{ display: 'grid', gap: '0.75rem' }}>
        <Composer lang={lang} value={body} onChange={setBody} thread={thread} placeholder={tt(lang, 'leaveComment')} autoFocus />
        {pending.length ? (
          <div>
            <p className="th-hint">{tt(lang, 'pendingComments')}</p>
            <ul style={{ margin: 0, paddingInlineStart: '1rem' }}>
              {pending.map((p, i) => (
                <li key={i}>
                  <span className="th-anchor">{fieldLabel(p)}</span> {p.body.length > 80 ? `${p.body.slice(0, 77)}…` : p.body}{' '}
                  <button type="button" className="th-gear" aria-label={tt(lang, 'cancel')} onClick={() => onDropPending(i)}>
                    <X size={12} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <fieldset className="th-verdicts">
          {choice('comment', 'verdictComment', 'verdictCommentHint')}
          {choice('approve', 'verdictApprove', 'verdictApproveHint', !mayDecide)}
          {choice('request_changes', 'verdictRequestChanges', 'verdictRequestChangesHint', !mayDecide)}
        </fieldset>
        {!mayDecide ? <p className="th-hint">{tt(lang, 'onlyKeepers')}</p> : null}
        {error ? <p className="th-error" role="alert">{error}</p> : null}
        <div className="th-buttons">
          <button type="button" onClick={() => void submit()} disabled={busy || (needsWords && !body.trim())}>
            {tt(lang, 'submitReview')}
          </button>
        </div>
      </div>
    </section>
  );
}
