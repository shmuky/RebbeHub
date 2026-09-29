import type { Lang } from './i18n.js';
import type { ThreadStringKey } from './threadStrings.js';

/**
 * People and conversations as the browser sees them: the API's answers
 * (packages/core: conversation, issues, inbox, profiles) and one way to
 * call it, through the site's own /_/threads/* (routes/threads-pass.ts) so
 * the session cookie is the site's.
 */

export interface PersonTag {
  name: string;
  username: string | null;
  bot: boolean;
}

export type People = Record<string, PersonTag>;

/** Sent by an agent for its author: one of their API tokens, or an app they connected (Claude). The API's `via`. */
export interface Via {
  kind: 'token' | 'oauth';
  id?: string;
  name: string;
}

export type TimelineItem =
  | {
      type: 'comment';
      id: number;
      at: string;
      author: string;
      body: string | null;
      hidden: boolean;
      parent: number | null;
      anchor: { entity: string; field: string } | null;
      review: number | null;
      resolved: boolean;
      edited: boolean;
      via?: Via | null;
    }
  | { type: 'review'; id: number; at: string; author: string; verdict: 'approve' | 'send_back' | 'comment'; body: string | null; via?: Via | null }
  | { type: 'event'; id: string; at: string; actor: string | null; kind: string; detail: Record<string, unknown> };

export interface IssueLabel {
  name: string;
  description: string | null;
  color: string;
}

export interface Issue {
  id: number;
  number: number;
  title: string | null;
  typeTitle: { he: string; en: string };
  type: string;
  state: 'open' | 'closed';
  stateReason: 'completed' | 'not_planned' | null;
  body: string | null;
  private: boolean;
  author: string | null;
  entity: { id: string; type: string; path: string | null; name: unknown } | null;
  set: string | null;
  labels: IssueLabel[];
  assignees: string[];
  comments: number;
  createdAt: string;
  updatedAt: string | null;
  closedAt: string | null;
  closedBy: string | null;
  closedBySuggestion: number | null;
  via?: Via | null;
}

export interface IssueRights {
  read: boolean;
  comment: boolean;
  edit: boolean;
  close: boolean;
  triage: boolean;
  moderate: boolean;
}

export interface IssueTemplate {
  type: string;
  label: { he: string; en: string };
  template: { he: string; en: string };
  private: boolean;
}

export interface SuggestionListItem {
  id: number;
  number: number;
  title: string;
  status: 'draft' | 'open' | 'merged' | 'sent_back' | 'withdrawn';
  kind: string;
  author: string;
  createdAt: string;
  submittedAt: string | null;
  closedAt: string | null;
  comments: number;
  reviewers: string[];
  approvals: number;
  changesRequested: boolean;
  fixes: number[];
  via?: Via | null;
}

export interface InboxLine {
  id: number;
  reason: 'mention' | 'review_requested' | 'assigned' | 'author' | 'comment' | 'review' | 'state' | 'followed';
  subject: { kind: 'changeset' | 'report' | 'entity' | 'project'; id: string; number: number | null; title: string | null; state: string | null; path: string | null; name: unknown };
  actor: string | null;
  actorName: string | null;
  actorUsername: string | null;
  count: number;
  detail: Record<string, unknown>;
  at: string;
  read: boolean;
}

export interface PersonHit {
  id: string;
  username: string;
  displayName: string;
  participant: boolean;
}

export interface ThreadHit {
  kind: 'changeset' | 'report';
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
}

/** Calls the API through /_/threads/…; throws the API's own words when it says no. */
export async function threads<T>(path: string, init?: { method?: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown }): Promise<T> {
  const response = await fetch(`/_/threads/${path}`, {
    method: init?.method ?? (init?.body === undefined ? 'GET' : 'POST'),
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', accept: 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const json = (await response.json().catch(() => ({}))) as T & { message?: string };
  if (!response.ok) throw new ThreadsError(response.status, json.message ?? response.statusText);
  return json;
}

export class ThreadsError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** How long ago, in words ("3 hours ago", "לפני 3 שעות"); the full time is the element's title. */
export function ago(iso: string, lang: Lang, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const format = new Intl.RelativeTimeFormat(lang === 'he' ? 'he' : 'en', { numeric: 'auto' });
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 30],
    ['month', 12],
    ['year', Infinity],
  ];
  let value = seconds;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return format.format(value, unit);
    value = Math.round(value / size);
  }
  return format.format(value, 'year');
}

/** The full date and time, for a title. */
export const fullTime = (iso: string, lang: Lang) => new Date(iso).toLocaleString(lang === 'he' ? 'he-IL' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });

/** A person as their handle, or as the account id when they have none to show. */
export const handleOf = (id: string | null, people: People) => (id ? (people[id]?.username ?? people[id]?.name ?? id) : null);

/** Where a person's page is. */
export const personPath = (username: string) => `/u/${encodeURIComponent(username)}`;

/** Where #n is: an issue's page, which sends a suggestion's number on to its own page. */
export const threadPath = (kind: 'changeset' | 'report' | 'suggestion' | 'issue', number: number) => (kind === 'changeset' || kind === 'suggestion' ? `/suggestions/${number}` : `/issues/${number}`);

/** A suggestion's status as its badge says it. */
export function suggestionState(status: SuggestionListItem['status']): { key: ThreadStringKey; tone: 'open' | 'closed' | 'merged' | 'attention' } {
  switch (status) {
    case 'merged':
      return { key: 'stateMerged', tone: 'merged' };
    case 'sent_back':
      return { key: 'stateSentBack', tone: 'attention' };
    case 'withdrawn':
      return { key: 'stateWithdrawn', tone: 'closed' };
    case 'draft':
      return { key: 'stateDraft', tone: 'closed' };
    default:
      return { key: 'stateOpen', tone: 'open' };
  }
}

/** Text that reads well on a label's own color: dark on light, light on dark. */
export function labelInk(color: string): string {
  const hex = color.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) || 0);
  return (r! * 299 + g! * 587 + b! * 114) / 1000 > 150 ? '#1f2328' : '#ffffff';
}
