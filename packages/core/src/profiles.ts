import { one, type Db } from '@rebbehub/db';
import { personByUsername } from './usernames.js';
import type { Via } from './via.js';

/**
 * A person's page (/u/<handle>): who they are, since when, what they
 * earned (Trusted, steward), how much they have done, and what they did
 * lately - suggestions made, reviews given, issues opened, comments -
 * newest first. Only what anyone may read is shown: nothing from a
 * private report, and nothing hidden.
 */

export interface ProfileActivity {
  kind: 'suggestion' | 'review' | 'issue' | 'comment';
  at: string;
  thread: { kind: 'changeset' | 'report' | 'entity'; id: string; number: number | null; title: string | null; state: string | null; path: string | null };
  /** For a review: approve, send_back or comment. */
  verdict?: string;
  /** The first words of a comment or review. */
  excerpt?: string;
  /** Sent by an agent for the person (via.ts): which token or connected app. */
  via?: Via;
}

export interface Profile {
  person: { id: string; username: string; displayName: string; since: string; steward: boolean; admin: boolean; trust: 'contributor' | 'trusted'; suspended: boolean };
  /** Set when the page was asked for by a handle they used to have. */
  movedFrom?: string;
  counts: { suggestions: number; merged: number; reviews: number; issues: number; comments: number };
  activity: ProfileActivity[];
}

const excerpt = (text: string | null) => (text ? (text.length > 160 ? `${text.slice(0, 157).trimEnd()}…` : text) : undefined);

export async function profile(db: Db, username: string, options: { limit?: number } = {}): Promise<Profile | null> {
  const found = await personByUsername(db, username);
  if (!found) return null;
  const id = found.id;
  const person = await one<{ created_at: Date | string; steward: boolean; admin: boolean; trust: string | null; suspended: boolean }>(
    db,
    `SELECT p.created_at, p.steward OR p.admin AS steward, p.admin, a.trust, coalesce(a.suspended_at IS NOT NULL, FALSE) AS suspended
     FROM auth.person p LEFT JOIN account a ON a.id = p.id WHERE p.id = $1`,
    [id],
  );
  const counts = await one<{ suggestions: number; merged: number; reviews: number; issues: number; comments: number }>(
    db,
    `SELECT (SELECT count(*)::int FROM changeset WHERE author = $1 AND number IS NOT NULL AND status <> 'draft') AS suggestions,
            (SELECT count(*)::int FROM changeset WHERE author = $1 AND number IS NOT NULL AND status = 'merged') AS merged,
            (SELECT count(*)::int FROM review WHERE reviewer = $1) AS reviews,
            (SELECT count(*)::int FROM report WHERE reporter = $1 AND NOT private) AS issues,
            (SELECT count(*)::int FROM comment c WHERE c.author = $1 AND c.hidden_at IS NULL
               AND NOT (c.target_kind = 'report' AND EXISTS (SELECT 1 FROM report r WHERE r.id::text = c.target_id AND r.private))) AS comments`,
    [id],
  );
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const { rows } = await db.query<{
    kind: ProfileActivity['kind'];
    at: Date | string;
    thread_kind: 'changeset' | 'report' | 'entity';
    thread_id: string;
    number: string | number | null;
    title: string | null;
    state: string | null;
    path: string | null;
    verdict: string | null;
    body: string | null;
    via: Via | null;
  }>(
    `SELECT * FROM (
       SELECT 'suggestion' AS kind, coalesce(c.submitted_at, c.created_at) AS at, 'changeset' AS thread_kind, c.id::text AS thread_id, c.number, c.title, c.status AS state, NULL AS path, NULL AS verdict, NULL AS body, c.via
       FROM changeset c WHERE c.author = $1 AND c.number IS NOT NULL AND c.status <> 'draft'
       UNION ALL
       SELECT 'review', v.created_at, 'changeset', c.id::text, c.number, c.title, c.status, NULL, v.verdict, v.body, v.via
       FROM review v JOIN changeset c ON c.id = v.changeset_id WHERE v.reviewer = $1 AND c.number IS NOT NULL
       UNION ALL
       SELECT 'issue', r.created_at, 'report', r.id::text, r.number, r.title, r.status, NULL, NULL, r.note, r.via
       FROM report r WHERE r.reporter = $1 AND NOT r.private
       UNION ALL
       SELECT 'comment', m.created_at, m.target_kind, m.target_id, coalesce(c.number, r.number), coalesce(c.title, r.title), coalesce(c.status, r.status), e.path, NULL, m.body, m.via
       FROM comment m
       LEFT JOIN changeset c ON m.target_kind = 'changeset' AND c.id::text = m.target_id
       LEFT JOIN report r ON m.target_kind = 'report' AND r.id::text = m.target_id
       LEFT JOIN entity e ON m.target_kind = 'entity' AND e.id = m.target_id
       WHERE m.author = $1 AND m.hidden_at IS NULL AND m.review_id IS NULL AND m.target_kind IN ('changeset', 'report', 'entity')
         AND NOT coalesce(r.private, FALSE)
     ) t ORDER BY at DESC LIMIT ${limit}`,
    [id],
  );
  return {
    person: {
      id,
      username: found.username,
      displayName: found.displayName,
      since: new Date(person!.created_at).toISOString(),
      steward: person!.steward,
      admin: person!.admin,
      trust: person!.trust === 'trusted' ? 'trusted' : 'contributor',
      suspended: person!.suspended,
    },
    ...(found.movedFrom ? { movedFrom: found.movedFrom } : {}),
    counts: counts!,
    activity: rows.map((r) => ({
      kind: r.kind,
      at: new Date(r.at).toISOString(),
      thread: { kind: r.thread_kind, id: r.thread_id, number: r.number === null ? null : Number(r.number), title: r.title, state: r.state, path: r.path },
      ...(r.verdict ? { verdict: r.verdict } : {}),
      ...(r.body ? { excerpt: excerpt(r.body) } : {}),
      ...(r.via ? { via: r.via } : {}),
    })),
  };
}
