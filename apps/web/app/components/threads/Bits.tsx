import { CircleCheck, CircleDot, CircleSlash, GitMerge, GitPullRequest, GitPullRequestClosed, Lock } from 'lucide-react';
import { Link } from 'react-router';
import type { Lang } from '../../lib/i18n.js';
import { href } from '../../lib/links.js';
import { ago, fullTime, labelInk, personPath, suggestionState, type IssueLabel, type People, type SuggestionListItem } from '../../lib/threads.js';
import { tt } from '../../lib/threadStrings.js';
import '../../threads.css';

/**
 * The small pieces every conversation page shares: a person by their
 * handle, a time in words, a state badge, a label.
 */

/** A person, linked to their page by handle; a reader without an account, or a bot, as plain words. */
export function PersonLink({ id, people, lang, className = 'th-who' }: { id: string | null; people: People; lang: Lang; className?: string }) {
  if (!id) return <span className={className}>{tt(lang, 'reader')}</span>;
  const person = people[id];
  if (!person?.username) return <span className={className}>{person?.name ?? (id === 'system' ? 'RebbeHub' : id)}</span>;
  return (
    <Link className={className} to={href(personPath(person.username), lang)} title={person.name}>
      {person.username}
      {person.bot ? <span className="th-dim"> ({tt(lang, 'bot')})</span> : null}
    </Link>
  );
}

/** The first letter of a name, in a circle: the site keeps no pictures of people. */
export function Avatar({ name, small }: { name: string; small?: boolean }) {
  return (
    <span className={`th-avatar${small ? ' small' : ''}`} aria-hidden="true">
      {[...name.trim()][0]?.toUpperCase() ?? '?'}
    </span>
  );
}

/** A time in words ("3 hours ago"), the full date as its title; written again in the browser, where the clock is the reader's. */
export function TimeAgo({ at, lang, anchor }: { at: string; lang: Lang; anchor?: string }) {
  const words = (
    <time dateTime={at} title={fullTime(at, lang)} suppressHydrationWarning>
      {ago(at, lang)}
    </time>
  );
  return anchor ? (
    <a className="th-time" href={`#${anchor}`}>
      {words}
    </a>
  ) : (
    words
  );
}

export function IssueState({ state, reason, lang, small }: { state: 'open' | 'closed'; reason: 'completed' | 'not_planned' | null; lang: Lang; small?: boolean }) {
  const tone = state === 'open' ? 'open' : reason === 'not_planned' ? 'closed' : 'done';
  const Icon = state === 'open' ? CircleDot : reason === 'not_planned' ? CircleSlash : CircleCheck;
  return (
    <span className={`th-state ${tone}${small ? ' small' : ''}`}>
      <Icon size={small ? 12 : 16} aria-hidden="true" />
      {tt(lang, state === 'open' ? 'stateOpen' : 'stateClosed')}
    </span>
  );
}

export function IssueIcon({ state, reason }: { state: 'open' | 'closed'; reason: 'completed' | 'not_planned' | null }) {
  const tone = state === 'open' ? 'open' : reason === 'not_planned' ? 'closed' : 'done';
  const Icon = state === 'open' ? CircleDot : reason === 'not_planned' ? CircleSlash : CircleCheck;
  return <Icon size={18} className={`th-icon ${tone}`} aria-hidden="true" />;
}

export function SuggestionState({ status, lang, small }: { status: SuggestionListItem['status']; lang: Lang; small?: boolean }) {
  const { key, tone } = suggestionState(status);
  const Icon = status === 'merged' ? GitMerge : status === 'withdrawn' ? GitPullRequestClosed : GitPullRequest;
  return (
    <span className={`th-state ${tone}${small ? ' small' : ''}`}>
      <Icon size={small ? 12 : 16} aria-hidden="true" />
      {tt(lang, key)}
    </span>
  );
}

export function SuggestionIcon({ status }: { status: SuggestionListItem['status'] }) {
  const { tone } = suggestionState(status);
  const Icon = status === 'merged' ? GitMerge : status === 'withdrawn' ? GitPullRequestClosed : GitPullRequest;
  return <Icon size={18} className={`th-icon ${tone}`} aria-hidden="true" />;
}

export function LabelChip({ label, to }: { label: IssueLabel; to?: string }) {
  const style = { background: label.color, color: labelInk(label.color) };
  return to ? (
    <Link className="th-label" style={style} to={to} title={label.description ?? undefined}>
      {label.name}
    </Link>
  ) : (
    <span className="th-label" style={style} title={label.description ?? undefined}>
      {label.name}
    </span>
  );
}

export function PrivateBadge({ lang }: { lang: Lang }) {
  return (
    <span className="th-private">
      <Lock size={11} aria-hidden="true" />
      {tt(lang, 'private')}
    </span>
  );
}
