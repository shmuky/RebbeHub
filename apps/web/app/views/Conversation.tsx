import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Composer } from '../components/threads/Composer.js';
import { RichText } from '../components/threads/RichText.js';
import type { Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { LABELS } from '../lib/suggestions.js';
import { fullTime, personPath, threadPath, threads, type IssueLabel, type People, type TimelineItem } from '../lib/threads.js';
import { tt } from '../lib/threadStrings.js';
import { Icon, type IconName } from '../ui/Icon.js';
import { Label, RelativeTime } from '../ui/primitives.js';
import { TimelineBlock, TimelineComment, TimelineEvent } from '../ui/Timeline.js';

/**
 * A suggestion's or an issue's conversation down one line, as a pull
 * request's is: each comment and review in a card beside its writer's
 * initials (a review with the comments written in it, each comment with
 * its replies, a comment on a field saying which), and everything else
 * that happened (sent for review, labels, people asked or assigned,
 * mentioned elsewhere, approved, closed) as a line with a dot between
 * them. The writer of a comment may change its words in place; the
 * suggestion's author and its reviewers resolve comments on its fields.
 */

type Comment = Extract<TimelineItem, { type: 'comment' }>;
type Review = Extract<TimelineItem, { type: 'review' }>;
type Event = Extract<TimelineItem, { type: 'event' }>;

export interface ConversationProps {
  items: TimelineItem[];
  people: People;
  lang: Lang;
  viewer: string | null;
  /** `changeset:12` or `report:3`, so @ suggests this conversation's people first. */
  thread: string;
  /** The words on a person's card beside their name: "author", "keeper". */
  roleOf?: (person: string) => ReactNode;
  fieldLabel?: (anchor: { entity: string; field: string }) => string;
  labels?: IssueLabel[];
  mayResolve?: boolean;
  mayReply: boolean;
  reply: (body: string, parent: number) => Promise<unknown>;
  changed: () => void;
  /** Blocks set in after a given item (a suggestion's changes after its description). */
  after?: (item: TimelineItem) => ReactNode;
}

const W = {
  wrote: { he: 'כתב', en: 'wrote' },
} as const;

/** A person by their name, linked to their page; a bot says so. */
export function Person({ id, people, lang }: { id: string | null; people: People; lang: Lang }) {
  if (!id) return <b>{tt(lang, 'reader')}</b>;
  const p = people[id];
  const name = p?.name ?? (id === 'system' ? 'RebbeHub' : id);
  if (!p?.username) return <b>{name}</b>;
  return (
    <Link className="person" to={href(personPath(p.username), lang)} title={`@${p.username}`}>
      <b>{name}</b>
      {p.bot ? <span className="bot-tag">{tt(lang, 'bot')}</span> : null}
    </Link>
  );
}

export function When({ at, lang, anchor }: { at: string; lang: Lang; anchor?: string }) {
  const time = <RelativeTime at={at} lang={lang} />;
  return anchor ? (
    <a className="when" href={`#${anchor}`} title={fullTime(at, lang)}>
      {time}
    </a>
  ) : (
    <span className="when" title={fullTime(at, lang)}>
      {time}
    </span>
  );
}

export function Conversation(props: ConversationProps) {
  const { items, after } = props;
  const comments = items.filter((i): i is Comment => i.type === 'comment');
  const repliesOf = (id: number) => comments.filter((c) => c.parent === id);
  const inReview = (id: number) => comments.filter((c) => c.review === id && c.parent === null);
  const top = items.filter((i) => (i.type === 'comment' ? i.parent === null && i.review === null : true));
  return (
    <>
      {top.map((item) => (
        <FragmentWith key={`${item.type}-${item.id}`} extra={after?.(item)}>
          {item.type === 'comment' ? (
            <CommentItem {...props} comment={item} replies={repliesOf(item.id)} />
          ) : item.type === 'review' ? (
            <ReviewItem {...props} review={item} comments={inReview(item.id)} repliesOf={repliesOf} />
          ) : (
            <EventItem {...props} event={item} />
          )}
        </FragmentWith>
      ))}
    </>
  );
}

function FragmentWith({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <>
      {children}
      {extra}
    </>
  );
}

function ReviewItem(props: ConversationProps & { review: Review; comments: Comment[]; repliesOf: (id: number) => Comment[] }) {
  const { review, people, lang, comments, repliesOf, roleOf } = props;
  const verb = review.verdict === 'approve' ? 'approved' : review.verdict === 'send_back' ? 'sentBack' : 'reviewedComment';
  const icon: IconName = review.verdict === 'approve' ? 'check' : review.verdict === 'send_back' ? 'back' : 'eye';
  const tone = review.verdict === 'approve' ? 'approved' : review.verdict === 'send_back' ? 'closed' : undefined;
  if (!review.body && comments.length === 0)
    return (
      <TimelineEvent icon={icon} tone={tone} id={`r-${review.id}`}>
        <Person id={review.author} people={people} lang={lang} /> {tt(lang, verb)} <When at={review.at} lang={lang} anchor={`r-${review.id}`} />
      </TimelineEvent>
    );
  const person = people[review.author];
  return (
    <>
      <TimelineEvent icon={icon} tone={tone}>
        <Person id={review.author} people={people} lang={lang} /> {tt(lang, verb)} <When at={review.at} lang={lang} anchor={`r-${review.id}`} />
      </TimelineEvent>
      <TimelineComment
        id={`r-${review.id}`}
        author={person?.name ?? review.author}
        authorId={review.author}
        bot={person?.bot}
        role={roleOf?.(review.author)}
        header={
          <>
            <Person id={review.author} people={people} lang={lang} /> <span className="muted">{W.wrote[lang]}</span> <When at={review.at} lang={lang} anchor={`r-${review.id}`} />
          </>
        }
      >
        {review.body ? <RichText text={review.body} lang={lang} /> : null}
        {comments.length ? (
          <div className="in-review">
            {comments.map((c) => (
              <CommentCard key={c.id} {...props} comment={c} replies={repliesOf(c.id)} nested />
            ))}
          </div>
        ) : null}
      </TimelineComment>
    </>
  );
}

function CommentItem(props: ConversationProps & { comment: Comment; replies: Comment[] }) {
  return <CommentCard {...props} />;
}

function CommentCard(props: ConversationProps & { comment: Comment; replies: Comment[]; nested?: boolean }) {
  const { comment, replies, people, lang, viewer, fieldLabel, mayResolve, mayReply, reply, changed, thread, roleOf, nested } = props;
  const [open, setOpen] = useState(!comment.resolved);
  const [replying, setReplying] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const person = people[comment.author];

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

  const header = (
    <>
      <Person id={comment.author} people={people} lang={lang} /> <span className="muted">{W.wrote[lang]}</span> <When at={comment.at} lang={lang} anchor={`c-${comment.id}`} />
      {comment.edited ? <span className="subtle">· {tt(lang, 'edited')}</span> : null}
      {comment.anchor ? (
        <span className="anchor-tag">
          <Icon name="file" size={12} />
          {tt(lang, 'onField')} {fieldLabel ? fieldLabel(comment.anchor) : comment.anchor.field}
        </span>
      ) : null}
      {comment.resolved ? <span className="resolved-tag">{tt(lang, 'resolved')}</span> : null}
    </>
  );
  const footer =
    comment.anchor && viewer && (mayResolve || comment.author === viewer) ? (
      <>
        <button type="button" className="link-btn" onClick={() => void resolve(!comment.resolved)}>
          {tt(lang, comment.resolved ? 'unresolve' : 'resolve')}
        </button>
        {comment.resolved ? (
          <button type="button" className="link-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
            {tt(lang, 'showResolved')}
          </button>
        ) : null}
      </>
    ) : null;

  const body = open ? (
    <>
      <CommentWords {...props} comment={comment} />
      {replies.length ? (
        <ul className="replies">
          {replies.map((r) => (
            <li key={r.id} id={`c-${r.id}`}>
              <div className="reply-h">
                <Person id={r.author} people={people} lang={lang} /> <When at={r.at} lang={lang} anchor={`c-${r.id}`} />
                {r.edited ? <span className="subtle"> · {tt(lang, 'edited')}</span> : null}
              </div>
              <CommentWords {...props} comment={r} />
            </li>
          ))}
        </ul>
      ) : null}
      {mayReply ? (
        replying ? (
          <div className="reply-box">
            <Composer lang={lang} value={draft} onChange={setDraft} onSubmit={() => void send()} submitLabel={tt(lang, 'reply')} busy={busy} thread={thread} autoFocus error={error}>
              <button type="button" className="btn sm" onClick={() => setReplying(false)}>
                {tt(lang, 'cancel')}
              </button>
            </Composer>
          </div>
        ) : (
          <button type="button" className="link-btn reply-link" onClick={() => setReplying(true)}>
            <Icon name="discuss" size={14} /> {tt(lang, 'reply')}
          </button>
        )
      ) : null}
    </>
  ) : null;

  if (nested)
    return (
      <article className="nested-comment" id={`c-${comment.id}`}>
        <header className="reply-h">{header}</header>
        {body}
        {footer ? <footer className="reply-f">{footer}</footer> : null}
      </article>
    );
  return (
    <TimelineComment id={`c-${comment.id}`} author={person?.name ?? comment.author} authorId={comment.author} bot={person?.bot} mine={viewer === comment.author} role={roleOf?.(comment.author)} header={header} footer={footer}>
      {body}
    </TimelineComment>
  );
}

/** A comment's words; its writer may change them in place. */
function CommentWords({ comment, lang, viewer, thread, changed }: ConversationProps & { comment: Comment }) {
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
  if (comment.hidden || comment.body === null) return <p className="subtle">{tt(lang, 'hiddenComment')}</p>;
  if (editing)
    return (
      <Composer lang={lang} value={draft} onChange={setDraft} onSubmit={() => void save()} submitLabel={tt(lang, 'save')} busy={busy} thread={thread} autoFocus error={error}>
        <button type="button" className="btn sm" onClick={() => setEditing(false)}>
          {tt(lang, 'cancel')}
        </button>
      </Composer>
    );
  return (
    <div className="words">
      <RichText text={comment.body} lang={lang} />
      {viewer && viewer === comment.author ? (
        <button type="button" className="icon-btn edit-own" onClick={() => (setDraft(comment.body ?? ''), setEditing(true))} aria-label={tt(lang, 'edit')} title={tt(lang, 'edit')}>
          <Icon name="pencil" size={13} />
        </button>
      ) : null}
    </div>
  );
}

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

function EventItem({ event, people, lang, labels = [] }: ConversationProps & { event: Event }) {
  const d = event.detail;
  const by = d.by as { kind?: string; number?: number | null } | undefined;
  const who = (list: string[]) =>
    list.map((id, i) => (
      <span key={id}>
        {i ? ', ' : ''}
        <Person id={id} people={people} lang={lang} />
      </span>
    ));
  const ref = (number: number | null | undefined, kind: 'changeset' | 'report') =>
    number ? (
      <Link className="ref" to={href(threadPath(kind, number), lang)}>
        #{number}
      </Link>
    ) : null;
  const chips = (names: string[]) =>
    names.map((name) => (
      <Label key={name} color={`#${(labels.find((l) => l.name === name)?.color ?? '6e7781').replace('#', '')}`} size="sm" to={href('/issues', lang, { label: name })}>
        {LABELS[name]?.[lang] ?? name}
      </Label>
    ));

  let icon: IconName = 'dot';
  let tone: 'open' | 'approved' | 'closed' | 'machine' | undefined;
  let text: ReactNode = null;
  let actor = true;
  switch (event.kind) {
    case 'opened':
      text = tt(lang, 'opened');
      tone = 'open';
      break;
    case 'submitted':
      icon = 'eye';
      text = tt(lang, d.live ? 'submittedLive' : 'submitted');
      break;
    case 'sent_back':
      icon = 'back';
      tone = 'closed';
      text = tt(lang, 'sentBack');
      break;
    case 'merged':
      icon = 'check';
      tone = 'approved';
      text = tt(lang, 'merged');
      break;
    case 'withdrawn':
      icon = 'x';
      tone = 'closed';
      text = tt(lang, 'withdrawn');
      break;
    case 'reverted':
      icon = 'back';
      text = (
        <>
          {tt(lang, 'reverted')} {ref(by?.number, 'changeset')}
        </>
      );
      break;
    case 'closed': {
      const done = d.outcome !== 'dismissed';
      icon = done ? 'reportdone' : 'reportclosed';
      tone = done ? 'approved' : 'closed';
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
      icon = 'report';
      tone = 'open';
      text = tt(lang, 'reopened');
      break;
    case 'renamed':
      icon = 'pencil';
      text = (
        <>
          {tt(lang, 'renamed')} <s>{String(d.from ?? '')}</s> <b>{String(d.to ?? '')}</b>
        </>
      );
      break;
    case 'edited':
      icon = 'pencil';
      text = tt(lang, 'edited');
      break;
    case 'labeled':
    case 'unlabeled':
      icon = 'tag';
      text = (
        <>
          {tt(lang, event.kind === 'labeled' ? 'labeled' : 'unlabeled')} <span className="event-labels">{chips(ids(d.labels))}</span>
        </>
      );
      break;
    case 'assigned':
    case 'unassigned': {
      icon = 'user';
      const list = ids(d.assignees);
      text =
        event.kind === 'assigned' && list.length === 1 && list[0] === event.actor ? (
          tt(lang, 'selfAssigned')
        ) : (
          <>
            {tt(lang, event.kind === 'assigned' ? 'assigned' : 'unassigned')} {who(list)}
          </>
        );
      break;
    }
    case 'review_requested':
      icon = 'users';
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
            {tt(lang, 'reviewRequested')} {who(ids(d.reviewers))}
          </>
        );
      break;
    case 'review_request_removed':
      icon = 'users';
      text = (
        <>
          {tt(lang, 'reviewRequestRemoved')} {who(ids(d.reviewers))}
        </>
      );
      break;
    case 'referenced': {
      icon = 'link';
      const from = d.from as { kind?: string; id?: string; number?: number | null; title?: string | null } | undefined;
      const place =
        from?.kind === 'changeset' || from?.kind === 'report' ? (
          <>
            {ref(from.number, from.kind)}
            {from.title ? <span className="muted"> “{from.title}”</span> : null}
          </>
        ) : from?.kind === 'entity' && from.id ? (
          <Link className="ref" to={href(`/talk/${from.id}`, lang)}>
            {tt(lang, 'talkOf')} {from.id}
          </Link>
        ) : null;
      text = (
        <>
          {tt(lang, d.closes ? 'referencedCloses' : 'referenced')} {place}
        </>
      );
      break;
    }
    case 'made_private':
      icon = 'lock';
      text = tt(lang, 'madePrivate');
      break;
    case 'made_public':
      icon = 'eye';
      text = tt(lang, 'madePublic');
      break;
    default:
      text = event.kind;
  }
  return (
    <TimelineEvent icon={icon} tone={tone}>
      {actor ? <Person id={event.actor ?? 'system'} people={people} lang={lang} /> : null} {text} <When at={event.at} lang={lang} />
    </TimelineEvent>
  );
}

export { TimelineBlock };

/** Following a suggestion or a report: every comment and change comes to the inbox. */
export function FollowToggle({ kind, id, on: initial, lang }: { kind: 'changeset' | 'report'; id: number; on: boolean; lang: Lang }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => setOn(initial), [initial]);
  async function toggle() {
    setBusy(true);
    try {
      const response = await fetch('/_/follows', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ kind, id: String(id), on: !on }) });
      if (response.ok) setOn(!on);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" className="link-btn" onClick={() => void toggle()} disabled={busy} aria-pressed={on} title={tt(lang, on ? 'subscribedNote' : 'notSubscribedNote')}>
      <Icon name={on ? 'bellon' : 'eye'} size={14} /> {lang === 'he' ? (on ? 'במעקב' : 'מעקב') : on ? 'Following' : 'Follow'}
    </button>
  );
}
