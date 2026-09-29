import { one, type Db } from '@rebbehub/db';
import { mentionsIn, referencesIn } from '@rebbehub/model';
import { idsOfUsernames } from './usernames.js';

/**
 * The conversations around the catalog (migration 0016): a Suggestion
 * talked over like a pull request, a Report kept like an issue, and the
 * people in each told of what concerns them.
 *
 *   #12             every Suggestion (but an import) and every Report has a number,
 *                   from one sequence, so `#12` names exactly one of them
 *   @mendy          names a person; they are told, and follow the conversation from then on
 *   Fixes #12       in a suggestion: approving it closes Report 12
 *   events          what happens besides comments and reviews (sent for review, approved,
 *                   closed, labelled, assigned, mentioned elsewhere), in order, for the timeline
 *   the inbox       auth.notification: one line per conversation and reason, counted while unread
 *
 * The catalog calls the hooks at the end of this file from its own
 * writes (a suggestion made, sent, approved; a report sent, closed; a
 * comment), inside the same transaction, so whichever way something is
 * written - the site, the API, a job - the conversation hears of it.
 */

export type ThreadKind = 'changeset' | 'report';
export interface ThreadRef {
  kind: ThreadKind;
  id: number;
}

/** What a notification or a mention is about: a thread, or an item's or project's talk page. */
export type SubjectKind = ThreadKind | 'entity' | 'project';
export interface Subject {
  kind: SubjectKind;
  id: string;
}

export type NotificationReason = 'mention' | 'review_requested' | 'assigned' | 'author' | 'comment' | 'review' | 'state' | 'followed';

export type ThreadEventKind =
  | 'submitted'
  | 'sent_back'
  | 'merged'
  | 'withdrawn'
  | 'reverted'
  | 'closed'
  | 'reopened'
  | 'renamed'
  | 'edited'
  | 'labeled'
  | 'unlabeled'
  | 'assigned'
  | 'unassigned'
  | 'review_requested'
  | 'review_request_removed'
  | 'referenced'
  | 'linked'
  | 'made_private'
  | 'made_public';

/** The account that asks keepers to review on its own (as CODEOWNERS does), and that closes reports a suggestion fixed. */
export const SYSTEM_ACCOUNT = 'system';

const subjectOf = (thread: ThreadRef): Subject => ({ kind: thread.kind, id: String(thread.id) });
const threadOf = (subject: Subject): ThreadRef | null =>
  (subject.kind === 'changeset' || subject.kind === 'report') && /^\d+$/.test(subject.id) ? { kind: subject.kind, id: Number(subject.id) } : null;

export async function threadEvent(db: Db, thread: ThreadRef, actor: string, kind: ThreadEventKind, detail: Record<string, unknown> = {}): Promise<void> {
  await db.query('INSERT INTO thread_event (thread_kind, thread_id, actor, kind, detail) VALUES ($1, $2, $3, $4, $5)', [thread.kind, thread.id, actor, kind, JSON.stringify(detail)]);
}

/** A thread by its number (`#12`): which kind it is, its id, and whether only some may read it. */
export async function threadByNumber(db: Db, number: number): Promise<(ThreadRef & { number: number; private: boolean }) | null> {
  if (!Number.isSafeInteger(number) || number < 1) return null;
  const row = await one<{ kind: ThreadKind; id: string | number; private: boolean }>(
    db,
    `SELECT 'changeset' AS kind, id, FALSE AS private FROM changeset WHERE number = $1
     UNION ALL SELECT 'report', id, private FROM report WHERE number = $1 LIMIT 1`,
    [number],
  );
  return row ? { kind: row.kind, id: Number(row.id), number, private: row.private } : null;
}

/** A thread's number and whether it is private (only reports are). */
export async function threadInfo(db: Db, thread: ThreadRef): Promise<{ number: number | null; private: boolean; author: string | null } | null> {
  const row =
    thread.kind === 'changeset'
      ? await one<{ number: string | number | null; private: boolean; author: string | null }>(db, 'SELECT number, FALSE AS private, author FROM changeset WHERE id = $1', [thread.id])
      : await one<{ number: string | number | null; private: boolean; author: string | null }>(db, 'SELECT number, private, reporter AS author FROM report WHERE id = $1', [thread.id]);
  return row ? { number: row.number === null ? null : Number(row.number), private: row.private, author: row.author } : null;
}

/** The keepers of a set, as main has them. */
export async function keepersOfSet(db: Db, setId: string | null): Promise<string[]> {
  if (!setId) return [];
  const row = await one<{ keepers: string[] | null }>(
    db,
    "SELECT ARRAY(SELECT jsonb_array_elements_text(coalesce(r.data->'keepers', '[]'::jsonb))) AS keepers FROM entity e JOIN revision r ON r.id = e.main_rev WHERE e.id = $1",
    [setId],
  );
  return row?.keepers ?? [];
}

/**
 * Whether a person may read what a subject says. Suggestions, items'
 * talk pages and projects are open to all; a private Report (a takedown,
 * something offensive, and every report sent before reports were public)
 * is read by stewards, its set's keepers, whoever sent it and whoever took
 * it on.
 */
export async function mayRead(db: Db, subject: Subject, personId: string | null): Promise<boolean> {
  if (subject.kind !== 'report') return true;
  const report = await one<{ private: boolean; reporter: string | null; set_id: string | null }>(db, 'SELECT private, reporter, set_id FROM report WHERE id = $1', [Number(subject.id)]);
  if (!report) return false;
  if (!report.private) return true;
  if (!personId) return false;
  if (report.reporter === personId) return true;
  const who = await one<{ steward: boolean; assigned: boolean }>(
    db,
    `SELECT coalesce((SELECT is_steward FROM account WHERE id = $1), FALSE)
              OR coalesce((SELECT steward OR admin FROM auth.person WHERE id = $1), FALSE) AS steward,
            EXISTS (SELECT 1 FROM report_assignee WHERE report_id = $2 AND account_id = $1) AS assigned`,
    [personId, Number(subject.id)],
  );
  if (who?.steward || who?.assigned) return true;
  return (await keepersOfSet(db, report.set_id)).includes(personId);
}

// ---------------------------------------------------------------- following

/** Follows a thread (people follow what they write, review, are asked about or are named in). Bots and unknown accounts follow nothing. */
export async function subscribe(db: Db, accountId: string, thread: ThreadRef): Promise<void> {
  await db.query(
    `INSERT INTO follow (account_id, target_kind, target_id) SELECT $1, $2, $3
     WHERE EXISTS (SELECT 1 FROM account WHERE id = $1 AND NOT is_bot) ON CONFLICT DO NOTHING`,
    [accountId, thread.kind, String(thread.id)],
  );
}

export async function followersOf(db: Db, thread: ThreadRef): Promise<string[]> {
  const { rows } = await db.query<{ account_id: string }>('SELECT account_id FROM follow WHERE target_kind = $1 AND target_id = $2', [thread.kind, String(thread.id)]);
  return rows.map((r) => r.account_id);
}

// ---------------------------------------------------------------- the inbox

/**
 * Puts a line in each person's inbox. A conversation they have an unread
 * line about for the same reason gets that line counted up and moved to
 * the top, rather than a second one. The one who did it is never told of
 * it, nor is anyone who may not read it; bots have no inbox.
 */
export async function notify(db: Db, people: readonly string[], input: { reason: NotificationReason; subject: Subject; actor: string | null; detail?: Record<string, unknown> }): Promise<string[]> {
  const told: string[] = [];
  for (const person of new Set(people)) {
    if (person === input.actor) continue;
    if (!(await mayRead(db, input.subject, person))) continue;
    const detail = JSON.stringify(input.detail ?? {});
    const bumped = await one<{ id: string }>(
      db,
      `UPDATE auth.notification SET count = count + 1, updated_at = now(), actor = $5, detail = $6, emailed_at = NULL
       WHERE person_id = $1 AND reason = $2 AND subject_kind = $3 AND subject_id = $4 AND read_at IS NULL RETURNING id`,
      [person, input.reason, input.subject.kind, input.subject.id, input.actor, detail],
    );
    if (!bumped) {
      const made = await one<{ id: string }>(
        db,
        `INSERT INTO auth.notification (person_id, reason, subject_kind, subject_id, actor, detail)
         SELECT $1, $2, $3, $4, $5, $6 WHERE EXISTS (SELECT 1 FROM auth.person WHERE id = $1) RETURNING id`,
        [person, input.reason, input.subject.kind, input.subject.id, input.actor, detail],
      );
      if (!made) continue;
    }
    told.push(person);
  }
  return told;
}

/** Tells a thread's followers (and `also`), leaving out `except` (people already told of it for a stronger reason). */
export async function announce(db: Db, thread: ThreadRef, actor: string, reason: NotificationReason, options: { detail?: Record<string, unknown>; also?: readonly string[]; except?: readonly string[] } = {}): Promise<string[]> {
  const except = new Set(options.except ?? []);
  const people = [...(await followersOf(db, thread)), ...(options.also ?? [])].filter((p) => !except.has(p));
  return notify(db, people, { reason, subject: subjectOf(thread), actor, detail: options.detail });
}

// ---------------------------------------------------------------- writing

/**
 * Reads what someone wrote (a comment, a suggestion's description, a
 * report's words) for @mentions and #numbers. Each person named is told
 * and follows the conversation from then on; each suggestion or report
 * numbered is told where it was mentioned (unless that was a private
 * report, whose words stay where they are); and a suggestion's "Fixes #12"
 * links it to Report 12, which approving it will close. Given `previous`
 * (an edit), only what the edit added is new.
 */
export async function noteWriting(
  db: Db,
  input: { source: { kind: 'changeset' | 'report' | 'comment' | 'review'; id: number }; author: string; text: string | null | undefined; subject: Subject; previous?: string | null },
): Promise<{ mentioned: string[] }> {
  const text = input.text ?? '';
  if (!text.trim()) return { mentioned: [] };
  const thread = threadOf(input.subject);

  const before = new Set(input.previous ? mentionsIn(input.previous) : []);
  const names = mentionsIn(text).filter((n) => !before.has(n)).slice(0, 50);
  const ids = await idsOfUsernames(db, names);
  const named = [...new Set(ids.values())].filter((id) => id !== input.author);
  const readers: string[] = [];
  for (const person of named) if (await mayRead(db, input.subject, person)) readers.push(person);
  for (const person of readers) {
    await db.query(
      'INSERT INTO mention (source_kind, source_id, account_id) SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM account WHERE id = $3) ON CONFLICT DO NOTHING',
      [input.source.kind, input.source.id, person],
    );
    if (thread) await subscribe(db, person, thread);
  }
  const mentioned = await notify(db, readers, { reason: 'mention', subject: input.subject, actor: input.author, detail: { source: input.source } });

  const info = thread ? await threadInfo(db, thread) : null;
  if (!info?.private) {
    const previousRefs = new Set(input.previous ? referencesIn(input.previous).map((r) => `${r.number}:${r.closes}`) : []);
    for (const ref of referencesIn(text).slice(0, 50)) {
      if (previousRefs.has(`${ref.number}:${ref.closes}`)) continue;
      const target = await threadByNumber(db, ref.number);
      if (!target || (thread && target.kind === thread.kind && target.id === thread.id)) continue;
      const closes = ref.closes && thread?.kind === 'changeset' && input.source.kind === 'changeset' && target.kind === 'report';
      if (closes) {
        await db.query('INSERT INTO thread_link (changeset_id, report_id, closes) VALUES ($1, $2, TRUE) ON CONFLICT (changeset_id, report_id) DO UPDATE SET closes = TRUE', [thread!.id, target.id]);
      }
      // Once per conversation that mentions it, however often.
      const from = { kind: input.subject.kind, id: input.subject.id, number: info?.number ?? null };
      const seen = await one(db, "SELECT 1 FROM thread_event WHERE thread_kind = $1 AND thread_id = $2 AND kind = 'referenced' AND detail->'from'->>'kind' = $3 AND detail->'from'->>'id' = $4 AND (detail->>'closes')::boolean IS NOT DISTINCT FROM $5", [
        target.kind,
        target.id,
        from.kind,
        from.id,
        closes,
      ]);
      if (!seen) await threadEvent(db, target, input.author, 'referenced', { from, source: input.source, closes });
    }
  }
  return { mentioned };
}

// ---------------------------------------------------------------- hooks the catalog calls

/** A suggestion was started: its author follows it, and its description is read for mentions and "Fixes #n". */
export async function suggestionStarted(db: Db, cs: { id: number; author: string; description: string | null; number: number | null }): Promise<void> {
  if (cs.number === null) return; // an import: no conversation
  const thread: ThreadRef = { kind: 'changeset', id: cs.id };
  await subscribe(db, cs.author, thread);
  await noteWriting(db, { source: { kind: 'changeset', id: cs.id }, author: cs.author, text: cs.description, subject: subjectOf(thread) });
}

/**
 * A suggestion was sent for review. The first time, whoever follows an
 * item it changes (or a set they are in) is told, and the keepers of its
 * sets are asked to review it, as a repository's code owners are. Sent
 * again after changes were asked for, those who asked are asked again.
 */
export async function suggestionSubmitted(db: Db, input: { id: number; by: string; entityIds: readonly string[]; setIds: readonly string[]; keepers: readonly string[]; live: boolean; authorIsBot: boolean }): Promise<void> {
  const thread: ThreadRef = { kind: 'changeset', id: input.id };
  if ((await threadInfo(db, thread))?.number == null) return; // an import: no conversation
  const again = await one(db, "SELECT 1 FROM thread_event WHERE thread_kind = 'changeset' AND thread_id = $1 AND kind = 'submitted'", [input.id]);
  await threadEvent(db, thread, input.by, 'submitted', { live: input.live });
  if (input.live) {
    await announce(db, thread, input.by, 'state', { detail: { event: 'live' } });
    return;
  }
  let asked: string[] = [];
  // A machine's proposals (citations found, and the like) wait on /review without asking anyone by name.
  if (!again && !input.authorIsBot) {
    asked = await requestReviewers(db, thread.id, SYSTEM_ACCOUNT, input.keepers.filter((k) => k !== input.by), { auto: true });
    const { rows } = await db.query<{ account_id: string }>(
      "SELECT DISTINCT account_id FROM follow WHERE (target_kind = 'entity' AND target_id = ANY($1::text[])) OR (target_kind = 'set' AND target_id = ANY($2::text[]))",
      [input.entityIds.slice(0, 200), [...input.setIds]],
    );
    await notify(db, rows.map((r) => r.account_id).filter((p) => !asked.includes(p)), { reason: 'followed', subject: subjectOf(thread), actor: input.by, detail: { event: 'submitted' } });
  } else if (again) {
    // Those who asked for changes are asked to look again.
    const { rows } = await db.query<{ reviewer: string }>("SELECT DISTINCT reviewer FROM review WHERE changeset_id = $1 AND verdict = 'send_back'", [input.id]);
    asked = await requestReviewers(db, thread.id, input.by, rows.map((r) => r.reviewer), { auto: true });
  }
  await announce(db, thread, input.by, 'state', { detail: { event: 'submitted' }, except: asked });
}

/**
 * Asks people to review a suggestion (a re-request when they already
 * have): they follow it and are told. Returns who was asked.
 */
export async function requestReviewers(db: Db, changesetId: number, by: string, reviewers: readonly string[], options: { auto?: boolean } = {}): Promise<string[]> {
  const asked: string[] = [];
  for (const reviewer of new Set(reviewers)) {
    const row = await one<{ reviewer: string }>(
      db,
      `INSERT INTO review_request (changeset_id, reviewer, requested_by) SELECT $1, $2, $3
       WHERE EXISTS (SELECT 1 FROM account WHERE id = $2 AND NOT is_bot)
       ON CONFLICT (changeset_id, reviewer) DO UPDATE SET requested_by = EXCLUDED.requested_by, requested_at = now() RETURNING reviewer`,
      [changesetId, reviewer, by],
    );
    if (!row) continue;
    asked.push(reviewer);
    await subscribe(db, reviewer, { kind: 'changeset', id: changesetId });
  }
  if (asked.length === 0) return [];
  await threadEvent(db, { kind: 'changeset', id: changesetId }, by, 'review_requested', { reviewers: asked, ...(options.auto ? { auto: true } : {}) });
  await notify(db, asked, { reason: 'review_requested', subject: { kind: 'changeset', id: String(changesetId) }, actor: by === SYSTEM_ACCOUNT ? null : by });
  return asked;
}

/** A review was given (approve, changes asked, or a comment): the reviewer's request is answered, they follow it, and its followers are told. */
export async function reviewGiven(db: Db, input: { changesetId: number; by: string; verdict: 'approve' | 'send_back' | 'comment'; reviewId?: number; body?: string | null; mentioned?: readonly string[] }): Promise<void> {
  const thread: ThreadRef = { kind: 'changeset', id: input.changesetId };
  // An import approved by a steward is no conversation: nothing to follow, nobody to tell.
  if ((await threadInfo(db, thread))?.number == null) return;
  await db.query('DELETE FROM review_request WHERE changeset_id = $1 AND reviewer = $2', [input.changesetId, input.by]);
  await subscribe(db, input.by, thread);
  const { mentioned } =
    input.reviewId && input.body ? await noteWriting(db, { source: { kind: 'review', id: input.reviewId }, author: input.by, text: input.body, subject: subjectOf(thread) }) : { mentioned: [] as string[] };
  const author = (await threadInfo(db, thread))?.author;
  await announce(db, thread, input.by, 'review', { detail: { verdict: input.verdict }, also: author ? [author] : [], except: [...mentioned, ...(input.mentioned ?? [])] });
}

/**
 * A suggestion was approved and merged (or went live). The reports it
 * said it fixes are closed, as done, by it; everyone following either is told.
 */
export async function suggestionMerged(db: Db, input: { id: number; by: string; commit: number | null; live?: boolean }): Promise<void> {
  const thread: ThreadRef = { kind: 'changeset', id: input.id };
  const info = await threadInfo(db, thread);
  if (info?.number === null || !info) return;
  await threadEvent(db, thread, input.by, 'merged', { commit: input.commit, ...(input.live ? { live: true } : {}) });
  await db.query('DELETE FROM review_request WHERE changeset_id = $1', [input.id]);
  if (!input.live) await announce(db, thread, input.by, 'state', { detail: { event: 'merged' } });
  const { rows } = await db.query<{ report_id: string | number }>(
    "SELECT l.report_id FROM thread_link l JOIN report r ON r.id = l.report_id WHERE l.changeset_id = $1 AND l.closes AND r.status = 'open'",
    [input.id],
  );
  for (const row of rows) {
    const report = Number(row.report_id);
    await db.query("UPDATE report SET status = 'resolved', resolved_by = $2, resolution_changeset = $3, closed_at = now(), updated_at = now() WHERE id = $1", [report, input.by, input.id]);
    await threadEvent(db, { kind: 'report', id: report }, input.by, 'closed', { outcome: 'resolved', by: { kind: 'changeset', id: input.id, number: info.number } });
    await announce(db, { kind: 'report', id: report }, input.by, 'state', { detail: { event: 'closed', outcome: 'resolved', by: info.number } });
  }
}

/** A suggestion was withdrawn: said in its timeline, its followers told. */
export async function suggestionWithdrawn(db: Db, input: { id: number; by: string }): Promise<void> {
  const thread: ThreadRef = { kind: 'changeset', id: input.id };
  if ((await threadInfo(db, thread))?.number == null) return;
  await threadEvent(db, thread, input.by, 'withdrawn');
  await db.query('DELETE FROM review_request WHERE changeset_id = $1', [input.id]);
  await announce(db, thread, input.by, 'state', { detail: { event: 'withdrawn' } });
}

/** A merged suggestion was undone by another (a revert): said in its timeline, its followers told. */
export async function suggestionReverted(db: Db, input: { id: number; by: string; revert: number }): Promise<void> {
  const thread: ThreadRef = { kind: 'changeset', id: input.id };
  if ((await threadInfo(db, thread))?.number == null) return;
  const revert = await threadInfo(db, { kind: 'changeset', id: input.revert });
  await threadEvent(db, thread, input.by, 'reverted', { by: { kind: 'changeset', id: input.revert, number: revert?.number ?? null } });
  await announce(db, thread, input.by, 'state', { detail: { event: 'reverted' } });
}

/**
 * A report was sent. Who sent it (when signed in) follows it; its words
 * are read for mentions; the keepers of its set, and whoever follows the
 * item it is about, are told.
 */
export async function reportOpened(db: Db, input: { id: number; reporter: string | null; note: string | null; entityId: string | null; setId: string | null }): Promise<void> {
  const thread: ThreadRef = { kind: 'report', id: input.id };
  if (input.reporter) {
    await subscribe(db, input.reporter, thread);
    await noteWriting(db, { source: { kind: 'report', id: input.id }, author: input.reporter, text: input.note, subject: subjectOf(thread) });
  }
  const keepers = await keepersOfSet(db, input.setId);
  const { rows } = await db.query<{ account_id: string }>(
    "SELECT DISTINCT account_id FROM follow WHERE (target_kind = 'entity' AND target_id = $1) OR (target_kind = 'set' AND target_id = $2)",
    [input.entityId ?? '', input.setId ?? ''],
  );
  await notify(db, [...keepers, ...rows.map((r) => r.account_id)], { reason: 'followed', subject: subjectOf(thread), actor: input.reporter, detail: { event: 'opened' } });
}

/** A report was closed (done, or not planned) or opened again. */
export async function reportStateChanged(db: Db, input: { id: number; by: string; outcome: 'resolved' | 'dismissed' | 'open'; note?: string | null; changeset?: number | null }): Promise<void> {
  const thread: ThreadRef = { kind: 'report', id: input.id };
  if (input.outcome === 'open') await threadEvent(db, thread, input.by, 'reopened');
  else {
    const by = input.changeset ? await threadInfo(db, { kind: 'changeset', id: input.changeset }) : null;
    await threadEvent(db, thread, input.by, 'closed', { outcome: input.outcome, ...(input.note ? { note: input.note } : {}), ...(by ? { by: { kind: 'changeset', id: input.changeset, number: by.number } } : {}) });
  }
  await announce(db, thread, input.by, 'state', { detail: { event: input.outcome === 'open' ? 'reopened' : 'closed', outcome: input.outcome } });
}

/**
 * A comment was written: on a thread, its writer follows it and its
 * followers are told; on any page, the people it names are told.
 */
export async function commented(db: Db, input: { id: number; author: string; body: string; target: Subject; review?: boolean }): Promise<void> {
  const thread = threadOf(input.target);
  const { mentioned } = await noteWriting(db, { source: { kind: 'comment', id: input.id }, author: input.author, text: input.body, subject: input.target });
  if (!thread || input.review) return;
  await subscribe(db, input.author, thread);
  await announce(db, thread, input.author, 'comment', { detail: { comment: input.id }, except: mentioned });
}
