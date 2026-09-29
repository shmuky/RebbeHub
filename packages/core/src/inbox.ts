import { one, type Db } from '@rebbehub/db';
import type { NotificationReason, SubjectKind } from './threads.js';

/**
 * The inbox (/inbox): what concerns a signed-in person, newest first.
 * Someone named them, asked them to review, gave them an issue; or
 * something happened in a suggestion, issue or item they follow. Each
 * line is one conversation and reason, counted up while unread (threads.ts,
 * `notify`). Kept with the person in `auth` (migration 0016).
 */

export interface InboxLine {
  id: number;
  reason: NotificationReason;
  subject: {
    kind: SubjectKind;
    id: string;
    /** For a suggestion or issue: its number, title and state. */
    number: number | null;
    title: string | null;
    state: string | null;
    /** For an item's talk page: its path and name. */
    path: string | null;
    name: unknown;
  };
  actor: string | null;
  actorName: string | null;
  actorUsername: string | null;
  count: number;
  detail: Record<string, unknown>;
  at: string;
  read: boolean;
}

export type InboxFilter = 'unread' | 'all' | NotificationReason;

export async function inbox(db: Db, personId: string, options: { filter?: InboxFilter; limit?: number; before?: string } = {}): Promise<InboxLine[]> {
  const params: unknown[] = [personId];
  const where = ['n.person_id = $1'];
  const filter = options.filter ?? 'all';
  if (filter === 'unread') where.push('n.read_at IS NULL');
  else if (filter !== 'all') where.push(`n.reason = $${params.push(filter)}`);
  if (options.before) where.push(`n.updated_at < $${params.push(options.before)}`);
  const { rows } = await db.query<{
    id: string | number;
    reason: NotificationReason;
    subject_kind: SubjectKind;
    subject_id: string;
    actor: string | null;
    actor_name: string | null;
    actor_username: string | null;
    count: number;
    detail: Record<string, unknown>;
    updated_at: Date | string;
    read_at: Date | string | null;
    number: string | number | null;
    title: string | null;
    state: string | null;
    path: string | null;
    name: unknown;
  }>(
    `SELECT n.id, n.reason, n.subject_kind, n.subject_id, n.actor, coalesce(p.display_name, a.display_name) AS actor_name, p.username AS actor_username,
            n.count, n.detail, n.updated_at, n.read_at,
            coalesce(c.number, r.number) AS number,
            coalesce(c.title, r.title, CASE WHEN r.id IS NOT NULL THEN r.reason END, pr.name) AS title,
            coalesce(c.status, r.status, pr.status) AS state,
            coalesce(e.path, CASE WHEN pr.slug IS NOT NULL THEN '/projects/' || pr.slug END) AS path,
            coalesce(v.data->'title', v.data->'name', v.data->'label') AS name
     FROM auth.notification n
     LEFT JOIN account a ON a.id = n.actor LEFT JOIN auth.person p ON p.id = n.actor
     LEFT JOIN changeset c ON n.subject_kind = 'changeset' AND c.id::text = n.subject_id
     LEFT JOIN report r ON n.subject_kind = 'report' AND r.id::text = n.subject_id
     LEFT JOIN entity e ON n.subject_kind = 'entity' AND e.id = n.subject_id
     LEFT JOIN revision v ON v.id = e.main_rev
     LEFT JOIN project pr ON n.subject_kind = 'project' AND pr.id::text = n.subject_id
     WHERE ${where.join(' AND ')}
     ORDER BY n.updated_at DESC, n.id DESC LIMIT ${Math.min(Math.max(options.limit ?? 50, 1), 100)}`,
    params,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    reason: r.reason,
    subject: {
      kind: r.subject_kind,
      id: r.subject_id,
      number: r.number === null ? null : Number(r.number),
      title: r.title,
      state: r.state,
      path: r.path,
      name: r.name ?? null,
    },
    actor: r.actor,
    actorName: r.actor_name,
    actorUsername: r.actor_username,
    count: r.count,
    detail: r.detail ?? {},
    at: new Date(r.updated_at).toISOString(),
    read: r.read_at !== null,
  }));
}

export async function unreadCount(db: Db, personId: string): Promise<number> {
  return (await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM auth.notification WHERE person_id = $1 AND read_at IS NULL', [personId]))!.n;
}

/** Marks lines read (or unread again): some by id, those about one conversation, or all. Returns how many changed. */
export async function markRead(db: Db, personId: string, input: { ids?: readonly number[]; subject?: { kind: SubjectKind; id: string }; all?: boolean; unread?: boolean }): Promise<number> {
  const set = input.unread ? 'read_at = NULL' : 'read_at = now()';
  const not = input.unread ? 'read_at IS NOT NULL' : 'read_at IS NULL';
  if (input.all) return (await db.query(`UPDATE auth.notification SET ${set} WHERE person_id = $1 AND ${not} RETURNING id`, [personId])).rows.length;
  if (input.subject) {
    return (await db.query(`UPDATE auth.notification SET ${set} WHERE person_id = $1 AND subject_kind = $2 AND subject_id = $3 AND ${not} RETURNING id`, [personId, input.subject.kind, input.subject.id])).rows.length;
  }
  const ids = (input.ids ?? []).filter((id) => Number.isSafeInteger(id)).slice(0, 200);
  if (ids.length === 0) return 0;
  return (await db.query(`UPDATE auth.notification SET ${set} WHERE person_id = $1 AND id = ANY($2::bigint[]) AND ${not} RETURNING id`, [personId, ids])).rows.length;
}

/** Lines not yet sent by email to a person with email updates on (for the digest); oldest first. */
export async function unmailed(db: Db, personId: string, limit = 30): Promise<InboxLine[]> {
  const lines = await inbox(db, personId, { filter: 'unread', limit: 100 });
  const { rows } = await db.query<{ id: string | number }>('SELECT id FROM auth.notification WHERE person_id = $1 AND read_at IS NULL AND emailed_at IS NULL', [personId]);
  const wanted = new Set(rows.map((r) => Number(r.id)));
  return lines.filter((l) => wanted.has(l.id)).reverse().slice(0, limit);
}

export async function markMailed(db: Db, ids: readonly number[]): Promise<void> {
  if (ids.length) await db.query('UPDATE auth.notification SET emailed_at = now() WHERE id = ANY($1::bigint[])', [[...ids]]);
}
