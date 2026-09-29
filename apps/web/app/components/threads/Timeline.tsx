import {
  CircleCheck,
  CircleDot,
  CircleSlash,
  Eye,
  FileDiff,
  GitMerge,
  GitPullRequestClosed,
  Link2,
  Lock,
  LockOpen,
  MessageSquare,
  Pencil,
  Tag,
  Undo2,
  UserPlus,
  Users,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { Lang } from '../../lib/i18n.js';
import { href } from '../../lib/links.js';
import { threadPath, threads, type IssueLabel, type People, type TimelineItem } from '../../lib/threads.js';
import { tt } from '../../lib/threadStrings.js';
import { LabelChip, PersonLink, TimeAgo } from './Bits.js';
import { Composer } from './Composer.js';
import { RichText } from './RichText.js';

/**
 * A suggestion's or an issue's conversation, oldest first, as on GitHub:
 * comments and reviews as cards (a review with the comments written in
 * it, each comment with its replies), and everything else that happened
 * (sent for review, labels, people asked or assigned, mentioned
 * elsewhere, merged, closed) as a line between them.
 */

type Comment = Extract<TimelineItem, { type: 'comment' }>;
type Review = Extract<TimelineItem, { type: 'review' }>;
type Event = Extract<TimelineItem, { type: 'event' }>;

export interface TimelineProps {
  items: TimelineItem[];
  people: People;
  lang: Lang;
  /** Who is reading, to offer editing their own words. */
  viewer: string | null;
  /** `changeset:12` or `report:3`, so @ suggests this conversation's people first. */
  thread: string;
  /** How a field of a suggestion is named, for comments written on one. */
  fieldLabel?: (anchor: { entity: string; field: string }) => string;
  labels?: IssueLabel[];
  /** Whether the reader may resolve field comments (the author and reviewers). */
  mayResolve?: boolean;
  mayReply: boolean;
  reply: (body: string, parent: number) => Promise<unknown>;
  changed: () => void;
}

export function Timeline(props: TimelineProps) {
  const { items } = props;
  const comments = items.filter((i): i is Comment => i.type === 'comment');
  const repliesOf = (id: number) => comments.filter((c) => c.parent === id);
  const inReview = (id: number) => comments.filter((c) => c.review === id && c.parent === null);
  const top = items.filter((i) => (i.type === 'comment' ? i.parent === null && i.review === null : true));
  return (
    <ol className="th-timeline">
      {top.map((item) => (
        <li key={`${item.type}-${item.id}`} id={item.type === 'event' ? undefined : `${item.type === 'comment' ? 'c' : 'r'}-${item.id}`}>
          {item.type === 'comment' ? (
            <CommentCard {...props} comment={item} replies={repliesOf(item.id)} />
          ) : item.type === 'review' ? (
            <ReviewCard {...props} review={item} comments={inReview(item.id)} repliesOf={repliesOf} />
          ) : (
            <EventLine {...props} event={item} />
          )}
        </li>
      ))}
    </ol>
  );
}

function ReviewCard(props: TimelineProps & { review: Review; comments: Comment[]; repliesOf: (id: number) => Comment[] }) {
  const { review, people, lang, comments, repliesOf } = props;
  const verb = review.verdict === 'approve' ? 'approved' : review.verdict === 'send_back' ? 'sentBack' : 'reviewedComment';
  const Icon = review.verdict === 'approve' ? CircleCheck : review.verdict === 'send_back' ? FileDiff : Eye;
  if (!review.body && comments.length === 0) {
    return (
      <div className="th-event">
        <span className={`th-event-icon ${review.verdict === 'approve' ? 'open' : review.verdict === 'send_back' ? 'attention' : ''}`}>
          <Icon size={14} aria-hidden="true" />
        </span>
        <PersonLink id={review.author} people={people} lang={lang} /> {tt(lang, verb)} <TimeAgo at={review.at} lang={lang} anchor={`r-${review.id}`} />
      </div>
    );
  }
  return (
    <article className={`th-card ${review.verdict}`}>
      <header className="th-card-head">
        <Icon size={16} aria-hidden="true" />
        <PersonLink id={review.author} people={people} lang={lang} /> {tt(lang, verb)} <TimeAgo at={review.at} lang={lang} anchor={`r-${review.id}`} />
      </header>
      {review.body ? (
        <div className="th-card-body">
          <RichText text={review.body} lang={lang} />
        </div>
      ) : null}
      {comments.length ? (
        <div className="th-card-body" style={{ display: 'grid', gap: '0.5rem' }}>
          {comments.map((c) => (
            <div key={c.id} id={`c-${c.id}`}>
              <CommentCard {...props} comment={c} replies={repliesOf(c.id)} />
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function CommentCard(props: TimelineProps & { comment: Comment; replies: Comment[] }) {
  const { comment, replies, people, lang, viewer, fieldLabel, mayResolve, mayReply, reply, changed, thread } = props;
  const [open, setOpen] = useState(!comment.resolved);
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await reply(draft.trim(), comment.id);
      setDraft('');
      setReplying(false);
      changed();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function resolve(resolved: boolean) {
    await threads(`comments/${comment.id}/resolve`, { body: { resolved } });
    changed();
  }

  return (
    <article className={`th-card${comment.resolved ? ' resolved' : ''}`}>
      <CommentHead {...props} comment={comment}>
        {comment.anchor ? (
          <span className="th-anchor">
            <FileDiff size={12} aria-hidden="true" />
            {tt(lang, 'onField')} {fieldLabel ? fieldLabel(comment.anchor) : comment.anchor.field}
          </span>
        ) : null}
        {comment.resolved ? <span className="th-private">{tt(lang, 'resolved')}</span> : null}
        <span className="th-spacer" />
        {comment.anchor && (mayResolve || comment.author === viewer) && viewer ? (
          <button type="button" className="link-button" onClick={() => void resolve(!comment.resolved)}>
            {tt(lang, comment.resolved ? 'unresolve' : 'resolve')}
          </button>
        ) : null}
        {comment.resolved ? (
          <button type="button" className="link-button" onClick={() => setOpen(!open)} aria-expanded={open}>
            {tt(lang, 'showResolved')}
          </button>
        ) : null}
      </CommentHead>
      {open ? (
        <>
          <CommentBody {...props} comment={comment} />
          {replies.length ? (
            <ul className="th-replies">
              {replies.map((r) => (
                <li key={r.id} id={`c-${r.id}`}>
                  <div className="th-meta">
                    <PersonLink id={r.author} people={people} lang={lang} /> <TimeAgo at={r.at} lang={lang} anchor={`c-${r.id}`} />
                    {r.edited ? <span>· {tt(lang, 'edited')}</span> : null}
                  </div>
                  <CommentBody {...props} comment={r} bare />
                </li>
              ))}
            </ul>
          ) : null}
          {mayReply ? (
            <div className="th-card-body" style={{ borderBlockStart: '1px solid var(--border)' }}>
              {replying ? (
                <Composer lang={lang} value={draft} onChange={setDraft} onSubmit={() => void send()} submitLabel={tt(lang, 'reply')} busy={busy} thread={thread} autoFocus error={error}>
                  <button type="button" className="btn" onClick={() => setReplying(false)}>
                    {tt(lang, 'cancel')}
                  </button>
                </Composer>
              ) : (
                <button type="button" className="link-button" onClick={() => setReplying(true)}>
                  <MessageSquare size={14} aria-hidden="true" /> {tt(lang, 'reply')}
                </button>
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </article>
  );
}

function CommentHead({ comment, people, lang, children }: TimelineProps & { comment: Comment; children?: ReactNode }) {
  return (
    <header className="th-card-head">
      <PersonLink id={comment.author} people={people} lang={lang} /> {tt(lang, 'commented')} <TimeAgo at={comment.at} lang={lang} anchor={`c-${comment.id}`} />
      {comment.edited ? <span>· {tt(lang, 'edited')}</span> : null}
      {children}
    </header>
  );
}

/** A comment's words; its writer may change them in place. */
function CommentBody({ comment, lang, viewer, thread, changed, bare }: TimelineProps & { comment: Comment; bare?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await threads(`comments/${comment.id}`, { method: 'PATCH', body: { body: draft.trim() } });
      setEditing(false);
      changed();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  if (comment.hidden || comment.body === null) return <div className={bare ? '' : 'th-card-body'}><p className="th-empty">{tt(lang, 'hiddenComment')}</p></div>;
  if (editing) {
    return (
      <div className={bare ? '' : 'th-card-body'}>
        <Composer lang={lang} value={draft} onChange={setDraft} onSubmit={() => void save()} submitLabel={tt(lang, 'save')} busy={busy} thread={thread} autoFocus error={error}>
          <button type="button" className="btn" onClick={() => setEditing(false)}>
            {tt(lang, 'cancel')}
          </button>
        </Composer>
      </div>
    );
  }
  return (
    <div className={bare ? '' : 'th-card-body'}>
      <RichText text={comment.body} lang={lang} />
      {viewer && viewer === comment.author ? (
        <button type="button" className="link-button" onClick={() => (setDraft(comment.body ?? ''), setEditing(true))} style={{ fontSize: '0.8rem' }}>
          <Pencil size={12} aria-hidden="true" /> {tt(lang, 'edit')}
        </button>
      ) : null}
    </div>
  );
}

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

function EventLine({ event, people, lang, labels = [] }: TimelineProps & { event: Event }) {
  const d = event.detail;
  const by = d.by as { kind?: string; number?: number | null } | undefined;
  const who = (list: string[]) =>
    list.map((id, i) => (
      <span key={id}>
        {i ? ', ' : ''}
        <PersonLink id={id} people={people} lang={lang} />
      </span>
    ));
  const ref = (number: number | null | undefined, kind: 'changeset' | 'report') =>
    number ? (
      <Link className="th-ref" to={href(threadPath(kind, number), lang)}>
        #{number}
      </Link>
    ) : null;
  const chips = (names: string[]) => names.map((name) => <LabelChip key={name} label={labels.find((l) => l.name === name) ?? { name, color: '#6e7781', description: null }} />);

  let icon: ReactNode = <CircleDot size={14} aria-hidden="true" />;
  let tone = '';
  let text: ReactNode = null;
  let actor = true;
  switch (event.kind) {
    case 'opened':
      text = tt(lang, 'opened');
      tone = 'open';
      break;
    case 'submitted':
      icon = <Eye size={14} aria-hidden="true" />;
      text = tt(lang, d.live ? 'submittedLive' : 'submitted');
      break;
    case 'sent_back':
      icon = <FileDiff size={14} aria-hidden="true" />;
      tone = 'attention';
      text = tt(lang, 'sentBack');
      break;
    case 'merged':
      icon = <GitMerge size={14} aria-hidden="true" />;
      tone = 'merged';
      text = tt(lang, 'merged');
      break;
    case 'withdrawn':
      icon = <GitPullRequestClosed size={14} aria-hidden="true" />;
      tone = 'closed';
      text = tt(lang, 'withdrawn');
      break;
    case 'reverted':
      icon = <Undo2 size={14} aria-hidden="true" />;
      text = (
        <>
          {tt(lang, 'reverted')} {ref(by?.number, 'changeset')}
        </>
      );
      break;
    case 'closed': {
      const done = d.outcome !== 'dismissed';
      icon = done ? <CircleCheck size={14} aria-hidden="true" /> : <CircleSlash size={14} aria-hidden="true" />;
      tone = done ? 'merged' : 'closed';
      text = (
        <>
          {tt(lang, done ? 'closedDone' : 'closedNotPlanned')}
          {by?.number ? (
            <>
              {' '}
              {tt(lang, 'closedBy')} {ref(by.number, 'changeset')}
            </>
          ) : null}
          {typeof d.note === 'string' && d.note ? <>: “{d.note}”</> : null}
        </>
      );
      break;
    }
    case 'reopened':
      tone = 'open';
      text = tt(lang, 'reopened');
      break;
    case 'renamed':
      icon = <Pencil size={14} aria-hidden="true" />;
      text = (
        <>
          {tt(lang, 'renamed')} <s>{String(d.from ?? '')}</s> <strong>{String(d.to ?? '')}</strong>
        </>
      );
      break;
    case 'edited':
      icon = <Pencil size={14} aria-hidden="true" />;
      text = tt(lang, 'edited');
      break;
    case 'labeled':
    case 'unlabeled':
      icon = <Tag size={14} aria-hidden="true" />;
      text = (
        <>
          {tt(lang, event.kind === 'labeled' ? 'labeled' : 'unlabeled')} {chips(ids(d.labels))}
        </>
      );
      break;
    case 'assigned':
    case 'unassigned': {
      icon = <UserPlus size={14} aria-hidden="true" />;
      const list = ids(d.assignees);
      text = event.kind === 'assigned' && list.length === 1 && list[0] === event.actor ? tt(lang, 'selfAssigned') : (
        <>
          {tt(lang, event.kind === 'assigned' ? 'assigned' : 'unassigned')} {who(list)}
        </>
      );
      break;
    }
    case 'review_requested':
      icon = <Users size={14} aria-hidden="true" />;
      if (d.auto || event.actor === 'system') {
        actor = false;
        text = (
          <>
            {tt(lang, 'reviewRequestedAuto')} {who(ids(d.reviewers))}
          </>
        );
      } else
        text = (
          <>
            {tt(lang, 'reviewRequested')}
            {who(ids(d.reviewers))}
          </>
        );
      break;
    case 'review_request_removed':
      icon = <Users size={14} aria-hidden="true" />;
      text = (
        <>
          {tt(lang, 'reviewRequestRemoved')}
          {who(ids(d.reviewers))}
        </>
      );
      break;
    case 'referenced': {
      icon = <Link2 size={14} aria-hidden="true" />;
      const from = d.from as { kind?: string; id?: string; number?: number | null } | undefined;
      const place =
        from?.kind === 'changeset' || from?.kind === 'report' ? (
          ref(from.number, from.kind)
        ) : from?.kind === 'entity' && from.id ? (
          <Link className="th-ref" to={href(`/talk/${from.id}`, lang)}>
            {tt(lang, 'talkOf')} {from.id}
          </Link>
        ) : null;
      text = (
        <>
          {tt(lang, d.closes ? 'referencedCloses' : 'referenced')}
          {d.closes ? ' ' : ''}
          {place}
        </>
      );
      break;
    }
    case 'made_private':
      icon = <Lock size={14} aria-hidden="true" />;
      text = tt(lang, 'madePrivate');
      break;
    case 'made_public':
      icon = <LockOpen size={14} aria-hidden="true" />;
      text = tt(lang, 'madePublic');
      break;
    default:
      text = event.kind;
  }
  return (
    <div className="th-event">
      <span className={`th-event-icon ${tone}`}>{icon}</span>
      {actor ? <PersonLink id={event.actor ?? 'system'} people={people} lang={lang} /> : null} {text} <TimeAgo at={event.at} lang={lang} />
    </div>
  );
}
