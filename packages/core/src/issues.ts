import { one, type Db } from '@rebbehub/db';
import type { EntityId } from '@rebbehub/model';
import { PRIVATE_REASONS, type Catalog, type ReportReason } from './catalog.js';
import { byTime, peopleOf, threadItems, type PersonTag, type TimelineItem } from './conversation.js';
import { badState, forbidden, invalid, notFound } from './errors.js';
import { canSuggest } from './permissions.js';
import { keepersOfSet, noteWriting, notify, reportStateChanged, subscribe, threadEvent } from './threads.js';
import { idsOfUsernames } from './usernames.js';
import type { Via } from './via.js';

/**
 * A Report kept as an issue (the plan, section 7: "Report a problem"
 * grows into a conversation): a title, what is wrong in the reporter's
 * words, open or closed (done, or not planned), labels, the people who
 * took it on, comments, and the suggestions that say they fix it.
 *
 * Reports are read by everyone, except the private ones: rights claims
 * and reports of something offensive, and every report sent before
 * reports were public. A private report is read by stewards, its set's
 * keepers, whoever sent it and whoever took it on. An anonymous reader's
 * report shows no sender at all.
 */

/** The kinds of report, each with the words its form starts with (the "template"), in both languages. */
export const ISSUE_TYPES: ReadonlyArray<{ type: ReportReason; label: { he: string; en: string }; template: { he: string; en: string }; private: boolean }> = [
  { type: 'wrong-fact', label: { he: 'פרט שגוי', en: 'Wrong detail' }, template: { he: 'מה כתוב:\n\nמה צריך להיות:\n\nמקור:', en: 'What it says:\n\nWhat it should say:\n\nSource:' }, private: false },
  { type: 'wrong-text', label: { he: 'טעות בטקסט', en: 'Wrong text' }, template: { he: 'איפה (עמוד, שורה או פסקה):\n\nמה כתוב:\n\nמה צריך להיות:', en: 'Where (page, line or paragraph):\n\nWhat it says:\n\nWhat it should say:' }, private: false },
  { type: 'missing-page', label: { he: 'עמוד חסר', en: 'Missing page' }, template: { he: 'אילו עמודים חסרים:\n\nאיפה אפשר למצוא אותם:', en: 'Which pages are missing:\n\nWhere they can be found:' }, private: false },
  { type: 'bad-scan', label: { he: 'סריקה פגומה', en: 'Bad scan' }, template: { he: 'אילו עמודים:\n\nמה לא בסדר (מטושטש, חתוך, הפוך):', en: 'Which pages:\n\nWhat is wrong (blurred, cut off, upside down):' }, private: false },
  { type: 'audio-problem', label: { he: 'בעיה בהקלטה', en: 'Recording problem' }, template: { he: 'באיזו דקה:\n\nמה שומעים (או לא שומעים):', en: 'At which minute:\n\nWhat is heard (or not heard):' }, private: false },
  { type: 'duplicate', label: { he: 'כפילות', en: 'Duplicate' }, template: { he: 'אותו דבר כמו (קישור או rh-…):', en: 'The same as (a link or rh-…):' }, private: false },
  { type: 'other', label: { he: 'אחר', en: 'Something else' }, template: { he: '', en: '' }, private: false },
  { type: 'rights', label: { he: 'זכויות יוצרים', en: 'Rights' }, template: { he: 'מי מחזיק בזכויות, ומה מבוקש:', en: 'Who holds the rights, and what is asked:' }, private: true },
  { type: 'offensive', label: { he: 'תוכן פוגע', en: 'Offensive' }, template: { he: 'מה פוגע, ואיפה:', en: 'What is offensive, and where:' }, private: true },
];

const TYPE_TITLES = Object.fromEntries(ISSUE_TYPES.map((t) => [t.type, t.label])) as Record<ReportReason, { he: string; en: string }>;

export interface IssueLabel {
  name: string;
  description: string | null;
  color: string;
}

export interface Issue {
  id: number;
  number: number;
  /** Its own title; a report sent before titles (or from the one-line form) shows its kind instead (`typeTitle`). */
  title: string | null;
  typeTitle: { he: string; en: string };
  type: ReportReason;
  state: 'open' | 'closed';
  /** Closed as done (`completed`) or as not to be done (`not_planned`). */
  stateReason: 'completed' | 'not_planned' | null;
  body: string | null;
  private: boolean;
  /** Who sent it; null for a reader without an account. */
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
  /** The suggestion that closed it, by number. */
  closedBySuggestion: number | null;
  /** Sent by an agent for its author (via.ts). */
  via: Via | null;
}

/** What the person asking may do with an issue. */
export interface IssueRights {
  read: boolean;
  comment: boolean;
  /** Change its title and words. */
  edit: boolean;
  close: boolean;
  /** Labels, and assigning others. */
  triage: boolean;
  /** Make it private or public. */
  moderate: boolean;
}

interface ReportRow {
  id: string | number;
  number: string | number;
  title: string | null;
  reason: ReportReason;
  status: 'open' | 'resolved' | 'dismissed';
  note: string | null;
  private: boolean;
  reporter: string | null;
  entity_id: string | null;
  set_id: string | null;
  created_at: Date | string;
  updated_at: Date | string | null;
  closed_at: Date | string | null;
  resolved_by: string | null;
  resolution_number: string | number | null;
  entity_type: string | null;
  entity_path: string | null;
  entity_name: unknown;
  labels: IssueLabel[] | null;
  assignees: string[] | null;
  comments: number;
  via: Via | null;
}

const ISSUE_SELECT = `
  SELECT r.id, r.number, r.title, r.reason, r.status, r.note, r.private, r.reporter, r.entity_id, r.set_id, r.created_at, r.updated_at, r.closed_at, r.resolved_by, r.via,
         (SELECT c.number FROM changeset c WHERE c.id = r.resolution_changeset) AS resolution_number,
         e.type AS entity_type, e.path AS entity_path,
         coalesce(v.data->'title', v.data->'name', v.data->'label') AS entity_name,
         (SELECT coalesce(jsonb_agg(jsonb_build_object('name', l.name, 'description', l.description, 'color', l.color) ORDER BY l.name), '[]'::jsonb)
            FROM report_label rl JOIN label l ON l.name = rl.label WHERE rl.report_id = r.id) AS labels,
         ARRAY(SELECT a.account_id FROM report_assignee a WHERE a.report_id = r.id ORDER BY a.assigned_at) AS assignees,
         (SELECT count(*)::int FROM comment m WHERE m.target_kind = 'report' AND m.target_id = r.id::text AND m.hidden_at IS NULL) AS comments
  FROM report r LEFT JOIN entity e ON e.id = r.entity_id LEFT JOIN revision v ON v.id = e.main_rev`;

const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString());

function issueOf(r: ReportRow): Issue {
  return {
    id: Number(r.id),
    number: Number(r.number),
    title: r.title,
    typeTitle: TYPE_TITLES[r.reason] ?? TYPE_TITLES.other,
    type: r.reason,
    state: r.status === 'open' ? 'open' : 'closed',
    stateReason: r.status === 'resolved' ? 'completed' : r.status === 'dismissed' ? 'not_planned' : null,
    body: r.note,
    private: r.private,
    author: r.reporter,
    entity: r.entity_id ? { id: r.entity_id, type: r.entity_type ?? 'item', path: r.entity_path, name: r.entity_name ?? null } : null,
    set: r.set_id,
    labels: r.labels ?? [],
    assignees: r.assignees ?? [],
    comments: r.comments,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at),
    closedAt: iso(r.closed_at),
    closedBy: r.status === 'open' ? null : r.resolved_by,
    closedBySuggestion: r.resolution_number === null ? null : Number(r.resolution_number),
    via: r.via ?? null,
  };
}

async function issueRow(db: Db, number: number): Promise<ReportRow | null> {
  if (!Number.isSafeInteger(number)) return null;
  return one<ReportRow>(db, `${ISSUE_SELECT} WHERE r.number = $1`, [number]);
}

/** Who the person asking is to this issue. */
export async function issueRights(db: Db, issue: Pick<Issue, 'id' | 'private' | 'author' | 'set' | 'assignees'>, viewer: string | null): Promise<IssueRights> {
  const none = { read: !issue.private, comment: false, edit: false, close: false, triage: false, moderate: false };
  if (!viewer) return none;
  const account = await one<{ is_steward: boolean; trust: string; suspended_at: string | null; is_bot: boolean }>(db, 'SELECT is_steward, trust, suspended_at, is_bot FROM account WHERE id = $1', [viewer]);
  if (!account || account.suspended_at !== null || account.is_bot) return { ...none, read: none.read || issue.author === viewer };
  const keeper = account.is_steward || (await keepersOfSet(db, issue.set)).includes(viewer);
  const author = issue.author === viewer;
  const assigned = issue.assignees.includes(viewer);
  const read = !issue.private || keeper || author || assigned;
  return { read, comment: read, edit: author || keeper, close: author || keeper || assigned, triage: keeper || (read && account.trust === 'trusted'), moderate: keeper };
}

async function readable(catalog: Catalog, number: number, viewer: string | null): Promise<{ issue: Issue; rights: IssueRights }> {
  const row = await issueRow(catalog.db, number);
  if (!row) throw notFound(`#${number}`);
  const issue = issueOf(row);
  const rights = await issueRights(catalog.db, issue, viewer);
  // A private report is not there at all for those who may not read it.
  if (!rights.read) throw notFound(`#${number}`);
  return { issue, rights };
}

/**
 * An issue with its conversation, oldest first. Reports closed before
 * conversations were kept have no event for it; the audit log (or the
 * report itself) says who closed it and when.
 */
export async function getIssue(catalog: Catalog, number: number, viewer: string | null): Promise<{
  issue: Issue;
  rights: IssueRights;
  timeline: TimelineItem[];
  people: Record<string, PersonTag>;
  fixedBy: Array<{ number: number; title: string; status: string }>;
  subscribed: boolean;
}> {
  const { issue, rights } = await readable(catalog, number, viewer);
  const items = await threadItems(catalog.db, 'report', issue.id);
  items.push({ type: 'event', id: 'opened', at: issue.createdAt, actor: issue.author, kind: 'opened', detail: {} });
  if (issue.state === 'closed' && !items.some((i) => i.type === 'event' && i.kind === 'closed')) {
    const { rows } = await catalog.db.query<{ at: Date | string; actor: string; action: string; detail: { note?: string } }>(
      "SELECT at, actor, action, detail FROM audit_log WHERE target_kind = 'report' AND target_id = $1 AND action IN ('report.resolved', 'report.dismissed') ORDER BY id",
      [String(issue.id)],
    );
    if (rows.length) {
      rows.forEach((a, i) =>
        items.push({ type: 'event', id: `legacy${i}`, at: iso(a.at)!, actor: a.actor, kind: 'closed', detail: { outcome: a.action === 'report.resolved' ? 'resolved' : 'dismissed', ...(a.detail?.note ? { note: a.detail.note } : {}) } }),
      );
    } else if (issue.closedAt) {
      items.push({ type: 'event', id: 'legacy', at: issue.closedAt, actor: issue.closedBy, kind: 'closed', detail: { outcome: issue.stateReason === 'completed' ? 'resolved' : 'dismissed' } });
    }
  }
  items.sort(byTime);
  const { rows: fixedBy } = await catalog.db.query<{ number: string | number; title: string; status: string }>(
    'SELECT c.number, c.title, c.status FROM thread_link l JOIN changeset c ON c.id = l.changeset_id WHERE l.report_id = $1 AND l.closes ORDER BY c.number',
    [issue.id],
  );
  const people = await peopleOf(catalog.db, [
    issue.author,
    issue.closedBy,
    ...issue.assignees,
    ...items.map((i) => (i.type === 'event' ? i.actor : i.author)),
    ...items.flatMap((i) => (i.type === 'event' && Array.isArray(i.detail.assignees) ? (i.detail.assignees as string[]) : [])),
  ]);
  const subscribed = viewer ? Boolean(await one(catalog.db, "SELECT 1 FROM follow WHERE account_id = $1 AND target_kind = 'report' AND target_id = $2", [viewer, String(issue.id)])) : false;
  return { issue, rights, timeline: items, people, fixedBy: fixedBy.map((f) => ({ number: Number(f.number), title: f.title, status: f.status })), subscribed };
}

export interface IssueFilters {
  state?: 'open' | 'closed' | 'all';
  /** A label's name; several are all required. */
  labels?: readonly string[];
  type?: ReportReason;
  set?: string;
  entity?: string;
  /** An account id, or `none` for issues nobody took on. */
  assignee?: string;
  author?: string;
  /** Words in the title or text, or `#12`. */
  q?: string;
  limit?: number;
  /** Issues numbered below this (the next page). */
  before?: number;
}

/**
 * Issues as a list, newest first, with how many are open and closed for
 * the same filters. Private ones are listed only for those who may read
 * them: stewards, the keepers of their set, whoever sent or took them on.
 */
export async function listIssues(catalog: Catalog, filters: IssueFilters, viewer: string | null): Promise<{ items: Issue[]; people: Record<string, PersonTag>; counts: { open: number; closed: number } }> {
  const db = catalog.db;
  const params: unknown[] = [];
  const where: string[] = [];
  const account = viewer ? await catalog.account(viewer) : null;
  if (!account?.is_steward) {
    // The sets this person keeps, found once: a private report of one of them is theirs to read.
    const kept = viewer
      ? (
          await db.query<{ id: string }>(
            "SELECT e.id FROM entity e JOIN revision v ON v.id = e.main_rev WHERE e.type = 'set' AND NOT e.deleted AND v.data->'keepers' ? $1",
            [viewer],
          )
        ).rows.map((r) => r.id)
      : [];
    const me = `$${params.push(viewer ?? '')}`;
    where.push(
      `(NOT r.private OR r.reporter = ${me} OR r.set_id = ANY($${params.push(kept)}::text[]) OR EXISTS (SELECT 1 FROM report_assignee x WHERE x.report_id = r.id AND x.account_id = ${me}))`,
    );
  }
  for (const label of filters.labels ?? []) where.push(`EXISTS (SELECT 1 FROM report_label x WHERE x.report_id = r.id AND x.label = $${params.push(label)})`);
  if (filters.type) where.push(`r.reason = $${params.push(filters.type)}`);
  if (filters.set) where.push(`r.set_id = $${params.push(filters.set)}`);
  if (filters.entity) where.push(`r.entity_id = $${params.push(filters.entity)}`);
  if (filters.author) where.push(`r.reporter = $${params.push(filters.author)}`);
  if (filters.assignee === 'none') where.push('NOT EXISTS (SELECT 1 FROM report_assignee x WHERE x.report_id = r.id)');
  else if (filters.assignee) where.push(`EXISTS (SELECT 1 FROM report_assignee x WHERE x.report_id = r.id AND x.account_id = $${params.push(filters.assignee)})`);
  const q = filters.q?.trim();
  if (q) {
    if (/^#?\d+$/.test(q)) where.push(`r.number = $${params.push(Number(q.replace('#', '')))}`);
    else {
      const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      where.push(`(r.title ILIKE $${params.push(like)} OR r.note ILIKE $${params.length})`);
    }
  }
  const base = where.length ? where.join(' AND ') : 'TRUE';
  const counts = await one<{ open: number; closed: number }>(db, `SELECT count(*) FILTER (WHERE r.status = 'open')::int AS open, count(*) FILTER (WHERE r.status <> 'open')::int AS closed FROM report r WHERE ${base}`, params);
  const state = filters.state ?? 'open';
  const stateSql = state === 'open' ? "r.status = 'open'" : state === 'closed' ? "r.status <> 'open'" : 'TRUE';
  const before = filters.before ? ` AND r.number < $${params.push(filters.before)}` : '';
  const { rows } = await db.query<ReportRow>(`${ISSUE_SELECT} WHERE ${base} AND ${stateSql}${before} ORDER BY r.number DESC LIMIT ${Math.min(Math.max(filters.limit ?? 30, 1), 100)}`, params);
  const items = rows.map(issueOf);
  return { items, people: await peopleOf(db, items.flatMap((i) => [i.author, ...i.assignees])), counts: counts ?? { open: 0, closed: 0 } };
}

const cleanTitle = (title: unknown): string => {
  const text = typeof title === 'string' ? title.replace(/\s+/g, ' ').trim() : '';
  if (!text) throw invalid('an issue needs a title');
  if (text.length > 200) throw invalid('a title is at most 200 characters');
  return text;
};

const cleanBody = (body: unknown): string | null => {
  const text = typeof body === 'string' ? body.trim() : '';
  if (text.length > 10_000) throw invalid('at most 10,000 characters');
  return text || null;
};

/**
 * A signed-in person opens an issue: a title, what is wrong, of which
 * kind, about which item (or none), with any labels they may add. It is
 * a Report like any other (Catalog.report), so it lands in its set's
 * inbox and its keepers are told.
 */
export async function openIssue(
  catalog: Catalog,
  by: string,
  input: { title: unknown; body?: unknown; type?: unknown; entityId?: string | null; labels?: readonly string[]; private?: boolean },
): Promise<Issue> {
  const account = await catalog.account(by);
  if (!canSuggest(account)) throw forbidden('this account cannot open issues');
  const type = (input.type ?? 'other') as ReportReason;
  if (!ISSUE_TYPES.some((t) => t.type === type)) throw invalid(`the kind is one of ${ISSUE_TYPES.map((t) => t.type).join(', ')}`);
  const id = await catalog.report({ entityId: (input.entityId as EntityId) ?? undefined, reason: type, note: cleanBody(input.body) ?? undefined, reporter: by, title: cleanTitle(input.title), private: input.private === true });
  const row = (await one<{ number: string | number }>(catalog.db, 'SELECT number FROM report WHERE id = $1', [id]))!;
  const number = Number(row.number);
  if (input.labels?.length) {
    const { issue, rights } = await readable(catalog, number, by);
    if (rights.triage) await setIssueLabels(catalog, by, issue.number, input.labels);
  }
  return (await readable(catalog, number, by)).issue;
}

/** Changes an issue's title or words (who sent it, or a keeper); people newly named are told. */
export async function editIssue(catalog: Catalog, by: string, number: number, input: { title?: unknown; body?: unknown }): Promise<Issue> {
  const { issue, rights } = await readable(catalog, number, by);
  if (!rights.edit) throw forbidden('an issue is edited by whoever sent it, or its set’s keepers');
  const title = input.title === undefined ? issue.title : cleanTitle(input.title);
  const body = input.body === undefined ? issue.body : cleanBody(input.body);
  await catalog.db.transaction(async (tx) => {
    await tx.query('UPDATE report SET title = $2, note = $3, updated_at = now() WHERE id = $1', [issue.id, title, body]);
    if (title !== issue.title) await threadEvent(tx, { kind: 'report', id: issue.id }, by, 'renamed', { from: issue.title ?? issue.typeTitle.en, to: title });
    if (body !== issue.body) await noteWriting(tx, { source: { kind: 'report', id: issue.id }, author: by, text: body, subject: { kind: 'report', id: String(issue.id) }, previous: issue.body });
  });
  return (await readable(catalog, number, by)).issue;
}

/** Closes an issue, as done or as not planned, or opens it again: who sent it, whoever took it on, or a keeper. */
export async function setIssueState(catalog: Catalog, by: string, number: number, state: 'open' | 'completed' | 'not_planned', note?: string): Promise<Issue> {
  const { issue, rights } = await readable(catalog, number, by);
  if (!rights.close) throw forbidden('an issue is closed by whoever sent it, whoever took it on, or its set’s keepers');
  if (state === 'open' && issue.state === 'open') throw badState('this issue is open');
  if (state !== 'open' && issue.state === 'closed' && issue.stateReason === state) throw badState('this issue is closed');
  const status = state === 'open' ? 'open' : state === 'completed' ? 'resolved' : 'dismissed';
  await catalog.db.transaction(async (tx) => {
    await tx.query(
      state === 'open'
        ? "UPDATE report SET status = 'open', resolved_by = NULL, resolution_changeset = NULL, closed_at = NULL, updated_at = now() WHERE id = $1"
        : 'UPDATE report SET status = $2, resolved_by = $3, closed_at = now(), updated_at = now() WHERE id = $1',
      state === 'open' ? [issue.id] : [issue.id, status, by],
    );
    await tx.query('INSERT INTO audit_log (actor, action, target_kind, target_id, detail) VALUES ($1, $2, $3, $4, $5)', [by, `report.${status === 'open' ? 'reopen' : status}`, 'report', String(issue.id), JSON.stringify({ note })]);
    await reportStateChanged(tx, { id: issue.id, by, outcome: status, note });
  });
  return (await readable(catalog, number, by)).issue;
}

/** Sets an issue's labels to exactly these (keepers, stewards and Trusted people); each one added or taken off is in its timeline. */
export async function setIssueLabels(catalog: Catalog, by: string, number: number, labels: readonly string[]): Promise<Issue> {
  const { issue, rights } = await readable(catalog, number, by);
  if (!rights.triage) throw forbidden('labels are set by the set’s keepers and Trusted people');
  const wanted = [...new Set(labels.map((l) => l.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
  const { rows } = await catalog.db.query<{ name: string }>('SELECT name FROM label WHERE name = ANY($1::text[])', [wanted]);
  const unknown = wanted.filter((w) => !rows.some((r) => r.name === w));
  if (unknown.length) throw invalid(`no label ${unknown.map((u) => `"${u}"`).join(', ')}`);
  const had = issue.labels.map((l) => l.name);
  const added = wanted.filter((w) => !had.includes(w));
  const removed = had.filter((h) => !wanted.includes(h));
  if (added.length === 0 && removed.length === 0) return issue;
  await catalog.db.transaction(async (tx) => {
    for (const label of added) await tx.query('INSERT INTO report_label (report_id, label, added_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [issue.id, label, by]);
    if (removed.length) await tx.query('DELETE FROM report_label WHERE report_id = $1 AND label = ANY($2::text[])', [issue.id, removed]);
    if (added.length) await threadEvent(tx, { kind: 'report', id: issue.id }, by, 'labeled', { labels: added });
    if (removed.length) await threadEvent(tx, { kind: 'report', id: issue.id }, by, 'unlabeled', { labels: removed });
    await tx.query('UPDATE report SET updated_at = now() WHERE id = $1', [issue.id]);
  });
  return (await readable(catalog, number, by)).issue;
}

/**
 * Sets who took an issue on, by handle (at most ten). Anyone who may
 * comment takes it on themselves or lets go; keepers, stewards and
 * Trusted people assign others, who are told and follow it.
 */
export async function setIssueAssignees(catalog: Catalog, by: string, number: number, usernames: readonly string[]): Promise<Issue> {
  const { issue, rights } = await readable(catalog, number, by);
  if (!rights.comment) throw forbidden('sign in to take this on');
  const names = [...new Set(usernames.map((u) => u.trim().replace(/^@/, '')).filter(Boolean))].slice(0, 10);
  const ids = await idsOfUsernames(catalog.db, names);
  const missing = names.filter((n) => !ids.has(n.toLowerCase()));
  if (missing.length) throw invalid(`nobody here is called ${missing.map((m) => `@${m}`).join(', ')}`);
  const wanted = [...new Set(ids.values())];
  const added = wanted.filter((w) => !issue.assignees.includes(w));
  const removed = issue.assignees.filter((a) => !wanted.includes(a));
  if (!rights.triage && [...added, ...removed].some((p) => p !== by)) throw forbidden('you may take this on yourself; others are assigned by the set’s keepers and Trusted people');
  const { rows: accounts } = await catalog.db.query<{ id: string }>('SELECT id FROM account WHERE id = ANY($1::text[]) AND NOT is_bot AND suspended_at IS NULL', [added]);
  const missingAccounts = added.filter((a) => !accounts.some((r) => r.id === a));
  if (missingAccounts.length) throw invalid('someone named has not signed in here yet, so cannot be assigned');
  if (added.length === 0 && removed.length === 0) return issue;
  await catalog.db.transaction(async (tx) => {
    for (const person of added) {
      await tx.query('INSERT INTO report_assignee (report_id, account_id, assigned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [issue.id, person, by]);
      await subscribe(tx, person, { kind: 'report', id: issue.id });
    }
    if (removed.length) await tx.query('DELETE FROM report_assignee WHERE report_id = $1 AND account_id = ANY($2::text[])', [issue.id, removed]);
    if (added.length) await threadEvent(tx, { kind: 'report', id: issue.id }, by, 'assigned', { assignees: added });
    if (removed.length) await threadEvent(tx, { kind: 'report', id: issue.id }, by, 'unassigned', { assignees: removed });
    await tx.query('UPDATE report SET updated_at = now() WHERE id = $1', [issue.id]);
    await notify(tx, added, { reason: 'assigned', subject: { kind: 'report', id: String(issue.id) }, actor: by });
  });
  return (await readable(catalog, number, by)).issue;
}

/** Makes an issue private or public (keepers and stewards). A rights claim or an offensive report stays private. */
export async function setIssuePrivate(catalog: Catalog, by: string, number: number, makePrivate: boolean): Promise<Issue> {
  const { issue, rights } = await readable(catalog, number, by);
  if (!rights.moderate) throw forbidden('an issue is made private or public by its set’s keepers');
  if (!makePrivate && PRIVATE_REASONS.has(issue.type)) throw badState('reports of this kind are always private');
  if (issue.private === makePrivate) return issue;
  await catalog.db.transaction(async (tx) => {
    await tx.query('UPDATE report SET private = $2, updated_at = now() WHERE id = $1', [issue.id, makePrivate]);
    await threadEvent(tx, { kind: 'report', id: issue.id }, by, makePrivate ? 'made_private' : 'made_public');
  });
  return (await readable(catalog, number, by)).issue;
}

/** A comment on an issue, or an answer to one of its comments. */
export async function commentOnIssue(catalog: Catalog, by: string, number: number, input: { body: unknown; parent?: number }): Promise<number> {
  const { issue, rights } = await readable(catalog, number, by);
  if (!rights.comment) throw forbidden('sign in to comment');
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (!body || body.length > 10_000) throw invalid('a comment of 1 to 10,000 characters');
  if (input.parent !== undefined && !(await one(catalog.db, "SELECT 1 FROM comment WHERE id = $1 AND target_kind = 'report' AND target_id = $2", [input.parent, String(issue.id)]))) {
    throw invalid('that comment is not in this conversation');
  }
  const id = await catalog.comment(by, { kind: 'report', id: String(issue.id) }, body, input.parent);
  await catalog.db.query('UPDATE report SET updated_at = now() WHERE id = $1', [issue.id]);
  return id;
}

export async function listLabels(db: Db): Promise<Array<IssueLabel & { open: number }>> {
  const { rows } = await db.query<IssueLabel & { open: number }>(
    `SELECT l.name, l.description, l.color, (SELECT count(*)::int FROM report_label x JOIN report r ON r.id = x.report_id WHERE x.label = l.name AND r.status = 'open' AND NOT r.private) AS open
     FROM label l ORDER BY l.name`,
  );
  return rows;
}

/** A new label (stewards): a short lower-case name, what it means, and its colour. */
export async function createLabel(catalog: Catalog, by: string, input: { name?: unknown; description?: unknown; color?: unknown }): Promise<IssueLabel> {
  const account = await catalog.account(by);
  if (!account?.is_steward) throw forbidden('labels are made by stewards');
  const name = typeof input.name === 'string' ? input.name.trim().toLowerCase().replace(/\s+/g, ' ') : '';
  if (!/^[a-z0-9][a-z0-9 -]{0,38}[a-z0-9]$/.test(name)) throw invalid('a label is 2 to 40 lower-case Latin letters, digits, spaces and hyphens');
  const color = typeof input.color === 'string' && /^#?[0-9a-f]{6}$/i.test(input.color) ? input.color.replace('#', '').toLowerCase() : '6b6557';
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 200) || null : null;
  const row = await one<IssueLabel>(catalog.db, 'INSERT INTO label (name, description, color, created_by) VALUES ($1, $2, $3, $4) ON CONFLICT (name) DO NOTHING RETURNING name, description, color', [name, description, color, by]);
  if (!row) throw badState(`there is already a label "${name}"`);
  return row;
}

/**
 * Suggestions and issues by number or words in their title, for the list
 * under a comment box after `#`: open ones first, then the newest.
 * Private issues show only to those who may read them.
 */
export async function searchThreads(catalog: Catalog, q: string, viewer: string | null, limit = 8): Promise<Array<{ kind: 'changeset' | 'report'; number: number; title: string; state: 'open' | 'closed' | 'merged' }>> {
  const text = q.trim().replace(/^#/, '');
  const byNumber = /^\d+$/.test(text);
  // Numbers match from their start (#1 finds 1, 12, 123); words anywhere in the title.
  const pattern = byNumber ? `${text}%` : `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const changesetMatch = byNumber ? 'c.number::text LIKE $1' : 'c.title ILIKE $1';
  const reportMatch = byNumber ? 'r.number::text LIKE $1' : '(r.title ILIKE $1 OR r.note ILIKE $1)';
  const { rows } = await catalog.db.query<{ kind: 'changeset' | 'report'; number: string | number; title: string | null; reason: string; status: string; private: boolean; id: string | number; reporter: string | null; set_id: string | null }>(
    `SELECT * FROM (
       SELECT 'changeset' AS kind, c.number, c.title, NULL AS reason, c.status, FALSE AS private, c.id, NULL AS reporter, NULL AS set_id FROM changeset c
       WHERE c.number IS NOT NULL AND c.status <> 'draft' AND ${changesetMatch}
       UNION ALL
       SELECT 'report', r.number, r.title, r.reason, r.status, r.private, r.id, r.reporter, r.set_id FROM report r WHERE ${reportMatch}
     ) t ORDER BY (t.status IN ('open', 'sent_back')) DESC, t.number DESC LIMIT 40`,
    [pattern],
  );
  const out: Array<{ kind: 'changeset' | 'report'; number: number; title: string; state: 'open' | 'closed' | 'merged' }> = [];
  for (const r of rows) {
    if (out.length >= Math.min(limit, 20)) break;
    if (r.private && !(await issueRights(catalog.db, { id: Number(r.id), private: true, author: r.reporter, set: r.set_id, assignees: [] }, viewer)).read) continue;
    const state = r.status === 'merged' ? 'merged' : r.status === 'open' || r.status === 'sent_back' ? 'open' : 'closed';
    out.push({ kind: r.kind, number: Number(r.number), title: r.title ?? (TYPE_TITLES[r.reason as ReportReason] ?? TYPE_TITLES.other).en, state });
  }
  return out;
}
