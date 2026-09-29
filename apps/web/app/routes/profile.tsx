import { data, Link, redirect } from 'react-router';
import type { Route } from './+types/profile';
import type { Profile as ProfileData } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, type Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { threadPath } from '../lib/threads.js';
import { tt } from '../lib/threadStrings.js';
import { useAccount } from '../lib/useAccount.js';
import { useLang } from '../lib/useLang.js';
import { Icon } from '../ui/Icon.js';
import { AgentBy, Avatar, Box, EmptyState, Label, RelativeTime, StateIcon, Tabs } from '../ui/primitives.js';
import '../styles/pages/people.css';

/**
 * A person's page, by their handle (/u/mendy): who they are on RebbeHub
 * (steward, trusted), how much they have done (suggestions and how many
 * were approved, reviews, issues, comments), and what they did lately, all
 * of it public. An old handle leads here for good (301), as GitHub's
 * renamed accounts do. Nothing private shows: no email, no private issue.
 * Laid out as a GitHub profile: the person at the side, their work as
 * tabs, and their activity month by month.
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

/** This page's own words. */
const WORDS = {
  he: { overview: 'סקירה', of: 'מתוך', edit: 'עריכת החשבון', admin: 'מנהל פלטפורמה', approvedOf: (n: number, of: number) => `${n} מתוך ${of} הצעות אושרו`, suspendedNote: 'החשבון הזה מושעה.' },
  en: { overview: 'Overview', of: 'of', edit: 'Edit your account', admin: 'Platform admin', approvedOf: (n: number, of: number) => `${n} of ${of} suggestions approved`, suspendedNote: 'This account is suspended.' },
} as const;

type Activity = ProfileData['activity'][number];

/** A suggestion's state as its icon's colour: approved purple, withdrawn red, a draft grey, anything else open. */
const suggestionTone = (state: string | null) => (state === 'merged' ? 'approved' : state === 'withdrawn' || state === 'rejected' ? 'closed' : state === 'draft' ? 'neutral' : 'open');

/** An activity's mark: the conversation's kind and state, as its list shows it. */
function ActivityIcon({ a }: { a: Activity }) {
  if (a.thread.kind === 'changeset') return <StateIcon kind="suggestion" state={suggestionTone(a.thread.state)} />;
  if (a.thread.kind === 'report') return <StateIcon kind="report" state={a.thread.state === 'open' ? 'open' : 'approved'} />;
  return (
    <span className="state-icon neutral">
      <Icon name="discuss" />
    </span>
  );
}

/** "September 2026": the heading each month's activity sits under. */
const monthOf = (iso: string, lang: Lang) => new Date(iso).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function Profile({ loaderData }: Route.ComponentProps) {
  const lang = useLang();
  const w = WORDS[lang];
  const account = useAccount();
  const { person, counts, activity } = loaderData.profile;
  const mine = account?.person.id === person.id;
  const list = (path: string, query: Record<string, string>) => href(path, lang, query);

  const months: Array<{ month: string; items: Activity[] }> = [];
  for (const a of activity) {
    const month = monthOf(a.at, lang);
    const last = months[months.length - 1];
    if (last?.month === month) last.items.push(a);
    else months.push({ month, items: [a] });
  }

  return (
    <div className="wrap profile">
      <aside className="profile-card" aria-label={person.displayName}>
        <Avatar name={person.displayName} id={person.id} className="profile-avatar" />
        <div className="profile-names">
          <h1 className="profile-name">
            <bdi>{person.displayName}</bdi>
          </h1>
          <p className="profile-handle" dir="ltr">
            @{person.username}
          </p>
        </div>
        {person.admin || person.steward || person.trust === 'trusted' || person.suspended ? (
          <div className="labels">
            {person.admin ? <Label>{w.admin}</Label> : person.steward ? <Label>{tt(lang, 'steward')}</Label> : null}
            {person.trust === 'trusted' ? <Label tone="sync">{tt(lang, 'trusted')}</Label> : null}
            {person.suspended ? <Label tone="scan">{tt(lang, 'suspended')}</Label> : null}
          </div>
        ) : null}
        {mine ? (
          <Link className="btn block" to={href('/account', lang)}>
            <Icon name="pencil" />
            {w.edit}
          </Link>
        ) : null}
        <ul className="profile-facts">
          <li>
            <Icon name="cal" />
            <span>
              {tt(lang, 'memberSince')} {new Date(person.since).toLocaleDateString(lang === 'he' ? 'he-IL' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })}
            </span>
          </li>
          {counts.suggestions ? (
            <li>
              <Icon name="check" />
              <Link to={list('/suggestions', { author: person.username, state: 'closed' })}>{w.approvedOf(counts.merged, counts.suggestions)}</Link>
            </li>
          ) : null}
          <li>
            <Icon name="discuss" />
            <span>
              <b className="num">{counts.comments}</b> {tt(lang, 'statComments')}
            </span>
          </li>
        </ul>
      </aside>

      <div className="profile-main">
        {person.suspended ? (
          <div className="alert negative" role="note">
            <Icon name="warn" />
            <div>{w.suspendedNote}</div>
          </div>
        ) : null}
        <Tabs
          label={person.displayName}
          current="overview"
          items={[
            { key: 'overview', label: w.overview, icon: 'user', to: href(`/u/${person.username}`, lang) },
            { key: 'suggestions', label: tt(lang, 'statSuggestions'), icon: 'suggest', count: counts.suggestions, to: list('/suggestions', { author: person.username, state: 'closed' }) },
            { key: 'reviews', label: tt(lang, 'statReviews'), icon: 'eye', count: counts.reviews, to: list('/suggestions', { reviewer: person.username, state: 'closed' }) },
            { key: 'issues', label: tt(lang, 'statIssues'), icon: 'report', count: counts.issues, to: list('/issues', { author: person.username }) },
          ]}
        />
        <h2 className="h-block">{tt(lang, 'activity')}</h2>
        {activity.length === 0 ? (
          <Box>
            <EmptyState icon="pulse" title={tt(lang, 'noActivity')} />
          </Box>
        ) : (
          months.map(({ month, items }) => (
            <section key={month} className="profile-month">
              <h3 className="h-sec">{month}</h3>
              <Box as="ul">
                {items.map((a, i) => {
                  const verb = a.kind === 'suggestion' ? 'actSuggestion' : a.kind === 'review' ? 'actReview' : a.kind === 'issue' ? 'actIssue' : 'actComment';
                  const to = a.thread.kind === 'entity' ? `/talk/${a.thread.id}` : a.thread.number ? threadPath(a.thread.kind, a.thread.number) : null;
                  return (
                    <li key={i} className="row activity-row">
                      <ActivityIcon a={a} />
                      <div className="row-main">
                        <span className="activity-line">
                          <span className="muted">
                            {tt(lang, verb)}
                            {a.thread.kind === 'entity' ? ` ${tt(lang, 'talkOf')}` : ''}{' '}
                          </span>
                          {to ? (
                            <Link className="row-title" to={href(to, lang)} dir="auto">
                              {a.thread.title ?? a.thread.path ?? a.thread.id}
                              {a.thread.number ? <span className="num"> #{a.thread.number}</span> : null}
                            </Link>
                          ) : (
                            <span className="row-title" dir="auto">
                              {a.thread.title}
                            </span>
                          )}
                        </span>
                        {a.via ? (
                          <span className="row-sub">
                            <AgentBy via={a.via} lang={lang} who={`@${person.username}`}>
                              <span dir="ltr">@{person.username}</span>
                            </AgentBy>
                          </span>
                        ) : null}
                        {a.excerpt ? (
                          <span className="row-sub activity-excerpt">
                            <bdi>{a.excerpt}</bdi>
                          </span>
                        ) : null}
                      </div>
                      <RelativeTime at={a.at} lang={lang} className="when" />
                    </li>
                  );
                })}
              </Box>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
