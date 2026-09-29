import { one, type Db } from '@rebbehub/db';
import { referencesIn, type EntityId } from '@rebbehub/model';
import type { Catalog, ChangesetRow, ChangesetStatus } from './catalog.js';
import { badState, forbidden, invalid, notFound } from './errors.js';
import type { Resolution } from './merge.js';
import { canSuggest } from './permissions.js';
import { followersOf, noteWriting, requestReviewers, reviewGiven, threadEvent, type ThreadEventKind } from './threads.js';
import { idsOfUsernames } from './usernames.js';
import { viaColumn, type Via } from './via.js';

/**
 * A Suggestion as a pull request (the plan, section 7): its conversation
 * in order - what it says, comments, reviews (Approve, Request changes,
 * or a comment), comments on one field of one item in its change, who is
 * asked to review, and what happened to it - and the acts that add to it.
 * Approving still merges and "Request changes" still sends it back, as
 * the catalog always did (Catalog.merge, Catalog.sendBack); a review here
 * only gathers them, with its comments, in one act.
 */

/** Who someone is, as a conversation shows them: their name, their handle (people only), and whether they are a machine. */
export interface PersonTag {
  name: string;
  username: string | null;
  bot: boolean;
}

export async function peopleOf(db: Db, ids: Iterable<string | null | undefined>): Promise<Record<string, PersonTag>> {
  const list = [...new Set([...ids].filter((id): id is string => Boolean(id)))];
  if (list.length === 0) return {};
  const { rows } = await db.query<{ id: string; name: string | null; username: string | null; bot: boolean | null }>(
    `SELECT x.id, coalesce(p.display_name, a.display_name) AS name, p.username, a.is_bot AS bot
     FROM unnest($1::text[]) AS x(id) LEFT JOIN account a ON a.id = x.id LEFT JOIN auth.person p ON p.id = x.id`,
    [list],
  );
  return Object.fromEntries(rows.map((r) => [r.id, { name: r.name ?? r.id, username: r.username, bot: Boolean(r.bot) }]));
}

export type TimelineItem =
  | {
      type: 'comment';
      id: number;
      at: string;
      author: string;
      /** Null once hidden: its words go, the thread stays whole. */
      body: string | null;
      hidden: boolean;
      parent: number | null;
      /** On a suggestion: the one field of one item it is about. */
      anchor: { entity: string; field: string } | null;
      /** The review it was written in, if any. */
      review: number | null;
      resolved: boolean;
      edited: boolean;
      /** Sent by an agent for its author (via.ts). */
      via: Via | null;
    }
  | { type: 'review'; id: number; at: string; author: string; verdict: 'approve' | 'send_back' | 'comment'; body: string | null; via: Via | null }
  | { type: 'event'; id: string; at: string; actor: string | null; kind: ThreadEventKind | 'opened'; detail: Record<string, unknown> };

const iso = (value: Date | string) => new Date(value).toISOString();

interface CommentRow {
  id: string | number;
  parent_id: string | number | null;
  author: string;
  body: string;
  created_at: Date | string;
  hidden_at: Date | string | null;
  anchor: { entity: string; field: string } | null;
  review_id: string | number | null;
  resolved_at: Date | string | null;
  edited_at: Date | string | null;
  via: Via | null;
}

/** The comments and events of a thread, as timeline items. */
export async function threadItems(db: Db, kind: 'changeset' | 'report', id: number): Promise<TimelineItem[]> {
  const [comments, events] = await Promise.all([
    db.query<CommentRow>(
      'SELECT id, parent_id, author, body, created_at, hidden_at, anchor, review_id, resolved_at, edited_at, via FROM comment WHERE target_kind = $1 AND target_id = $2 ORDER BY created_at, id',
      [kind, String(id)],
    ),
    db.query<{ id: string | number; actor: string; kind: ThreadEventKind; detail: Record<string, unknown>; created_at: Date | string }>(
      'SELECT id, actor, kind, detail, created_at FROM thread_event WHERE thread_kind = $1 AND thread_id = $2 ORDER BY created_at, id',
      [kind, id],
    ),
  ]);
  return [
    ...comments.rows.map(
      (c): TimelineItem => ({
        type: 'comment',
        id: Number(c.id),
        at: iso(c.created_at),
        author: c.author,
        body: c.hidden_at ? null : c.body,
        hidden: c.hidden_at !== null,
        parent: c.parent_id === null ? null : Number(c.parent_id),
        anchor: c.anchor ?? null,
        review: c.review_id === null ? null : Number(c.review_id),
        resolved: c.resolved_at !== null,
        edited: c.edited_at !== null,
        via: c.via ?? null,
      }),
    ),
    ...events.rows.map((e): TimelineItem => ({ type: 'event', id: `e${e.id}`, at: iso(e.created_at), actor: e.actor === 'system' ? null : e.actor, kind: e.kind, detail: e.detail ?? {} })),
  ];
}

/**
 * Oldest first. What one act wrote together shares its moment (a review,
 * its comments, and the merge it made): then the opening comes first, a
 * review before its comments, and what followed from them last.
 */
const rank = (item: TimelineItem) => (item.type === 'event' ? (item.kind === 'opened' ? 0 : 3) : item.type === 'review' ? 1 : 2);
export const byTime = (a: TimelineItem, b: TimelineItem) => a.at.localeCompare(b.at) || rank(a) - rank(b);

/**
 * A suggestion's conversation, oldest first. Suggestions made before
 * conversations were kept have no events for what happened to them; those
 * are read from the suggestion itself (sent for review, merged, withdrawn).
 */
export async function suggestionTimeline(catalog: Catalog, id: number): Promise<{ items: TimelineItem[]; people: Record<string, PersonTag> }> {
  const cs = await catalog.changeset(id);
  const items = await threadItems(catalog.db, 'changeset', id);
  const { rows: reviews } = await catalog.db.query<{ id: string | number; reviewer: string; verdict: 'approve' | 'send_back' | 'comment'; body: string | null; created_at: Date | string; via: Via | null }>(
    'SELECT id, reviewer, verdict, body, created_at, via FROM review WHERE changeset_id = $1 ORDER BY created_at, id',
    [id],
  );
  items.push(...reviews.map((r): TimelineItem => ({ type: 'review', id: Number(r.id), at: iso(r.created_at), author: r.reviewer, verdict: r.verdict, body: r.body, via: r.via ?? null })));
  items.push({ type: 'event', id: 'opened', at: iso(cs.created_at), actor: cs.author, kind: 'opened', detail: {} });
  const has = (kind: ThreadEventKind) => items.some((i) => i.type === 'event' && i.kind === kind);
  if (!has('submitted') && cs.submitted_at) items.push({ type: 'event', id: 'submitted', at: iso(cs.submitted_at), actor: cs.author, kind: 'submitted', detail: {} });
  if (!has('merged') && cs.status === 'merged' && cs.closed_at) {
    const commit = cs.merged_commit === null ? null : await one<{ merged_by: string }>(catalog.db, 'SELECT merged_by FROM commit WHERE seq = $1', [cs.merged_commit]);
    items.push({ type: 'event', id: 'merged', at: iso(cs.closed_at), actor: commit?.merged_by ?? null, kind: 'merged', detail: { commit: cs.merged_commit } });
  }
  if (!has('withdrawn') && cs.status === 'withdrawn' && cs.closed_at) items.push({ type: 'event', id: 'withdrawn', at: iso(cs.closed_at), actor: null, kind: 'withdrawn', detail: {} });
  items.sort(byTime);
  const people = await peopleOf(catalog.db, [
    cs.author,
    ...items.map((i) => (i.type === 'event' ? i.actor : i.author)),
    ...items.flatMap((i) => (i.type === 'event' && Array.isArray(i.detail.reviewers) ? (i.detail.reviewers as string[]) : [])),
    ...items.flatMap((i) => (i.type === 'event' && typeof i.detail.assignee === 'string' ? [i.detail.assignee] : [])),
  ]);
  return { items, people };
}

/** Who is asked to review a suggestion now, and the reports it says it fixes (with whether each is still open). */
export async function suggestionLinks(catalog: Catalog, id: number): Promise<{
  reviewRequests: Array<{ reviewer: string; requestedBy: string | null; at: string }>;
  fixes: Array<{ number: number; title: string | null; state: 'open' | 'closed'; private: boolean }>;
}> {
  const [requests, fixes] = await Promise.all([
    catalog.db.query<{ reviewer: string; requested_by: string; requested_at: Date | string }>('SELECT reviewer, requested_by, requested_at FROM review_request WHERE changeset_id = $1 ORDER BY requested_at', [id]),
    catalog.db.query<{ number: string | number; title: string | null; reason: string; status: string; private: boolean }>(
      'SELECT r.number, r.title, r.reason, r.status, r.private FROM thread_link l JOIN report r ON r.id = l.report_id WHERE l.changeset_id = $1 AND l.closes ORDER BY r.number',
      [id],
    ),
  ]);
  return {
    reviewRequests: requests.rows.map((r) => ({ reviewer: r.reviewer, requestedBy: r.requested_by === 'system' ? null : r.requested_by, at: iso(r.requested_at) })),
    // A private report's title stays with it: only its number shows.
    fixes: fixes.rows.map((f) => ({ number: Number(f.number), title: f.private ? null : f.title, state: f.status === 'open' ? 'open' : 'closed', private: f.private })),
  };
}

/** The items a suggestion changes, to check that a comment is about one of them. */
async function changedItems(catalog: Catalog, id: number): Promise<Set<string>> {
  return new Set((await catalog.proposals(id)).map((p) => p.entityId));
}

function cleanAnchor(anchor: unknown, items: Set<string>): { entity: EntityId; field: string } {
  const a = anchor as { entity?: unknown; field?: unknown } | null;
  if (!a || typeof a.entity !== 'string' || !items.has(a.entity)) throw invalid('a review comment is about an item this suggestion changes');
  const field = typeof a.field === 'string' ? a.field.trim() : '';
  if (field.length > 300) throw invalid('that field is not in this change');
  return { entity: a.entity as EntityId, field };
}

const cleanBody = (body: unknown, required = true): string => {
  const text = typeof body === 'string' ? body.trim() : '';
  if (required && !text) throw invalid('write something first');
  if (text.length > 10_000) throw invalid('at most 10,000 characters');
  return text;
};

/** A comment in a suggestion's conversation, an answer to one, or a comment on one field of one item in its change. */
export async function commentOnSuggestion(catalog: Catalog, by: string, id: number, input: { body: unknown; parent?: number; anchor?: unknown }): Promise<number> {
  const cs = await catalog.changeset(id);
  if (cs.number === null) throw notFound(`suggestion ${id}`);
  const body = cleanBody(input.body);
  let anchor: { entity: EntityId; field: string } | undefined;
  if (input.parent !== undefined) {
    const parent = await one<{ anchor: { entity: EntityId; field: string } | null }>(catalog.db, "SELECT anchor FROM comment WHERE id = $1 AND target_kind = 'changeset' AND target_id = $2", [input.parent, String(id)]);
    if (!parent) throw invalid('that comment is not in this conversation');
    anchor = parent.anchor ?? undefined;
  } else if (input.anchor !== undefined) anchor = cleanAnchor(input.anchor, await changedItems(catalog, id));
  return catalog.comment(by, { kind: 'changeset', id: String(id) }, body, input.parent, anchor ? { anchor } : {});
}

export type ReviewVerdict = 'approve' | 'request_changes' | 'comment';

/**
 * A review, in one act: Approve (which merges it, as ever, when the
 * reviewer may), Request changes (which sends it back, with what to
 * change), or a comment; with any comments on fields of its items.
 */
export async function reviewSuggestion(
  catalog: Catalog,
  by: string,
  id: number,
  input: { verdict: ReviewVerdict; body?: unknown; comments?: Array<{ entity?: unknown; field?: unknown; body?: unknown }>; resolutions?: Record<string, Record<string, Resolution>> },
): Promise<{ review: number; status: ChangesetStatus; commit?: number | null }> {
  const cs = await catalog.changeset(id);
  if (cs.number === null) throw notFound(`suggestion ${id}`);
  const account = await catalog.account(by);
  if (!canSuggest(account)) throw forbidden('this account cannot review');
  if (cs.status === 'draft') throw badState('this suggestion has not been sent for review yet');
  const items = await changedItems(catalog, id);
  const comments = (input.comments ?? []).slice(0, 50).map((c) => ({ anchor: cleanAnchor(c, items), body: cleanBody(c.body) }));
  const body = cleanBody(input.body, input.verdict === 'request_changes' || (input.verdict === 'comment' && comments.length === 0));
  let reviewId: number;
  let commit: number | null | undefined;
  if (input.verdict === 'approve') {
    if (by === cs.author) throw forbidden('a suggestion is approved by someone other than its author');
    commit = (await catalog.merge(id, by, input.resolutions ?? {}, body || undefined)).commit;
    reviewId = await latestReview(catalog.db, id, by, 'approve');
  } else if (input.verdict === 'request_changes') {
    if (by === cs.author) throw forbidden('ask for changes on someone else’s suggestion');
    await catalog.sendBack(id, by, body);
    reviewId = await latestReview(catalog.db, id, by, 'send_back');
  } else if (input.verdict === 'comment') {
    reviewId = await catalog.db.transaction(async (tx) => {
      const row = await one<{ id: number }>(tx, "INSERT INTO review (changeset_id, reviewer, verdict, body, via) VALUES ($1, $2, 'comment', $3, $4) RETURNING id", [id, by, body || null, viaColumn()]);
      await reviewGiven(tx, { changesetId: id, by, verdict: 'comment', reviewId: Number(row!.id), body });
      return Number(row!.id);
    });
  } else throw invalid('a review approves, requests changes, or comments');
  for (const c of comments) await catalog.comment(by, { kind: 'changeset', id: String(id) }, c.body, undefined, { anchor: c.anchor, review: reviewId });
  return { review: reviewId, status: (await catalog.changeset(id)).status, ...(commit !== undefined ? { commit } : {}) };
}

async function latestReview(db: Db, id: number, by: string, verdict: string): Promise<number> {
  const row = await one<{ id: string | number }>(db, 'SELECT id FROM review WHERE changeset_id = $1 AND reviewer = $2 AND verdict = $3 ORDER BY id DESC LIMIT 1', [id, by, verdict]);
  return Number(row!.id);
}

/** Whether `by` may ask others to review this suggestion: its author, a steward, or someone who may approve it. */
async function mayManageReviewers(catalog: Catalog, cs: ChangesetRow, by: string): Promise<boolean> {
  if (cs.author === by) return true;
  const account = await catalog.account(by);
  if (account?.is_steward) return true;
  return (await catalog.mayApprove(cs.id, by)).ok;
}

/**
 * Asks people to review a suggestion, by handle; asking someone who
 * already reviewed it asks them again. Its author is never asked.
 */
export async function requestReview(catalog: Catalog, by: string, id: number, usernames: readonly string[]): Promise<string[]> {
  const cs = await catalog.changeset(id);
  if (cs.number === null) throw notFound(`suggestion ${id}`);
  if (cs.status !== 'open' && cs.status !== 'sent_back' && cs.post_review !== 'pending') throw badState(`this suggestion is ${cs.status}`);
  if (!(await mayManageReviewers(catalog, cs, by))) throw forbidden('reviewers are asked for by its author or by someone who may approve it');
  const names = usernames.slice(0, 20).map((u) => u.trim().replace(/^@/, ''));
  const ids = await idsOfUsernames(catalog.db, names);
  const missing = names.filter((u) => !ids.has(u.toLowerCase()));
  if (missing.length) throw invalid(`nobody here is called ${missing.map((m) => `@${m}`).join(', ')}`);
  const reviewers = [...ids.values()].filter((r) => r !== cs.author);
  return catalog.db.transaction((tx) => requestReviewers(tx, id, by, reviewers));
}

export async function removeReviewRequest(catalog: Catalog, by: string, id: number, username: string): Promise<void> {
  const cs = await catalog.changeset(id);
  const ids = await idsOfUsernames(catalog.db, [username.trim().replace(/^@/, '')]);
  const reviewer = [...ids.values()][0];
  if (!reviewer) throw notFound(`@${username}`);
  // A person may always step back from a request made of them.
  if (reviewer !== by && !(await mayManageReviewers(catalog, cs, by))) throw forbidden('reviewers are changed by its author or by someone who may approve it');
  await catalog.db.transaction(async (tx) => {
    const gone = await one(tx, 'DELETE FROM review_request WHERE changeset_id = $1 AND reviewer = $2 RETURNING reviewer', [id, reviewer]);
    if (gone) await threadEvent(tx, { kind: 'changeset', id }, by, 'review_request_removed', { reviewers: [reviewer] });
  });
}

/**
 * Changes a suggestion's title or description (its author, or a
 * steward). The description is read again: people newly named are told,
 * and its "Fixes #n" links follow what it says now.
 */
export async function editSuggestion(catalog: Catalog, by: string, id: number, input: { title?: unknown; description?: unknown }): Promise<ChangesetRow> {
  const cs = await catalog.changeset(id);
  if (cs.number === null) throw notFound(`suggestion ${id}`);
  const account = await catalog.account(by);
  if (cs.author !== by && !account?.is_steward) throw forbidden('a suggestion is edited by its author');
  const title = input.title === undefined ? cs.title : typeof input.title === 'string' ? input.title.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  if (!title) throw invalid('a suggestion needs a title');
  const description = input.description === undefined ? cs.description : cleanBody(input.description, false) || null;
  await catalog.db.transaction(async (tx) => {
    await tx.query('UPDATE changeset SET title = $2, description = $3 WHERE id = $1', [id, title, description]);
    if (title !== cs.title) await threadEvent(tx, { kind: 'changeset', id }, by, 'renamed', { from: cs.title, to: title });
    if (description !== cs.description) {
      if (cs.status !== 'merged') {
        // What it fixes is what the description says now (once merged, what it closed stays closed).
        const closes = new Set(referencesIn(description ?? '').filter((r) => r.closes).map((r) => r.number));
        await tx.query('DELETE FROM thread_link l USING report r WHERE l.changeset_id = $1 AND r.id = l.report_id AND NOT (r.number = ANY($2::bigint[]))', [id, [...closes]]);
      }
      await noteWriting(tx, { source: { kind: 'changeset', id }, author: by, text: description, subject: { kind: 'changeset', id: String(id) }, previous: cs.description });
    }
  });
  return catalog.changeset(id);
}

/** Marks a conversation on one field resolved (or not): its suggestion's author, the comment's author, or whoever may approve it. */
export async function resolveComment(catalog: Catalog, by: string, commentId: number, resolved: boolean): Promise<void> {
  const row = await one<{ author: string; target_kind: string; target_id: string; anchor: unknown; parent_id: string | null }>(catalog.db, 'SELECT author, target_kind, target_id, anchor, parent_id FROM comment WHERE id = $1', [commentId]);
  if (!row || row.target_kind !== 'changeset' || !row.anchor || row.parent_id !== null) throw notFound(`review comment ${commentId}`);
  const cs = await catalog.changeset(Number(row.target_id));
  if (row.author !== by && cs.author !== by && !(await mayManageReviewers(catalog, cs, by))) throw forbidden('resolved by the suggestion’s author, the comment’s writer, or a reviewer');
  await catalog.db.query(`UPDATE comment SET resolved_at = ${resolved ? 'now()' : 'NULL'}, resolved_by = ${resolved ? '$2' : 'NULL'} WHERE id = $1`, resolved ? [commentId, by] : [commentId]);
}

/** Changes the words of one's own comment; people newly named in them are told. */
export async function editComment(catalog: Catalog, by: string, commentId: number, body: unknown): Promise<void> {
  const text = cleanBody(body);
  const row = await one<{ author: string; target_kind: 'changeset' | 'report' | 'entity' | 'project'; target_id: string; body: string; hidden_at: unknown }>(
    catalog.db,
    'SELECT author, target_kind, target_id, body, hidden_at FROM comment WHERE id = $1',
    [commentId],
  );
  if (!row) throw notFound(`comment ${commentId}`);
  if (row.author !== by) throw forbidden('a comment is edited by its writer');
  if (row.hidden_at) throw badState('this comment is hidden');
  await catalog.db.transaction(async (tx) => {
    await tx.query('UPDATE comment SET body = $2, edited_at = now() WHERE id = $1', [commentId, text]);
    await noteWriting(tx, { source: { kind: 'comment', id: commentId }, author: by, text, subject: { kind: row.target_kind, id: row.target_id }, previous: row.body });
  });
}

export interface SuggestionListItem {
  id: number;
  number: number;
  title: string;
  status: ChangesetStatus;
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
  /** Sent by an agent for its author (via.ts). */
  via: Via | null;
}

/**
 * Suggestions as a list, newest first: open (waiting, or sent back for
 * changes) or closed (merged or withdrawn), by whom, asking whom, or with
 * words in their title. Imports and drafts are not conversations and are
 * left out.
 */
export async function listSuggestions(
  db: Db,
  options: { state?: 'open' | 'closed' | 'all'; author?: string; reviewer?: string; q?: string; limit?: number; before?: number } = {},
): Promise<{ items: SuggestionListItem[]; people: Record<string, PersonTag>; counts: { open: number; closed: number } }> {
  const params: unknown[] = [];
  const where = ["c.number IS NOT NULL", "c.status <> 'draft'"];
  const state = options.state ?? 'open';
  const filters: string[] = [];
  if (options.author) filters.push(`c.author = $${params.push(options.author)}`);
  if (options.reviewer) filters.push(`EXISTS (SELECT 1 FROM review_request q WHERE q.changeset_id = c.id AND q.reviewer = $${params.push(options.reviewer)})`);
  if (options.q?.trim()) {
    const q = options.q.trim();
    filters.push(/^#?\d+$/.test(q) ? `c.number = $${params.push(Number(q.replace('#', '')))}` : `c.title ILIKE $${params.push(`%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`)}`);
  }
  const base = [...where, ...filters].join(' AND ');
  const counts = await one<{ open: number; closed: number }>(
    db,
    `SELECT count(*) FILTER (WHERE c.status IN ('open', 'sent_back'))::int AS open, count(*) FILTER (WHERE c.status IN ('merged', 'withdrawn'))::int AS closed FROM changeset c WHERE ${base}`,
    params,
  );
  const stateSql = state === 'open' ? "c.status IN ('open', 'sent_back')" : state === 'closed' ? "c.status IN ('merged', 'withdrawn')" : 'TRUE';
  const beforeSql = options.before ? ` AND c.number < $${params.push(options.before)}` : '';
  const { rows } = await db.query<{
    id: string | number;
    number: string | number;
    title: string;
    status: ChangesetStatus;
    kind: string;
    author: string;
    created_at: Date | string;
    submitted_at: Date | string | null;
    closed_at: Date | string | null;
    comments: number;
    reviewers: string[];
    approvals: number;
    changes_requested: boolean;
    fixes: Array<string | number>;
    via: Via | null;
  }>(
    `SELECT c.id, c.number, c.title, c.status, c.kind, c.author, c.created_at, c.submitted_at, c.closed_at, c.via,
            (SELECT count(*)::int FROM comment m WHERE m.target_kind = 'changeset' AND m.target_id = c.id::text AND m.hidden_at IS NULL) AS comments,
            ARRAY(SELECT q.reviewer FROM review_request q WHERE q.changeset_id = c.id ORDER BY q.requested_at) AS reviewers,
            (SELECT count(*)::int FROM review v WHERE v.changeset_id = c.id AND v.verdict = 'approve') AS approvals,
            c.status = 'sent_back' AS changes_requested,
            ARRAY(SELECT r.number FROM thread_link l JOIN report r ON r.id = l.report_id WHERE l.changeset_id = c.id AND l.closes ORDER BY r.number) AS fixes
     FROM changeset c WHERE ${base} AND ${stateSql}${beforeSql}
     ORDER BY c.number DESC LIMIT ${Math.min(Math.max(options.limit ?? 30, 1), 100)}`,
    params,
  );
  const items = rows.map((r) => ({
    id: Number(r.id),
    number: Number(r.number),
    title: r.title,
    status: r.status,
    kind: r.kind,
    author: r.author,
    createdAt: iso(r.created_at),
    submittedAt: r.submitted_at ? iso(r.submitted_at) : null,
    closedAt: r.closed_at ? iso(r.closed_at) : null,
    comments: r.comments,
    reviewers: r.reviewers,
    approvals: r.approvals,
    changesRequested: r.changes_requested,
    fixes: r.fixes.map(Number),
    via: r.via ?? null,
  }));
  return { items, people: await peopleOf(db, items.flatMap((i) => [i.author, ...i.reviewers])), counts: counts ?? { open: 0, closed: 0 } };
}

/** Whether a person follows a thread (to show "Unsubscribe" or "Subscribe"). */
export async function isSubscribed(db: Db, personId: string | null, thread: { kind: 'changeset' | 'report'; id: number }): Promise<boolean> {
  if (!personId) return false;
  return (await followersOf(db, thread)).includes(personId);
}
