import { CircleDot, Eye, GitPullRequest, MessageSquare } from 'lucide-react';
import { data, Link, redirect } from 'react-router';
import type { Route } from './+types/profile';
import { Avatar, TimeAgo } from '../components/threads/Bits.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { threadPath } from '../lib/threads.js';
import { tt } from '../lib/threadStrings.js';
import { useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';

/**
 * A person's page, by their handle (/u/mendy): who they are on RebbeHub
 * (steward, trusted), how much they have done (suggestions and how many
 * were approved, reviews, issues, comments), and what they did lately, all
 * of it public. An old handle leads here for good (301), as GitHub's
 * renamed accounts do. Nothing private shows: no email, no private issue.
 */
export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const found = await api.person(params.username);
  if (!found) throw data('not found', { status: 404 });
  if (found.movedFrom || found.person.username !== params.username) throw redirect(href(`/u/${found.person.username}`, lang), 301);
  return { lang, siteUrl, profile: found };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { person } = loaderData.profile;
  return pageMeta({ title: `${person.displayName} (@${person.username})`, path: `/u/${person.username}`, lang: loaderData.lang, siteUrl: loaderData.siteUrl, noindex: person.suspended });
}

export default function Profile({ loaderData }: Route.ComponentProps) {
  const lang = useLang();
  const account = useAccount();
  const { person, counts, activity } = loaderData.profile;
  const mine = account?.person.id === person.id;
  const stats: Array<[number, Parameters<typeof tt>[1], string]> = [
    [counts.suggestions, 'statSuggestions', `/suggestions?author=${person.username}&state=closed`],
    [counts.merged, 'statMerged', `/suggestions?author=${person.username}&state=closed`],
    [counts.reviews, 'statReviews', `/suggestions?reviewer=${person.username}&state=closed`],
    [counts.issues, 'statIssues', `/issues?author=${person.username}`],
    [counts.comments, 'statComments', ''],
  ];
  return (
    <div className="th-profile">
      <div className="th-profile-card">
        <Avatar name={person.displayName} />
        <div>
          <h1 dir="auto">{person.displayName}</h1>
          <div className="th-handle">@{person.username}</div>
          <div className="th-meta">
            {person.steward ? <span className="th-private">{tt(lang, 'steward')}</span> : null}
            {person.trust === 'trusted' ? <span className="th-private">{tt(lang, 'trusted')}</span> : null}
            {person.suspended ? <span className="th-private">{tt(lang, 'suspended')}</span> : null}
            <span>
              {tt(lang, 'memberSince')} {new Date(person.since).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
            </span>
            {mine ? <Link to={href('/account', lang)}>{tt(lang, 'usernameChange')}</Link> : null}
          </div>
        </div>
      </div>
      <ul className="th-stats">
        {stats.map(([count, key, to]) => (
          <li key={key}>
            <strong>{count}</strong>
            {to ? (
              <Link to={href(to.split('?')[0]!, lang, Object.fromEntries(new URLSearchParams(to.split('?')[1] ?? '')))}>
                <span>{tt(lang, key)}</span>
              </Link>
            ) : (
              <span>{tt(lang, key)}</span>
            )}
          </li>
        ))}
      </ul>
      <section>
        <h2>{tt(lang, 'activity')}</h2>
        {activity.length === 0 ? (
          <p className="note">{tt(lang, 'noActivity')}</p>
        ) : (
          <ul className="th-rows th-list">
            {activity.map((a, i) => {
              const Icon = a.kind === 'suggestion' ? GitPullRequest : a.kind === 'review' ? Eye : a.kind === 'issue' ? CircleDot : MessageSquare;
              const verb = a.kind === 'suggestion' ? 'actSuggestion' : a.kind === 'review' ? 'actReview' : a.kind === 'issue' ? 'actIssue' : 'actComment';
              const to =
                a.thread.kind === 'entity'
                  ? `/talk/${a.thread.id}`
                  : a.thread.number
                    ? threadPath(a.thread.kind, a.thread.number)
                    : null;
              return (
                <li key={i} className="th-row">
                  <Icon size={16} className="th-icon closed" aria-hidden="true" />
                  <div>
                    <span className="th-dim">{tt(lang, verb)} </span>
                    {a.thread.kind === 'entity' ? <span className="th-dim">{tt(lang, 'talkOf')} </span> : null}
                    {to ? (
                      <Link className="th-row-title" to={href(to, lang)} dir="auto">
                        {a.thread.title ?? a.thread.path ?? a.thread.id}
                        {a.thread.number ? <span className="th-number"> #{a.thread.number}</span> : null}
                      </Link>
                    ) : (
                      <span dir="auto">{a.thread.title}</span>
                    )}
                    {a.excerpt ? (
                      <div className="th-meta" dir="auto">
                        {a.excerpt}
                      </div>
                    ) : null}
                  </div>
                  <span className="th-row-side">
                    <TimeAgo at={a.at} lang={lang} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
