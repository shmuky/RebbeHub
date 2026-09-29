import type { LocalName } from '@rebbehub/model';
import { Check, CircleDot, FolderKanban, GitPullRequest, MessageSquare, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Route } from './+types/inbox';
import { TimeAgo } from '../components/threads/Bits.js';
import { langFrom, nameOf } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { threads, type InboxLine } from '../lib/threads.js';
import { tt, type ThreadStringKey } from '../lib/threadStrings.js';
import { useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';

/**
 * The signed-in person's inbox, as GitHub's notifications: where they were
 * mentioned, asked to review, assigned, and what happened in the
 * conversations they follow, one line per conversation and reason (a busy
 * one counts up instead of filling the page). Opening a line reads it;
 * "Done" reads it without opening. Email updates carry the same lines
 * once, when they are switched on.
 */
export function loader({ request }: Route.LoaderArgs) {
  return { lang: langFrom(request), siteUrl: new URL(request.url).origin };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: loaderData.lang === 'he' ? 'התיבה' : 'Inbox', path: '/inbox', lang: loaderData.lang, siteUrl: loaderData.siteUrl, noindex: true });
}

const TABS: Array<[string, ThreadStringKey]> = [
  ['unread', 'unread'],
  ['all', 'all'],
  ['mention', 'reasonMention'],
  ['review_requested', 'reasonReviewRequested'],
  ['assigned', 'reasonAssigned'],
  ['followed', 'reasonFollowed'],
];

const REASONS: Record<InboxLine['reason'], ThreadStringKey> = {
  mention: 'reasonMention',
  review_requested: 'reasonReviewRequested',
  assigned: 'reasonAssigned',
  author: 'reasonAuthor',
  comment: 'reasonComment',
  review: 'reasonReview',
  state: 'reasonState',
  followed: 'reasonFollowed',
};

function lineHref(line: InboxLine): string {
  const { kind, id, number, path } = line.subject;
  if (kind === 'changeset') return number === null ? '/review' : `/suggestions/${number}`;
  if (kind === 'report') return number === null ? '/issues' : `/issues/${number}`;
  if (kind === 'entity') return `/talk/${id}`;
  return path ?? '/projects';
}

/** Tells the top bar's inbox count to ask again. */
const told = () => window.dispatchEvent(new Event('rebbehub:inbox'));

export default function Inbox() {
  const lang = useLang();
  const account = useAccount();
  const [params, setParams] = useSearchParams();
  const filter = params.get('filter') ?? 'unread';
  const [lines, setLines] = useState<InboxLine[] | null>(null);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    const answer = await threads<{ items: InboxLine[]; unread: number }>(`inbox?filter=${encodeURIComponent(filter)}`);
    setLines(answer.items);
    setUnread(answer.unread);
  }, [filter]);

  useEffect(() => {
    if (account) void load().catch(() => setLines([]));
  }, [account, load]);

  async function mark(body: { ids?: number[]; all?: boolean; unread?: boolean }) {
    const answer = await threads<{ unread: number }>('inbox/read', { body });
    setUnread(answer.unread);
    told();
    await load();
  }

  if (account === undefined) return <p className="note">…</p>;
  if (account === null)
    return (
      <p className="note">
        <Link to={href('/signin', lang, { return: '/inbox' })}>{tt(lang, 'signInForInbox')}</Link>
      </p>
    );

  return (
    <div className="th-page">
      <div className="th-head">
        <div>
          <h1>{tt(lang, 'inboxTitle')}</h1>
          <p className="subtitle">{tt(lang, 'inboxLead')}</p>
        </div>
        {unread ? (
          <button type="button" className="secondary" onClick={() => void mark({ all: true })}>
            <Check size={14} aria-hidden="true" /> {tt(lang, 'markAllRead')}
          </button>
        ) : null}
      </div>
      <nav className="th-inbox-tabs" aria-label={tt(lang, 'inboxTitle')}>
        {TABS.map(([value, key]) => (
          <button
            key={value}
            type="button"
            className={`th-chip-button${filter === value ? ' active' : ''}`}
            aria-pressed={filter === value}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (value === 'unread') next.delete('filter');
              else next.set('filter', value);
              setParams(next, { preventScrollReset: true });
            }}
          >
            {tt(lang, key)}
            {value === 'unread' && unread ? <span className="th-unread-dot">{unread}</span> : null}
          </button>
        ))}
      </nav>
      <div className="th-list">
        {lines === null ? (
          <p className="note" style={{ padding: '0.75rem' }}>…</p>
        ) : lines.length === 0 ? (
          <p className="note" style={{ padding: '0.75rem' }}>{tt(lang, filter === 'unread' ? 'inboxEmpty' : 'nothingHere')}</p>
        ) : (
          <ul className="th-rows">
            {lines.map((line) => {
              const Icon = line.subject.kind === 'changeset' ? GitPullRequest : line.subject.kind === 'report' ? CircleDot : line.subject.kind === 'project' ? FolderKanban : MessageSquare;
              const title =
                line.subject.title ?? (line.subject.name ? nameOf(line.subject.name as LocalName, lang) : null) ?? line.subject.path ?? line.subject.id;
              return (
                <li key={line.id} className={`th-inbox-row${line.read ? '' : ' unread'}`}>
                  <Icon size={18} className={`th-icon ${line.subject.state === 'merged' ? 'merged' : line.subject.state === 'open' ? 'open' : 'closed'}`} aria-hidden="true" />
                  <div>
                    <Link className="th-row-title" to={href(lineHref(line), lang)} onClick={() => !line.read && void mark({ ids: [line.id] })} dir="auto">
                      {title}
                      {line.subject.number ? <span className="th-number"> #{line.subject.number}</span> : null}
                    </Link>
                    <div className="th-meta">
                      <span className="th-private">{tt(lang, REASONS[line.reason])}</span>
                      {line.actorUsername ? <span>@{line.actorUsername}</span> : line.actorName ? <span>{line.actorName}</span> : null}
                      {line.count > 1 ? <span>· {line.count} {tt(lang, 'times')}</span> : null}
                      <span>
                        · <TimeAgo at={line.at} lang={lang} />
                      </span>
                    </div>
                  </div>
                  <button type="button" className="th-gear" title={tt(lang, line.read ? 'markUnread' : 'markRead')} aria-label={tt(lang, line.read ? 'markUnread' : 'markRead')} onClick={() => void mark({ ids: [line.id], unread: line.read })}>
                    {line.read ? <Undo2 size={16} aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
