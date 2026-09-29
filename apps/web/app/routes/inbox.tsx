import type { LocalName } from '@rebbehub/model';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Route } from './+types/inbox';
import { langFrom, nameOf, t } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { personPath, threads, type InboxLine } from '../lib/threads.js';
import { tt, type ThreadStringKey } from '../lib/threadStrings.js';
import { useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';
import { Icon } from '../ui/Icon.js';
import { Box, EmptyState, Label, RelativeTime, Skeleton, StateIcon, Tabs, cx } from '../ui/primitives.js';
import '../styles/pages/people.css';

/**
 * The signed-in person's inbox, as GitHub's notifications: where they were
 * mentioned, asked to review, assigned, and what happened in the
 * conversations they follow, one line per conversation and reason (a busy
 * one counts up instead of filling the page). Opening a line reads it;
 * "Done" reads it without opening. Email updates carry the same lines
 * once, when they are switched on. Each view is its own address
 * (`?filter=`), so the tabs are links.
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

/** What a line asks of the reader stands out: being named, asked or given something. */
const ASKED = new Set<InboxLine['reason']>(['mention', 'review_requested', 'assigned']);

function lineHref(line: InboxLine): string {
  const { kind, id, number, path } = line.subject;
  if (kind === 'changeset') return number === null ? '/review' : `/suggestions/${number}`;
  if (kind === 'report') return number === null ? '/issues' : `/issues/${number}`;
  if (kind === 'entity') return `/talk/${id}`;
  return path ?? '/projects';
}

/** A suggestion's state as its icon's colour: approved purple, withdrawn red, a draft grey, anything else open. */
const suggestionTone = (state: string | null) => (state === 'merged' ? 'approved' : state === 'withdrawn' || state === 'rejected' ? 'closed' : state === 'draft' ? 'neutral' : 'open');

/** The conversation's kind and state, as its list shows it: a suggestion, a report, an item's talk page, a project. */
function SubjectIcon({ subject }: { subject: InboxLine['subject'] }) {
  if (subject.kind === 'changeset') return <StateIcon kind="suggestion" state={suggestionTone(subject.state)} />;
  if (subject.kind === 'report') return <StateIcon kind="report" state={subject.state === 'open' ? 'open' : 'approved'} />;
  return (
    <span className="state-icon neutral">
      <Icon name={subject.kind === 'project' ? 'layers' : 'discuss'} />
    </span>
  );
}

/** Tells the top bar's inbox count to ask again. */
const told = () => window.dispatchEvent(new Event('rebbehub:inbox'));

export default function Inbox() {
  const lang = useLang();
  const account = useAccount();
  const [params] = useSearchParams();
  const filter = TABS.some(([value]) => value === params.get('filter')) ? params.get('filter')! : 'unread';
  const [lines, setLines] = useState<InboxLine[] | null>(null);
  const [unread, setUnread] = useState(0);

  const load = useCallback(async () => {
    const answer = await threads<{ items: InboxLine[]; unread: number }>(`inbox?filter=${encodeURIComponent(filter)}`);
    setLines(answer.items);
    setUnread(answer.unread);
  }, [filter]);

  useEffect(() => {
    setLines(null);
    if (account) void load().catch(() => setLines([]));
  }, [account, load]);

  async function mark(body: { ids?: number[]; all?: boolean; unread?: boolean }) {
    const answer = await threads<{ unread: number }>('inbox/read', { body });
    setUnread(answer.unread);
    told();
    await load();
  }

  const head = (
    <div className="phead">
      <div className="wrap">
        <div className="phead-row">
          <div>
            <h1 className="page-title">{tt(lang, 'inboxTitle')}</h1>
            <p className="lede">{tt(lang, 'inboxLead')}</p>
          </div>
          {account && unread ? (
            <div className="phead-acts">
              <button type="button" className="btn" onClick={() => void mark({ all: true })}>
                <Icon name="check" />
                {tt(lang, 'markAllRead')}
              </button>
            </div>
          ) : null}
        </div>
        {account ? (
          <Tabs
            label={tt(lang, 'inboxTitle')}
            current={filter}
            items={TABS.map(([value, key]) => ({
              key: value,
              label: tt(lang, key),
              to: href('/inbox', lang, { filter: value === 'unread' ? undefined : value }),
              icon: value === 'unread' ? ('inbox' as const) : undefined,
              count: value === 'unread' && unread ? unread : undefined,
            }))}
          />
        ) : null}
      </div>
    </div>
  );

  if (!account)
    return (
      <>
        {head}
        <div className="wrap narrow page">
          {account === undefined ? (
            <Skeleton rows={5} lang={lang} />
          ) : (
            <Box>
              <EmptyState
                icon="inbox"
                title={tt(lang, 'signInForInbox')}
                actions={
                  <Link className="btn primary" to={href('/signin', lang, { return: '/inbox' })}>
                    {t(lang, 'signIn')}
                  </Link>
                }
              />
            </Box>
          )}
        </div>
      </>
    );

  return (
    <>
      {head}
      <div className="wrap page">
        <Box
          className="inbox"
          header={
            <>
              <span>{tt(lang, TABS.find(([value]) => value === filter)![1])}</span>
              {lines && lines.length ? <span className="count">{lines.length}</span> : null}
            </>
          }
        >
          {lines === null ? (
            <Skeleton rows={4} lang={lang} />
          ) : lines.length === 0 ? (
            <EmptyState icon={filter === 'unread' ? 'check' : 'inbox'} title={tt(lang, filter === 'unread' ? 'inboxEmpty' : 'nothingHere')} />
          ) : (
            <ul className="rows">
              {lines.map((line) => {
                const title = line.subject.title ?? (line.subject.name ? nameOf(line.subject.name as LocalName, lang) : null) ?? line.subject.path ?? line.subject.id;
                const doneLabel = tt(lang, line.read ? 'markUnread' : 'markRead');
                return (
                  <li key={line.id} className={cx('row', 'inbox-row', !line.read && 'unread')}>
                    <span className="unread-dot" aria-hidden="true" />
                    <SubjectIcon subject={line.subject} />
                    <div className="row-main">
                      <Link className="row-title" to={href(lineHref(line), lang)} onClick={() => !line.read && void mark({ ids: [line.id] })} dir="auto">
                        {title}
                        {line.subject.number ? <span className="num"> #{line.subject.number}</span> : null}
                      </Link>
                      <span className="row-sub">
                        <Label size="sm" className={ASKED.has(line.reason) ? 'accent' : undefined}>
                          {tt(lang, REASONS[line.reason])}
                        </Label>
                        {line.actorUsername ? (
                          <Link className="who" to={href(personPath(line.actorUsername), lang)} dir="auto">
                            {line.actorName ?? `@${line.actorUsername}`}
                          </Link>
                        ) : line.actorName ? (
                          <span className="who" dir="auto">
                            {line.actorName}
                          </span>
                        ) : null}
                        {line.count > 1 ? (
                          <span>
                            {line.count} {tt(lang, 'times')}
                          </span>
                        ) : null}
                        <RelativeTime at={line.at} lang={lang} className="when" />
                      </span>
                    </div>
                    <button type="button" className="btn icon sm ghost" title={doneLabel} aria-label={doneLabel} onClick={() => void mark({ ids: [line.id], unread: line.read })}>
                      <Icon name={line.read ? 'mail' : 'check'} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Box>
      </div>
    </>
  );
}
