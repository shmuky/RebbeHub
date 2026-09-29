import { migrate, one, type Db } from '@rebbehub/db';
import { validateDateKey } from '@rebbehub/hebrew';
import {
  BUILTIN_SCHEMAS,
  BUILTIN_SCHEMA_VERSION,
  ENTITY_LABELS,
  SchemaRegistry,
  contentHash,
  idFromSeed,
  isEntityId,
  isEntityPath,
  newId,
  referencesOf,
  type EntityId,
  type EntityType,
  type SchemaData,
  type SetData,
} from '@rebbehub/model';
import { badState, CatalogError, forbidden, invalid, notFound } from './errors.js';
import { withStructuredBody } from './legacyWords.js';
import { diffData, threeWayMerge, resolveConflicts, UnresolvedConflictError, type Conflict, type FieldChange, type Json, type Resolution } from './merge.js';
import { canApprove, canSuggest, earnedTrust, mayGoLive, type Account, type SetInfo } from './permissions.js';
import { searchTextOf, toTsQuery } from './searchText.js';
import { focusCounts } from './projectWork.js';
import { commented, reportOpened, reportStateChanged, reviewGiven, suggestionMerged, suggestionReverted, suggestionStarted, suggestionSubmitted, suggestionWithdrawn } from './threads.js';

/**
 * The catalog: GitHub's model over the versioned Postgres schema, in the
 * words people see (docs/plans/rebbehub.md, sections 3, 6 and 7).
 *
 *   Suggestion (changeset)  revisions proposed together, sent for review
 *   Approve / Send back     a keeper's decision; approving merges to main
 *   History                 every version of an item, restorable
 *   Project                 a branch: suggestions merged into an overlay,
 *                           then into main as one commit
 *   Report                  one sentence about something wrong
 *   Catalog edition         a dated, tagged commit
 *
 * Every write runs in one transaction, and merges to main take a lock, so
 * main stays a single line of commits.
 */

export interface RevisionRow {
  id: number;
  entity_id: EntityId;
  entity_type: EntityType;
  parent_rev: number | null;
  merge_rev: number | null;
  data: Json | null;
  path: string | null;
  hash: string;
  changeset_id: number;
  author: string;
  created_at: string;
}

export type ChangesetStatus = 'draft' | 'open' | 'merged' | 'sent_back' | 'withdrawn';
export type ChangesetKind = 'suggestion' | 'import' | 'revert' | 'live';

export interface ChangesetRow {
  id: number;
  /** Its number among Suggestions and Reports (`#12`); null for an import (migration 0016). */
  number: number | null;
  title: string;
  description: string | null;
  author: string;
  status: ChangesetStatus;
  kind: ChangesetKind;
  project_id: number | null;
  base_commit: number;
  merged_commit: number | null;
  reverts_changeset: number | null;
  post_review: 'pending' | 'done' | null;
  checks: Check[];
  created_at: string;
  submitted_at: string | null;
  closed_at: string | null;
}

export interface Check {
  check: 'schema' | 'references' | 'dates' | 'path' | 'duplicates' | 'machine';
  status: 'pass' | 'fail' | 'warn';
  message: string;
  entityId?: EntityId;
  path?: string;
}

/** Checks that stop a merge when they fail; the others are advice for the reviewer. */
const BLOCKING_CHECKS = new Set<Check['check']>(['schema', 'references', 'path', 'dates']);

export interface EntityView<T = Json> {
  id: EntityId;
  type: EntityType;
  path: string | null;
  rev: number;
  data: T;
}

export interface ChangeEntry {
  entityId: EntityId;
  type: EntityType;
  /** Main's version now; null for a new item. */
  before: Json | null;
  /** The suggestion's version; null for a deletion. */
  after: Json | null;
  changes: FieldChange[];
  /** Fields main has changed since the suggestion was written that clash with it. */
  conflicts: Conflict[];
}

export interface Proposal {
  entityId: EntityId;
  type: EntityType;
  /** The version the change was made from (null: a new item). */
  baseRev: number | null;
  /** The proposed version. */
  rev: RevisionRow;
}

export interface NewRevision {
  /** Leave out to create a new item. */
  id?: EntityId;
  type: EntityType;
  /** The item's data; null deletes it. */
  data: Json | null;
  /** Its readable path; left out, it keeps the one it has. */
  path?: string | null;
}

export type ReportReason = 'wrong-fact' | 'missing-page' | 'bad-scan' | 'audio-problem' | 'wrong-text' | 'duplicate' | 'rights' | 'offensive' | 'other';

/** Reports only stewards and the set's keepers read, whatever the sender chose: rights claims (takedowns) and reports of something offensive. */
export const PRIVATE_REASONS: ReadonlySet<ReportReason> = new Set(['rights', 'offensive']);

/** A file Sichos-Kodesh's archive wants and upstream would not give (migration 0009). */
export interface ArchiveGapRow {
  collection: string;
  item_id: string;
  kind: string;
  role: string;
  source: string;
  url: string;
  label: string | null;
  hebrew_date: string | null;
  status: 'unresolved' | 'error';
  http_status: number | null;
  error: string | null;
  attempts: number;
  checked_at: string | null;
  entity_id: string | null;
}

/**
 * What a project works through: the farbrengens (of a year or month)
 * missing recordings or texts; the recordings (of a year) whose sync nobody
 * has checked yet; or the pages of a scan not yet proofread to `level`.
 */
export interface ProjectFocus {
  missing: 'recordings' | 'texts' | 'sync' | 'proofreading';
  within?: string;
  /** For proofreading: the scan whose pages are read. */
  scan?: EntityId;
  /** For proofreading: done at proofread once (1, the default) or twice (2). */
  level?: 1 | 2;
}

export interface ProjectView {
  id: number;
  slug: string;
  name: string;
  goal: string | null;
  set: string | null;
  keepers: string[];
  status: 'open' | 'merged' | 'closed';
  focus: ProjectFocus;
  createdBy: string;
  creatorName: string | null;
  createdAt: string;
  /** Farbrengens in its focus, and how many of them have what was missing. */
  total: number;
  done: number;
}

export interface HistoryEntry {
  commit: number;
  at: string;
  message: string;
  mergedBy: string;
  mergedByName: string | null;
  changeset: number;
  author: string;
  authorName: string | null;
  authorIsBot: boolean;
  rev: number;
  deleted: boolean;
  /** Whether this version made the item (it had none before). */
  created: boolean;
  /** What this version changed from the one before, field by field (none for the first). */
  changes: FieldChange[];
}

/** Where a type's items inherit their sets from, when they carry none themselves. */
const SET_PARENTS: Partial<Record<EntityType, string[]>> = {
  unit: ['work'],
  segment: ['text'],
  text: ['unit', 'publication', 'recording'],
  'text-page': ['layer'],
  'text-layer': ['scan'],
  scan: ['publication'],
  'contents-map': ['publication'],
  'alignment-span': ['alignment'],
  alignment: ['recording'],
  recording: ['event'],
  publication: ['work'],
  relation: ['from'],
};

const MERGE_LOCK = 7_240_001;

export interface CatalogOptions {
  /** Clock for tags; tests pin it. */
  now?: () => Date;
}

export class Catalog {
  private registryCache: { seq: number; registry: SchemaRegistry } | null = null;

  constructor(
    readonly db: Db,
    private readonly options: CatalogOptions = {},
  ) {}

  /** Migrates the database and, on an empty catalog, seeds the built-in schemas as `schema` items (commit 1). */
  async init(): Promise<void> {
    await migrate(this.db);
    // The schema items as main has them, and which of them are older than the built-in ones.
    const { rows } = await this.db.query<{ type: string; version: number }>(
      "SELECT r.data->>'entityType' AS type, (r.data->>'version')::int AS version FROM entity e JOIN revision r ON r.id = e.main_rev WHERE e.type = 'schema' AND NOT e.deleted",
    );
    const have = new Map(rows.map((r) => [r.type, r.version]));
    const stale = Object.keys(BUILTIN_SCHEMAS).filter((type) => (have.get(type) ?? 0) < BUILTIN_SCHEMA_VERSION);
    if (stale.length === 0) return;
    const cs = await this.createChangeset('system', { title: have.size ? `Built-in schemas, version ${BUILTIN_SCHEMA_VERSION}` : 'Built-in schemas', kind: 'import' });
    for (const type of stale) {
      const data: SchemaData = { entityType: type, label: ENTITY_LABELS[type as EntityType], jsonSchema: BUILTIN_SCHEMAS[type as EntityType], version: BUILTIN_SCHEMA_VERSION };
      await this.putRevision(cs.id, 'system', { id: await idFromSeed('schema', type), type: 'schema', data: data as unknown as Json, path: `/schemas/${type}` });
    }
    // Schemas already the same as the built-in ones change nothing: then there is nothing to merge.
    if ((await this.proposals(cs.id)).length === 0) {
      await this.db.query("UPDATE changeset SET status = 'withdrawn', closed_at = now() WHERE id = $1", [cs.id]);
      return;
    }
    await this.submit(cs.id, 'system');
    await this.merge(cs.id, 'system');
  }

  // ------------------------------------------------------------ accounts

  async createAccount(input: { id: string; displayName: string; email?: string; isBot?: boolean }): Promise<Account> {
    const row = await one<Account>(
      this.db,
      `INSERT INTO account (id, display_name, email, is_bot) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING *`,
      [input.id, input.displayName, input.email ?? null, input.isBot ?? false],
    );
    return row!;
  }

  async account(id: string, db: Db = this.db): Promise<Account | null> {
    return one<Account>(db, 'SELECT * FROM account WHERE id = $1', [id]);
  }

  private async requireAccount(id: string, db: Db = this.db): Promise<Account> {
    const account = await this.account(id, db);
    if (!account) throw notFound(`account ${id}`);
    return account;
  }

  /** Appoints or removes a steward. Stewards only. */
  async setSteward(by: string, accountId: string, steward: boolean): Promise<void> {
    await this.db.transaction(async (tx) => {
      const actor = await this.requireAccount(by, tx);
      if (!actor.is_steward) throw forbidden('only stewards appoint stewards');
      await tx.query('UPDATE account SET is_steward = $2 WHERE id = $1', [accountId, steward]);
      await this.audit(tx, by, steward ? 'steward.appoint' : 'steward.remove', 'account', accountId);
    });
  }

  /** Suspends or restores an account. Stewards only. */
  async setSuspended(by: string, accountId: string, suspended: boolean, reason?: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const actor = await this.requireAccount(by, tx);
      if (!actor.is_steward) throw forbidden('only stewards suspend accounts');
      await tx.query('UPDATE account SET suspended_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1', [accountId, suspended]);
      await this.audit(tx, by, suspended ? 'account.suspend' : 'account.restore', 'account', accountId, { reason });
    });
  }

  // ------------------------------------------------------------ reading

  async head(db: Db = this.db): Promise<number> {
    const row = await one<{ seq: number }>(db, 'SELECT coalesce(max(seq), 0)::bigint AS seq FROM commit');
    return row!.seq;
  }

  async revision(id: number, db: Db = this.db): Promise<RevisionRow | null> {
    return one<RevisionRow>(db, 'SELECT * FROM revision WHERE id = $1', [id]);
  }

  /**
   * An item as it is on main, or as of a commit, or as a project sees it
   * (its own changes over main). Deleted items are not found.
   */
  async get(id: EntityId, options: { at?: number; project?: number } = {}, db: Db = this.db): Promise<EntityView | null> {
    let revId: number | null = null;
    if (options.project !== undefined) {
      const row = await one<{ rev_id: number }>(db, 'SELECT rev_id FROM project_head WHERE project_id = $1 AND entity_id = $2', [options.project, id]);
      revId = row?.rev_id ?? null;
    }
    if (revId === null && options.at !== undefined) {
      const row = await one<{ rev_id: number }>(db, 'SELECT rev_id FROM commit_change WHERE entity_id = $1 AND commit_seq <= $2 ORDER BY commit_seq DESC LIMIT 1', [id, options.at]);
      revId = row?.rev_id ?? null;
    } else if (revId === null) {
      const row = await one<{ main_rev: number | null }>(db, 'SELECT main_rev FROM entity WHERE id = $1', [id]);
      revId = row?.main_rev ?? null;
    }
    if (revId === null) return null;
    const rev = await this.revision(revId, db);
    if (!rev || rev.data === null) return null;
    return { id: rev.entity_id, type: rev.entity_type, path: rev.path, rev: rev.id, data: rev.data };
  }

  /** The item at a readable path; an old path answers with where it moved. */
  async resolvePath(path: string): Promise<{ id: EntityId; redirected: boolean; path: string | null } | null> {
    const lower = path.toLowerCase().replace(/\/+$/, '') || '/';
    const live = await one<{ id: EntityId; path: string }>(this.db, 'SELECT id, path FROM entity WHERE path = $1 AND NOT deleted AND main_rev IS NOT NULL', [lower]);
    if (live) return { id: live.id, redirected: false, path: live.path };
    const moved = await one<{ id: EntityId; path: string | null }>(
      this.db,
      'SELECT e.id, e.path FROM path_redirect r JOIN entity e ON e.id = r.entity_id WHERE r.path = $1 AND NOT e.deleted',
      [lower],
    );
    return moved ? { id: moved.id, redirected: true, path: moved.path } : null;
  }

  /** Items of a type on main, optionally in a set, in path order, a page at a time. */
  async list(options: { type?: EntityType; set?: EntityId; limit?: number; after?: string }): Promise<EntityView[]> {
    const params: unknown[] = [];
    const where = ['e.main_rev IS NOT NULL', 'NOT e.deleted'];
    if (options.type) where.push(`e.type = $${params.push(options.type)}`);
    if (options.set) where.push(`EXISTS (SELECT 1 FROM entity_ref s WHERE s.from_id = e.id AND s.field = 'sets' AND s.to_id = $${params.push(options.set)})`);
    if (options.after) where.push(`(coalesce(e.path, '') || e.id) > $${params.push(options.after)}`);
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
    const { rows } = await this.db.query<RevisionRow>(
      `SELECT r.* FROM entity e JOIN revision r ON r.id = e.main_rev
       WHERE ${where.join(' AND ')} ORDER BY coalesce(e.path, '') || e.id LIMIT ${limit}`,
      params,
    );
    return rows.map((r) => ({ id: r.entity_id, type: r.entity_type, path: r.path, rev: r.id, data: r.data! }));
  }

  /** Several items on main at once, in the order asked; missing and deleted ones are left out. */
  async getMany(ids: readonly EntityId[]): Promise<EntityView[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.db.query<RevisionRow>(
      'SELECT r.* FROM entity e JOIN revision r ON r.id = e.main_rev WHERE e.id = ANY($1::text[]) AND NOT e.deleted AND r.data IS NOT NULL',
      [[...new Set(ids)].slice(0, 500)],
    );
    const byId = new Map<string, EntityView>(rows.map((r) => [r.entity_id, { id: r.entity_id, type: r.entity_type, path: r.path, rev: r.id, data: r.data! }]));
    return ids.map((id) => byId.get(id)).filter((v): v is EntityView => v !== undefined);
  }

  /**
   * An item's children on main in their own order (a work's units, a
   * text's segments), a page at a time: `after` is the last `order` seen,
   * and `afterId` the last id, so children sharing an order are not skipped.
   */
  async children(parentId: EntityId, field: string, type: EntityType, options: { after?: string; afterId?: string; limit?: number } = {}): Promise<EntityView[]> {
    const { rows } = await this.db.query<RevisionRow>(
      `SELECT r.* FROM entity_ref x JOIN entity e ON e.id = x.from_id JOIN revision r ON r.id = e.main_rev
       WHERE x.to_id = $1 AND x.field = $2 AND e.type = $3 AND NOT e.deleted
         AND ($4::text IS NULL
              OR coalesce(r.data->>'order', '') COLLATE "C" > $4::text COLLATE "C"
              OR ($5::text IS NOT NULL AND coalesce(r.data->>'order', '') COLLATE "C" = $4::text COLLATE "C" AND e.id > $5::text))
       ORDER BY coalesce(r.data->>'order', '') COLLATE "C", e.id LIMIT ${Math.min(Math.max(options.limit ?? 100, 1), 1000)}`,
      [parentId, field, type, options.after ?? null, options.afterId ?? null],
    );
    return rows.map((r) => ({ id: r.entity_id, type: r.entity_type, path: r.path, rev: r.id, data: r.data! }));
  }

  /**
   * Events on main by Hebrew date, in calendar order: within a year or a
   * month (`within: '5742'`, `'5742-05'`), or on one day of every year
   * (`day: '05-10'`, "this day in other years").
   */
  /**
   * Events on main by date: within a year or month, on a day of any year
   * (`05-10`, or several days for a week), or on exact dates. Each comes
   * with how many recordings it has, so a list can show which can be heard.
   */
  async events(options: { within?: string; day?: string | string[]; dates?: string[]; missing?: 'recordings' | 'texts'; limit?: number }): Promise<Array<EntityView & { recordings: number }>> {
    const params: unknown[] = [];
    const where = ["e.type = 'event'", 'NOT e.deleted'];
    if (options.within !== undefined) {
      if (!/^\d{4}(-(0[1-9]|1[0-2]|06A|06B))?$/.test(options.within)) throw invalid('within is a year (5742) or a month (5742-05)');
      params.push(options.within);
      where.push(`(r.data->>'date' = $${params.length} OR r.data->>'date' LIKE $${params.length} || '-%')`);
    }
    const days = options.day === undefined ? [] : Array.isArray(options.day) ? options.day : [options.day];
    if (options.day !== undefined) {
      if (days.length === 0 || days.length > 31) throw invalid('give one to 31 days');
      for (const day of days) if (!/^(0[1-9]|1[0-2]|06A|06B)-(0[1-9]|[12]\d|30)$/.test(day)) throw invalid('a day is a month and day (05-10)');
      params.push(days);
      where.push(`substring(r.data->>'date' from 6) = ANY($${params.length}::text[])`);
    }
    if (options.dates !== undefined) {
      if (options.dates.length === 0 || options.dates.length > 500) throw invalid('give one to 500 dates');
      for (const date of options.dates) if (!/^\d{4}-(0[1-9]|1[0-2]|06A|06B)-(0[1-9]|[12]\d|30)$/.test(date)) throw invalid('a date is a full date key (5742-05-10)');
      params.push(options.dates);
      where.push(`r.data->>'date' = ANY($${params.length}::text[])`);
    }
    // What people can help add: events with no recording, or no text (hanacha) linked.
    if (options.missing === 'recordings')
      where.push("NOT EXISTS (SELECT 1 FROM entity_ref x JOIN entity f ON f.id = x.from_id AND f.type = 'recording' AND NOT f.deleted WHERE x.to_id = e.id AND x.field = 'event')");
    if (options.missing === 'texts') where.push("coalesce(jsonb_array_length(r.data->'links'), 0) = 0");
    const { rows } = await this.db.query<RevisionRow & { recordings: number }>(
      `SELECT r.*, (SELECT count(*)::int FROM entity_ref x JOIN entity f ON f.id = x.from_id AND NOT f.deleted
                    WHERE x.to_id = e.id AND x.field = 'event' AND f.type = 'recording') AS recordings
       FROM entity e JOIN revision r ON r.id = e.main_rev WHERE ${where.join(' AND ')}
       ORDER BY r.data->>'date' COLLATE "C", coalesce((r.data->>'order')::int, 0), e.id LIMIT ${Math.min(Math.max(options.limit ?? 500, 1), 2000)}`,
      params,
    );
    return rows.map((r) => ({ id: r.entity_id, type: r.entity_type, path: r.path, rev: r.id, data: r.data!, recordings: r.recordings }));
  }

  /**
   * How many items on main point at each item through a field: the units of
   * each work (`work`, `unit`), the works of each author. For a library
   * that shows how much each thing holds without fetching it all.
   */
  async refCounts(field: string, type?: EntityType): Promise<Record<string, number>> {
    const params: unknown[] = [field];
    const typed = type ? `AND f.type = $${params.push(type)}` : '';
    const { rows } = await this.db.query<{ id: string; n: number }>(
      `SELECT x.to_id AS id, count(*)::int AS n FROM entity_ref x JOIN entity f ON f.id = x.from_id AND NOT f.deleted AND f.main_rev IS NOT NULL
       WHERE x.field = $1 ${typed} GROUP BY x.to_id`,
      params,
    );
    return Object.fromEntries(rows.map((r) => [r.id, r.n]));
  }

  /**
   * A work's outline: its top-level parts (volumes, sections) in order,
   * with each one's name and how many units it holds. A work of one level
   * has one part per unit.
   */
  async workOutline(work: EntityId): Promise<Array<{ value: string; label: Json | null; units: number }>> {
    const { rows } = await this.db.query<{ value: string; label: Json | null; units: number }>(
      `SELECT r.data->'position'->0->>'value' AS value,
              (array_agg(r.data->'position'->0->'label' ORDER BY r.data->>'order' COLLATE "C"))[1] AS label,
              count(*)::int AS units
       FROM entity_ref x JOIN entity e ON e.id = x.from_id AND e.type = 'unit' AND NOT e.deleted JOIN revision r ON r.id = e.main_rev
       WHERE x.to_id = $1 AND x.field = 'work'
       GROUP BY 1 ORDER BY min(r.data->>'order' COLLATE "C")`,
      [work],
    );
    return rows;
  }

  /** The units of one top-level part of a work (a volume), in order. */
  async workPart(work: EntityId, part: string, limit = 1000): Promise<EntityView[]> {
    const { rows } = await this.db.query<RevisionRow>(
      `SELECT r.* FROM entity_ref x JOIN entity e ON e.id = x.from_id AND e.type = 'unit' AND NOT e.deleted JOIN revision r ON r.id = e.main_rev
       WHERE x.to_id = $1 AND x.field = 'work' AND r.data->'position'->0->>'value' = $2
       ORDER BY r.data->>'order' COLLATE "C" LIMIT ${Math.min(Math.max(limit, 1), 2000)}`,
      [work, part],
    );
    return rows.map((r) => ({ id: r.entity_id, type: r.entity_type, path: r.path, rev: r.id, data: r.data! }));
  }

  /**
   * The community's page in numbers: the latest merges (who suggested,
   * who approved, how much changed), how many reports wait, how many
   * people have suggested anything, and what the catalog still lacks that
   * anyone could help with. Counts only: reports themselves stay private.
   */
  async community(limit = 8): Promise<{
    recent: Array<{ seq: number; at: string; message: string; author: string; authorName: string; authorIsBot: boolean; mergedBy: string; mergedByName: string | null; changes: number }>;
    openReports: number;
    openSuggestions: number;
    people: number;
    gaps: { events: number; eventsWithoutRecordings: number; eventsWithoutTexts: number };
  }> {
    const [recent, reports, suggestions, people, gaps] = await Promise.all([
      this.db.query<{ seq: string; at: Date | string; message: string; author: string; author_name: string; author_is_bot: boolean; merged_by: string; merged_by_name: string | null; changes: number }>(
        `SELECT c.seq, c.at, c.message, cs.author, a.display_name AS author_name, a.is_bot AS author_is_bot, c.merged_by, m.display_name AS merged_by_name,
                (SELECT count(*)::int FROM commit_change cc WHERE cc.commit_seq = c.seq) AS changes
         FROM commit c JOIN changeset cs ON cs.id = c.changeset_id JOIN account a ON a.id = cs.author LEFT JOIN account m ON m.id = c.merged_by
         WHERE cs.author <> 'system' ORDER BY c.seq DESC LIMIT ${Math.min(Math.max(limit, 1), 50)}`,
      ),
      one<{ n: number }>(this.db, "SELECT count(*)::int AS n FROM report WHERE status = 'open'"),
      one<{ n: number }>(this.db, "SELECT count(*)::int AS n FROM changeset WHERE status = 'open'"),
      one<{ n: number }>(this.db, "SELECT count(DISTINCT cs.author)::int AS n FROM changeset cs JOIN account a ON a.id = cs.author WHERE NOT a.is_bot AND cs.author <> 'system'"),
      one<{ events: number; without_recordings: number; without_texts: number }>(
        this.db,
        `SELECT count(*)::int AS events,
                count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM entity_ref x JOIN entity f ON f.id = x.from_id AND f.type = 'recording' AND NOT f.deleted WHERE x.to_id = e.id AND x.field = 'event'))::int AS without_recordings,
                count(*) FILTER (WHERE coalesce(jsonb_array_length(r.data->'links'), 0) = 0)::int AS without_texts
         FROM entity e JOIN revision r ON r.id = e.main_rev WHERE e.type = 'event' AND NOT e.deleted`,
      ),
    ]);
    return {
      recent: recent.rows.map((r) => ({
        seq: Number(r.seq),
        at: new Date(r.at).toISOString(),
        message: r.message,
        author: r.author,
        authorName: r.author_name,
        authorIsBot: r.author_is_bot,
        mergedBy: r.merged_by,
        mergedByName: r.merged_by_name,
        changes: r.changes,
      })),
      openReports: reports?.n ?? 0,
      openSuggestions: suggestions?.n ?? 0,
      people: people?.n ?? 0,
      gaps: { events: gaps?.events ?? 0, eventsWithoutRecordings: gaps?.without_recordings ?? 0, eventsWithoutTexts: gaps?.without_texts ?? 0 },
    };
  }

  /** How many items of each type main holds. */
  async counts(): Promise<Record<string, number>> {
    const { rows } = await this.db.query<{ type: string; n: number }>('SELECT type, count(*)::int AS n FROM entity WHERE main_rev IS NOT NULL AND NOT deleted GROUP BY type');
    return Object.fromEntries(rows.map((r) => [r.type, r.n]));
  }

  /** Items on main that point at this one: "Printed in…", "Cited by…", a work's units. */
  async backlinks(id: EntityId, options: { field?: string; type?: EntityType; limit?: number } = {}): Promise<Array<{ from: EntityId; type: EntityType; field: string; path: string | null }>> {
    const params: unknown[] = [id];
    const where = ['r.to_id = $1', 'NOT e.deleted'];
    if (options.field) where.push(`r.field = $${params.push(options.field)}`);
    if (options.type) where.push(`e.type = $${params.push(options.type)}`);
    const { rows } = await this.db.query<{ from: EntityId; type: EntityType; field: string; path: string | null }>(
      `SELECT r.from_id AS "from", e.type, r.field, e.path FROM entity_ref r JOIN entity e ON e.id = r.from_id
       WHERE ${where.join(' AND ')} ORDER BY coalesce(e.path, '') || e.id LIMIT ${Math.min(options.limit ?? 200, 1000)}`,
      params,
    );
    return rows;
  }

  /** The latest version of an item that `author` proposed and that was merged: what a bot last said about it. */
  async lastMergedBy(id: EntityId, author: string): Promise<RevisionRow | null> {
    return one<RevisionRow>(
      this.db,
      `SELECT r.* FROM revision r JOIN changeset c ON c.id = r.changeset_id
       WHERE r.entity_id = $1 AND r.author = $2 AND c.status = 'merged' AND r.merge_rev IS NULL ORDER BY r.id DESC LIMIT 1`,
      [id, author],
    );
  }

  /** Every merged change to an item, newest first. */
  async history(id: EntityId): Promise<HistoryEntry[]> {
    const { rows } = await this.db.query<Omit<HistoryEntry, 'changes' | 'created'> & { data: Json | null; prev: Json | null; has_prev: boolean }>(
      `SELECT c.seq AS commit, c.at, c.message, c.merged_by AS "mergedBy", m.display_name AS "mergedByName", c.changeset_id AS changeset,
              r.author, a.display_name AS "authorName", coalesce(a.is_bot, FALSE) AS "authorIsBot", cc.rev_id AS rev, (r.data IS NULL) AS deleted,
              r.data, p.data AS prev, (cc.prev_rev_id IS NOT NULL) AS has_prev
       FROM commit_change cc JOIN commit c ON c.seq = cc.commit_seq JOIN revision r ON r.id = cc.rev_id
       LEFT JOIN revision p ON p.id = cc.prev_rev_id
       LEFT JOIN account a ON a.id = r.author LEFT JOIN account m ON m.id = c.merged_by
       WHERE cc.entity_id = $1 ORDER BY c.seq DESC`,
      [id],
    );
    return rows.map(({ data, prev, has_prev, ...entry }) => ({ ...entry, created: !has_prev, changes: has_prev ? diffData(prev, data) : [] }));
  }

  /** Full text search over names, labels, text and dates on main. */
  async search(query: string, options: { type?: EntityType; limit?: number } = {}): Promise<EntityView[]> {
    const tsQuery = toTsQuery(query);
    if (!tsQuery) return [];
    const params: unknown[] = [tsQuery];
    const where = ["to_tsvector('simple', coalesce(e.search_text, '')) @@ to_tsquery('simple', $1)", 'NOT e.deleted', 'e.main_rev IS NOT NULL'];
    if (options.type) where.push(`e.type = $${params.push(options.type)}`);
    const { rows } = await this.db.query<RevisionRow>(
      `SELECT r.* FROM entity e JOIN revision r ON r.id = e.main_rev WHERE ${where.join(' AND ')}
       ORDER BY ts_rank(to_tsvector('simple', coalesce(e.search_text, '')), to_tsquery('simple', $1)) DESC, e.path
       LIMIT ${Math.min(options.limit ?? 20, 100)}`,
      params,
    );
    return rows.map((r) => ({ id: r.entity_id, type: r.entity_type, path: r.path, rev: r.id, data: r.data! }));
  }

  /** The entity types and their schemas as main has them now. */
  async registry(db: Db = this.db): Promise<SchemaRegistry> {
    const seq = await this.head(db);
    if (this.registryCache && this.registryCache.seq === seq) return this.registryCache.registry;
    const { rows } = await db.query<{ data: SchemaData }>(
      "SELECT r.data FROM entity e JOIN revision r ON r.id = e.main_rev WHERE e.type = 'schema' AND NOT e.deleted",
    );
    const registry = SchemaRegistry.withOverrides(rows.map((r) => [r.data.entityType, r.data.jsonSchema]));
    this.registryCache = { seq, registry };
    return registry;
  }

  // ------------------------------------------------------------ suggestions

  /** Starts a suggestion (a draft), written against main as it is now, or within a project. */
  async createChangeset(author: string, input: { title: string; description?: string; kind?: ChangesetKind; project?: number }): Promise<ChangesetRow> {
    return this.db.transaction(async (tx) => {
      const account = await this.requireAccount(author, tx);
      if (!canSuggest(account)) throw forbidden('this account cannot make suggestions');
      if (input.title.trim().length === 0) throw invalid('a suggestion needs a title');
      if (input.project !== undefined) {
        const project = await one<{ status: string }>(tx, 'SELECT status FROM project WHERE id = $1', [input.project]);
        if (!project) throw notFound(`project ${input.project}`);
        if (project.status !== 'open') throw badState('that project is closed');
      }
      const kind = input.kind ?? (account.is_bot ? 'import' : 'suggestion');
      const row = await one<ChangesetRow>(
        tx,
        `INSERT INTO changeset (title, description, author, kind, project_id, base_commit)
         VALUES ($1, $2, $3, $4, $5, (SELECT coalesce(max(seq), 0) FROM commit)) RETURNING *`,
        [input.title.trim(), input.description ?? null, author, kind, input.project ?? null],
      );
      await suggestionStarted(tx, { id: row!.id, author, description: row!.description, number: row!.number === null ? null : Number(row!.number) });
      return row!;
    });
  }

  async changeset(id: number, db: Db = this.db): Promise<ChangesetRow> {
    const row = await one<ChangesetRow>(db, 'SELECT * FROM changeset WHERE id = $1', [id]);
    if (!row) throw notFound(`suggestion ${id}`);
    return row;
  }

  /** Suggestions, oldest sent first; `after` (the last one seen: when it was sent, and its id) gives the next page. */
  async listChangesets(options: { status?: ChangesetStatus; author?: string; project?: number; postReview?: boolean; limit?: number; after?: { at: string; id: number } } = {}): Promise<ChangesetRow[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    if (options.status) where.push(`status = $${params.push(options.status)}`);
    if (options.author) where.push(`author = $${params.push(options.author)}`);
    if (options.project !== undefined) where.push(`project_id = $${params.push(options.project)}`);
    if (options.postReview) where.push("post_review = 'pending'");
    // To the millisecond, as a cursor carries it (JavaScript's dates have no finer).
    const at = "date_trunc('milliseconds', coalesce(submitted_at, created_at))";
    if (options.after) where.push(`(${at}, id) > ($${params.push(options.after.at)}::timestamptz, $${params.push(options.after.id)}::bigint)`);
    const { rows } = await this.db.query<ChangesetRow>(
      `SELECT * FROM changeset ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ${at} ASC, id ASC LIMIT ${Math.min(Math.max(options.limit ?? 50, 1), 500)}`,
      params,
    );
    return rows;
  }

  /** What the item is as this suggestion sees it: its own latest version, else the project's, else main's. */
  private async currentFor(tx: Db, changeset: ChangesetRow, id: EntityId): Promise<RevisionRow | null> {
    const own = await one<RevisionRow>(tx, 'SELECT * FROM revision WHERE changeset_id = $1 AND entity_id = $2 ORDER BY id DESC LIMIT 1', [changeset.id, id]);
    if (own) return own;
    if (changeset.project_id !== null) {
      const head = await one<{ rev_id: number }>(tx, 'SELECT rev_id FROM project_head WHERE project_id = $1 AND entity_id = $2', [changeset.project_id, id]);
      if (head) return this.revision(head.rev_id, tx);
    }
    const entity = await one<{ main_rev: number | null }>(tx, 'SELECT main_rev FROM entity WHERE id = $1', [id]);
    return entity?.main_rev ? this.revision(entity.main_rev, tx) : null;
  }

  /** Adds (or replaces) one item's proposed version in a draft suggestion. Returns the item's id. */
  async putRevision(changesetId: number, by: string, input: NewRevision): Promise<EntityId> {
    return this.db.transaction(async (tx) => {
      const cs = await this.changeset(changesetId, tx);
      if (cs.author !== by) throw forbidden('only its author edits a suggestion');
      if (cs.status !== 'draft' && cs.status !== 'sent_back') throw badState('this suggestion has been sent for review; it can no longer be edited');
      const registry = await this.registry(tx);
      if (!registry.has(input.type)) throw invalid(`unknown entity type "${input.type}"`);
      const id = input.id ?? newId();
      if (!isEntityId(id)) throw invalid(`"${id}" is not an entity id`);
      const existing = await one<{ type: string }>(tx, 'SELECT type FROM entity WHERE id = $1', [id]);
      if (existing && existing.type !== input.type) throw invalid(`${id} is a ${existing.type}, not a ${input.type}`);
      if (!existing) {
        if (input.data === null) throw notFound(`item ${id}`);
        await tx.query('INSERT INTO entity (id, type) VALUES ($1, $2)', [id, input.type]);
      }
      const parent = await this.currentFor(tx, cs, id);
      if (input.data === null && (!parent || parent.data === null)) throw badState(`${id} is already deleted`);
      let path = input.path === undefined ? (parent?.path ?? null) : input.path;
      if (path !== null) {
        path = path.toLowerCase();
        if (!isEntityPath(path)) throw invalid(`"${path}" is not a path: lower-case letters, digits and hyphens between slashes`);
      }
      // A body in the markup kept before words had structure is taken in as structured words (legacyWords.ts).
      const data = input.data === null ? null : withStructuredBody(input.data);
      const hash = await contentHash({ type: input.type, data, path });
      if (parent && parent.hash === hash) return id; // no change
      await tx.query(
        `INSERT INTO revision (entity_id, entity_type, parent_rev, data, path, hash, changeset_id, author)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, input.type, parent?.id ?? null, data === null ? null : JSON.stringify(data), path, hash, cs.id, by],
      );
      return id;
    });
  }

  /** The latest version of each item a suggestion changes, with the version it was made from. */
  async proposals(changesetId: number, db: Db = this.db): Promise<Proposal[]> {
    const { rows } = await db.query<RevisionRow & { base_rev: number | null }>(
      `SELECT DISTINCT ON (r.entity_id) r.*,
              (SELECT f.parent_rev FROM revision f WHERE f.changeset_id = r.changeset_id AND f.entity_id = r.entity_id ORDER BY f.id ASC LIMIT 1) AS base_rev
       FROM revision r WHERE r.changeset_id = $1 AND r.merge_rev IS NULL ORDER BY r.entity_id, r.id DESC`,
      [changesetId],
    );
    return rows.map(({ base_rev, ...rev }) => ({ entityId: rev.entity_id, type: rev.entity_type, baseRev: base_rev, rev }));
  }

  /** The reviewer's view: each item before and after, field by field, and what clashes with main as it is now. */
  async review(changesetId: number): Promise<{ changeset: ChangesetRow; entries: ChangeEntry[]; reviews: unknown[] }> {
    const cs = await this.changeset(changesetId);
    const proposals = await this.proposals(changesetId);
    const entries: ChangeEntry[] = [];
    for (const p of proposals) {
      const current = await this.targetRev(this.db, cs.project_id, p.entityId);
      const base = p.baseRev === null ? null : await this.revision(p.baseRev);
      const before = current?.data ?? null;
      const result = current?.id === p.baseRev ? { merged: p.rev.data, conflicts: [] } : threeWayMerge(base?.data ?? null, before, p.rev.data);
      entries.push({ entityId: p.entityId, type: p.type, before, after: p.rev.data, changes: diffData(before, p.rev.data), conflicts: result.conflicts });
    }
    const { rows: reviews } = await this.db.query('SELECT * FROM review WHERE changeset_id = $1 ORDER BY created_at', [changesetId]);
    return { changeset: cs, entries, reviews };
  }

  /** Where a merge would land: the project's version, or main's. */
  private async targetRev(db: Db, project: number | null, id: EntityId): Promise<RevisionRow | null> {
    if (project !== null) {
      const head = await one<{ rev_id: number }>(db, 'SELECT rev_id FROM project_head WHERE project_id = $1 AND entity_id = $2', [project, id]);
      if (head) return this.revision(head.rev_id, db);
    }
    const entity = await one<{ main_rev: number | null }>(db, 'SELECT main_rev FROM entity WHERE id = $1', [id]);
    return entity?.main_rev ? this.revision(entity.main_rev, db) : null;
  }

  /**
   * "Send for review": runs the automatic checks and opens the suggestion.
   * A trusted person's line fixes in open sets go live at once, and are
   * reviewed after.
   */
  async submit(changesetId: number, by: string): Promise<ChangesetRow> {
    const result = await this.db.transaction(async (tx) => {
      const cs = await this.changeset(changesetId, tx);
      if (cs.author !== by) throw forbidden('only its author sends a suggestion for review');
      if (cs.status !== 'draft' && cs.status !== 'sent_back') throw badState(`this suggestion is ${cs.status}`);
      const proposals = await this.proposals(cs.id, tx);
      if (proposals.length === 0) throw badState('this suggestion changes nothing yet');
      const checks = await this.runChecks(tx, cs, proposals);
      await tx.query("UPDATE changeset SET status = 'open', submitted_at = now(), checks = $2 WHERE id = $1", [cs.id, JSON.stringify(checks)]);
      const author = await this.requireAccount(cs.author, tx);
      const sets = await this.setsOfProposals(tx, proposals);
      const live =
        cs.project_id === null && !checks.some((c) => c.status === 'fail' && BLOCKING_CHECKS.has(c.check)) && mayGoLive(author, { types: new Set(proposals.map((p) => p.type)), sets });
      await suggestionSubmitted(tx, {
        id: cs.id,
        by,
        entityIds: proposals.map((p) => p.entityId),
        setIds: sets.map((s) => s.id),
        keepers: [...new Set(sets.flatMap((s) => s.keepers))],
        live,
        authorIsBot: author.is_bot,
      });
      return { live };
    });
    if (result.live) {
      await this.db.query("UPDATE changeset SET kind = 'live', post_review = 'pending' WHERE id = $1", [changesetId]);
      await this.mergeInternal(changesetId, by, {}, { skipPermission: true });
    }
    return this.changeset(changesetId);
  }

  /** Withdraws a suggestion that has not been merged. */
  async withdraw(changesetId: number, by: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const cs = await this.changeset(changesetId, tx);
      const actor = await this.requireAccount(by, tx);
      if (cs.author !== by && !actor.is_steward) throw forbidden('only its author withdraws a suggestion');
      if (cs.status === 'merged' || cs.status === 'withdrawn') throw badState(`this suggestion is ${cs.status}`);
      await tx.query("UPDATE changeset SET status = 'withdrawn', closed_at = now() WHERE id = $1", [cs.id]);
      await suggestionWithdrawn(tx, { id: cs.id, by });
    });
  }

  /** "Send back": returns a suggestion to its author with a note; they can edit and send it again. */
  async sendBack(changesetId: number, by: string, note: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const cs = await this.changeset(changesetId, tx);
      if (cs.status !== 'open') throw badState(`this suggestion is ${cs.status}`);
      await this.assertMayApprove(tx, cs, by);
      if (note.trim().length === 0) throw invalid('say what should change');
      const review = await one<{ id: number }>(tx, "INSERT INTO review (changeset_id, reviewer, verdict, body) VALUES ($1, $2, 'send_back', $3) RETURNING id", [cs.id, by, note]);
      await tx.query("UPDATE changeset SET status = 'sent_back' WHERE id = $1", [cs.id]);
      await reviewGiven(tx, { changesetId: cs.id, by, verdict: 'send_back', reviewId: Number(review!.id), body: note });
      await this.audit(tx, by, 'changeset.send_back', 'changeset', String(cs.id), { note });
    });
  }

  /**
   * A comment on a suggestion, report, item or project. On a suggestion it
   * may be about one field of one item in its change (`anchor`), and belong
   * to a review. The people it names are told, and on a suggestion or
   * report its writer follows it and its followers are told.
   */
  async comment(
    by: string,
    target: { kind: 'changeset' | 'report' | 'entity' | 'project'; id: string },
    body: string,
    parent?: number,
    options: { anchor?: { entity: EntityId; field: string }; review?: number } = {},
  ): Promise<number> {
    const account = await this.requireAccount(by);
    if (!canSuggest(account)) throw forbidden('this account cannot comment');
    if (body.trim().length === 0) throw invalid('an empty comment');
    return this.db.transaction(async (tx) => {
      const row = await one<{ id: number }>(tx, 'INSERT INTO comment (target_kind, target_id, parent_id, author, body, anchor, review_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id', [
        target.kind,
        target.id,
        parent ?? null,
        by,
        body,
        options.anchor ? JSON.stringify(options.anchor) : null,
        options.review ?? null,
      ]);
      const id = Number(row!.id);
      await commented(tx, { id, author: by, body, target, review: options.review !== undefined });
      return id;
    });
  }

  /**
   * A talk page (the plan's wiki model: every page has one): the comments
   * on a page, a suggestion, a report or a project, oldest first, with
   * their authors' names and what each answers. Hidden ones show only that
   * they were hidden.
   */
  async talk(target: { kind: 'changeset' | 'report' | 'entity' | 'project'; id: string }): Promise<Array<{ id: number; parent: number | null; author: string; authorName: string; body: string | null; at: string; hidden: boolean }>> {
    const { rows } = await this.db.query<{ id: number | string; parent_id: number | string | null; author: string; author_name: string | null; body: string; created_at: Date | string; hidden_at: Date | string | null }>(
      `SELECT c.id, c.parent_id, c.author, a.display_name AS author_name, c.body, c.created_at, c.hidden_at
       FROM comment c LEFT JOIN account a ON a.id = c.author WHERE c.target_kind = $1 AND c.target_id = $2 ORDER BY c.created_at, c.id`,
      [target.kind, target.id],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      parent: r.parent_id === null ? null : Number(r.parent_id),
      author: r.author,
      authorName: r.author_name ?? r.author,
      body: r.hidden_at ? null : r.body,
      at: new Date(r.created_at).toISOString(),
      hidden: r.hidden_at !== null,
    }));
  }

  /** Hides a comment (a steward, or its author): its words go, the thread stays whole. */
  async hideComment(id: number, by: string): Promise<void> {
    const actor = await this.requireAccount(by);
    const row = await one<{ author: string }>(this.db, 'SELECT author FROM comment WHERE id = $1', [id]);
    if (!row) throw notFound(`comment ${id}`);
    if (row.author !== by && !actor.is_steward) throw forbidden('a comment is hidden by its author or a steward');
    await this.db.query('UPDATE comment SET hidden_at = now() WHERE id = $1 AND hidden_at IS NULL', [id]);
    await this.audit(this.db, by, 'comment.hide', 'comment', String(id));
  }

  /**
   * "Approve": merges a suggestion into main (or into its project). Clashes
   * with main are decided by the reviewer through `resolutions`, keyed by
   * item id and then field path.
   */
  async merge(changesetId: number, by: string, resolutions: Record<string, Record<string, Resolution>> = {}, note?: string): Promise<{ commit: number | null }> {
    return this.mergeInternal(changesetId, by, resolutions, { note });
  }

  private async mergeInternal(
    changesetId: number,
    by: string,
    resolutions: Record<string, Record<string, Resolution>>,
    options: { skipPermission?: boolean; note?: string },
  ): Promise<{ commit: number | null }> {
    const result = await this.db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [MERGE_LOCK]);
      const cs = await this.changeset(changesetId, tx);
      if (cs.status !== 'open') throw badState(cs.status === 'draft' ? 'send the suggestion for review first' : `this suggestion is ${cs.status}`);
      if (!options.skipPermission) await this.assertMayApprove(tx, cs, by);
      const failed = cs.checks.filter((c) => c.status === 'fail' && BLOCKING_CHECKS.has(c.check));
      if (failed.length > 0) throw invalid(`failed checks: ${failed.map((c) => c.message).join('; ')}`, failed);
      const proposals = await this.proposals(cs.id, tx);
      if (!options.skipPermission) {
        const review = await one<{ id: number }>(tx, "INSERT INTO review (changeset_id, reviewer, verdict, body) VALUES ($1, $2, 'approve', $3) RETURNING id", [cs.id, by, options.note ?? null]);
        await reviewGiven(tx, { changesetId: cs.id, by, verdict: 'approve', reviewId: Number(review!.id), body: options.note });
      }
      if (cs.project_id !== null) {
        await this.applyToProject(tx, cs, proposals, by, resolutions);
        await tx.query("UPDATE changeset SET status = 'merged', closed_at = now() WHERE id = $1", [cs.id]);
        await suggestionMerged(tx, { id: cs.id, by, commit: null });
        return { commit: null, author: cs.author };
      }
      const seq = await this.applyToMain(tx, cs.id, proposals, by, cs.title, resolutions);
      await tx.query("UPDATE changeset SET status = 'merged', merged_commit = $2, closed_at = now() WHERE id = $1", [cs.id, seq]);
      await this.audit(tx, by, 'changeset.merge', 'changeset', String(cs.id), { commit: seq });
      await suggestionMerged(tx, { id: cs.id, by, commit: seq, live: options.skipPermission });
      return { commit: seq, author: cs.author };
    });
    await this.credit(result.author, 'approved');
    return { commit: result.commit };
  }

  /** A live change, reviewed after it went live: approved (it stays), or reverted. */
  async reviewLive(changesetId: number, by: string, verdict: 'approve' | 'revert', note?: string): Promise<{ revertChangeset?: number }> {
    const cs = await this.changeset(changesetId);
    if (cs.post_review !== 'pending') throw badState('this change is not waiting for review');
    await this.db.transaction(async (tx) => {
      await this.assertMayApprove(tx, cs, by);
      const review = await one<{ id: number }>(tx, 'INSERT INTO review (changeset_id, reviewer, verdict, body) VALUES ($1, $2, $3, $4) RETURNING id', [cs.id, by, verdict === 'approve' ? 'approve' : 'send_back', note ?? null]);
      await tx.query("UPDATE changeset SET post_review = 'done' WHERE id = $1", [cs.id]);
      await reviewGiven(tx, { changesetId: cs.id, by, verdict: verdict === 'approve' ? 'approve' : 'send_back', reviewId: Number(review!.id), body: note });
    });
    if (verdict === 'approve') return {};
    const revert = await this.revert(changesetId, by, note);
    return { revertChangeset: revert.changeset };
  }

  /** Whether `by` may approve or send back this suggestion, and if not, why not (for showing the buttons). */
  async mayApprove(changesetId: number, by: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const cs = await this.changeset(changesetId);
    try {
      await this.assertMayApprove(this.db, cs, by);
      return { ok: true };
    } catch (error) {
      if (error instanceof CatalogError) return { ok: false, reason: error.message };
      throw error;
    }
  }

  private async assertMayApprove(tx: Db, cs: ChangesetRow, by: string): Promise<void> {
    const reviewer = await this.requireAccount(by, tx);
    const proposals = await this.proposals(cs.id, tx);
    const sets = await this.setsOfProposals(tx, proposals);
    let projectKeepers: string[] | undefined;
    if (cs.project_id !== null) {
      const project = await one<{ keepers: string[] }>(tx, 'SELECT keepers FROM project WHERE id = $1', [cs.project_id]);
      projectKeepers = project?.keepers;
    }
    // Undoing a merged change is a keeper's own act; any other suggestion is approved by someone else.
    const decision = canApprove(reviewer, { author: cs.kind === 'revert' ? '' : cs.author, types: new Set(proposals.map((p) => p.type)), sets, projectKeepers });
    if (!decision.ok) throw forbidden(decision.reason);
  }

  /** Merges proposals into main as one commit. Returns the commit's number. */
  private async applyToMain(tx: Db, changesetId: number, proposals: Proposal[], by: string, message: string, resolutions: Record<string, Record<string, Resolution>>): Promise<number> {
    const registry = await this.registry(tx);
    const planned: Array<{ proposal: Proposal; current: RevisionRow | null; data: Json | null; path: string | null; direct: boolean }> = [];
    const unresolved: Conflict[] = [];
    for (const p of proposals) {
      const current = await this.targetRev(tx, null, p.entityId);
      if ((current?.id ?? null) === p.baseRev) {
        // A suggestion sent before words had structure lands with its body read as structured words.
        const data = withStructuredBody(p.rev.data);
        planned.push({ proposal: p, current, data, path: p.rev.path, direct: data === p.rev.data });
        continue;
      }
      const base = p.baseRev === null ? null : await this.revision(p.baseRev, tx);
      const merged = threeWayMerge(base?.data ?? null, current?.data ?? null, p.rev.data);
      let data = merged.merged;
      if (merged.conflicts.length > 0) {
        const decided = resolutions[p.entityId];
        const open = merged.conflicts.filter((c) => !decided?.[c.path]);
        if (open.length > 0) {
          unresolved.push(...open.map((c) => ({ ...c, path: `${p.entityId}${c.path}` })));
          continue;
        }
        data = resolveConflicts(merged, decided!);
      }
      data = withStructuredBody(data);
      // A path changed on one side only follows that side; changed on both, theirs wins unless the reviewer said otherwise.
      const path = (base?.path ?? null) === (current?.path ?? null) ? p.rev.path : (base?.path ?? null) === p.rev.path ? (current?.path ?? null) : p.rev.path;
      planned.push({ proposal: p, current, data, path, direct: false });
    }
    if (unresolved.length > 0) throw new UnresolvedConflictError(unresolved);

    // What main will hold once this lands, for checking the merged result.
    const landing = new Map(planned.map((x) => [x.proposal.entityId, x]));
    for (const x of planned) {
      if (x.data === null) continue;
      const valid = registry.validate(x.proposal.type, x.data);
      if (!valid.ok) throw invalid(`${x.proposal.entityId} would not be valid after merging: ${valid.issues.map((i) => `${i.path || '/'} ${i.message}`).join('; ')}`, valid.issues);
      for (const ref of referencesOf(x.proposal.type, x.data)) {
        const target = landing.get(ref.id);
        if (target) {
          if (target.data === null) throw invalid(`${x.proposal.entityId} points at ${ref.id}, which this change deletes`);
          continue;
        }
        const row = await one<{ type: string; deleted: boolean; main_rev: number | null }>(tx, 'SELECT type, deleted, main_rev FROM entity WHERE id = $1', [ref.id]);
        if (!row || row.deleted || row.main_rev === null) throw invalid(`${x.proposal.entityId} points at ${ref.id} (${ref.field}), which is not in the catalog`);
      }
      if (x.path !== null) {
        const taken = await one<{ id: string }>(tx, 'SELECT id FROM entity WHERE path = $1 AND id <> $2 AND NOT deleted', [x.path, x.proposal.entityId]);
        if (taken && !(landing.get(taken.id as EntityId)?.path !== x.path && landing.has(taken.id as EntityId))) throw invalid(`the path ${x.path} already belongs to ${taken.id}`);
      }
    }

    const commit = await one<{ seq: number }>(tx, 'INSERT INTO commit (changeset_id, merged_by, message) VALUES ($1, $2, $3) RETURNING seq', [changesetId, by, message]);
    const seq = commit!.seq;
    // Paths are released before they are taken, so two items may swap paths in one change.
    for (const x of planned) await tx.query('UPDATE entity SET path = NULL WHERE id = $1', [x.proposal.entityId]);
    for (const x of planned) {
      let revId = x.proposal.rev.id;
      if (!x.direct) {
        const hash = await contentHash({ type: x.proposal.type, data: x.data, path: x.path });
        const row = await one<{ id: number }>(
          tx,
          `INSERT INTO revision (entity_id, entity_type, parent_rev, merge_rev, data, path, hash, changeset_id, author)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [x.proposal.entityId, x.proposal.type, x.current?.id ?? null, x.proposal.rev.id, x.data === null ? null : JSON.stringify(x.data), x.path, hash, changesetId, by],
        );
        revId = row!.id;
      }
      await tx.query('INSERT INTO commit_change (commit_seq, entity_id, rev_id, prev_rev_id) VALUES ($1, $2, $3, $4)', [seq, x.proposal.entityId, revId, x.current?.id ?? null]);
      await this.updateMain(tx, x.proposal.entityId, x.proposal.type, revId, x.data, x.path, x.current?.path ?? null, seq);
    }
    return seq;
  }

  /** Points main at a new revision and refreshes what is derived from it: path, redirects, links, search text. */
  private async updateMain(tx: Db, id: EntityId, type: EntityType, revId: number, data: Json | null, path: string | null, oldPath: string | null, seq: number): Promise<void> {
    const deleted = data === null;
    await tx.query('UPDATE entity SET main_rev = $2, path = $3, deleted = $4, search_text = $5, updated_seq = $6 WHERE id = $1', [
      id,
      revId,
      deleted ? null : path,
      deleted,
      deleted ? null : searchTextOf(data),
      seq,
    ]);
    if (oldPath !== null && oldPath !== path) {
      await tx.query('INSERT INTO path_redirect (path, entity_id) VALUES ($1, $2) ON CONFLICT (path) DO UPDATE SET entity_id = EXCLUDED.entity_id, created_at = now()', [oldPath, id]);
    }
    if (path !== null) await tx.query('DELETE FROM path_redirect WHERE path = $1', [path]);
    await tx.query('DELETE FROM entity_ref WHERE from_id = $1', [id]);
    await tx.query('DELETE FROM entity_external_id WHERE entity_id = $1', [id]);
    if (!deleted) {
      const externalIds = (data as { externalIds?: Record<string, string> }).externalIds ?? {};
      for (const [key, value] of Object.entries(externalIds)) {
        if (typeof value === 'string') await tx.query('INSERT INTO entity_external_id (entity_id, key, value) VALUES ($1, $2, $3)', [id, key, value]);
      }
      const seen = new Set<string>();
      for (const ref of referencesOf(type, data)) {
        const key = `${ref.field}\u0000${ref.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await tx.query('INSERT INTO entity_ref (from_id, field, to_id) VALUES ($1, $2, $3)', [id, ref.field, ref.id]);
      }
    }
  }

  /** Merges a project's suggestion into the project's overlay rather than main. */
  private async applyToProject(tx: Db, cs: ChangesetRow, proposals: Proposal[], by: string, resolutions: Record<string, Record<string, Resolution>>): Promise<void> {
    const projectId = cs.project_id!;
    for (const p of proposals) {
      const head = await one<{ rev_id: number; base_rev: number | null }>(tx, 'SELECT rev_id, base_rev FROM project_head WHERE project_id = $1 AND entity_id = $2', [projectId, p.entityId]);
      const current = await this.targetRev(tx, projectId, p.entityId);
      let revId = p.rev.id;
      if ((current?.id ?? null) !== p.baseRev) {
        const base = p.baseRev === null ? null : await this.revision(p.baseRev, tx);
        const merged = threeWayMerge(base?.data ?? null, current?.data ?? null, p.rev.data);
        const decided = resolutions[p.entityId] ?? {};
        const open = merged.conflicts.filter((c) => !decided[c.path]);
        if (open.length > 0) throw new UnresolvedConflictError(open.map((c) => ({ ...c, path: `${p.entityId}${c.path}` })));
        const data = merged.conflicts.length > 0 ? resolveConflicts(merged, decided) : merged.merged;
        const hash = await contentHash({ type: p.type, data, path: p.rev.path });
        const row = await one<{ id: number }>(
          tx,
          `INSERT INTO revision (entity_id, entity_type, parent_rev, merge_rev, data, path, hash, changeset_id, author)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
          [p.entityId, p.type, current?.id ?? null, p.rev.id, data === null ? null : JSON.stringify(data), p.rev.path, hash, cs.id, by],
        );
        revId = row!.id;
      }
      if (head) {
        await tx.query('UPDATE project_head SET rev_id = $3 WHERE project_id = $1 AND entity_id = $2', [projectId, p.entityId, revId]);
      } else {
        // The first change a project makes to an item remembers main's version then: the base of the project's own merge.
        const main = await one<{ main_rev: number | null }>(tx, 'SELECT main_rev FROM entity WHERE id = $1', [p.entityId]);
        await tx.query('INSERT INTO project_head (project_id, entity_id, rev_id, base_rev) VALUES ($1, $2, $3, $4)', [projectId, p.entityId, revId, main?.main_rev ?? null]);
      }
    }
  }

  // ------------------------------------------------------------ history and revert

  /**
   * Undoes a merged suggestion in one step: a new suggestion that puts each
   * item it changed back as it was, merged at once when `by` may approve it.
   * Later changes to the same items are kept where they do not clash.
   */
  async revert(changesetId: number, by: string, reason?: string): Promise<{ changeset: number; commit: number | null }> {
    const target = await this.changeset(changesetId);
    if (target.status !== 'merged' || target.merged_commit === null) throw badState('only a suggestion merged into main can be reverted');
    const { rows: changes } = await this.db.query<{ entity_id: EntityId; rev_id: number; prev_rev_id: number | null; entity_type: EntityType }>(
      'SELECT cc.entity_id, cc.rev_id, cc.prev_rev_id, e.type AS entity_type FROM commit_change cc JOIN entity e ON e.id = cc.entity_id WHERE cc.commit_seq = $1',
      [target.merged_commit],
    );
    const revert = await this.createChangeset(by, { title: `Revert: ${target.title}`, description: reason, kind: 'revert' });
    await this.db.transaction(async (tx) => {
      await tx.query('UPDATE changeset SET reverts_changeset = $2 WHERE id = $1', [revert.id, target.id]);
      for (const change of changes) {
        const undone = await this.revision(change.rev_id, tx);
        const previous = change.prev_rev_id === null ? null : await this.revision(change.prev_rev_id, tx);
        const data = previous?.data ?? null;
        const path = previous?.path ?? null;
        // Made from the version being undone, so the merge keeps what changed since.
        await tx.query(
          `INSERT INTO revision (entity_id, entity_type, parent_rev, data, path, hash, changeset_id, author)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [change.entity_id, change.entity_type, undone!.id, data === null ? null : JSON.stringify(data), path, await contentHash({ type: change.entity_type, data, path }), revert.id, by],
        );
      }
      await tx.query("UPDATE changeset SET status = 'open', submitted_at = now() WHERE id = $1", [revert.id]);
    });
    let commit: number | null = null;
    try {
      commit = (await this.mergeInternal(revert.id, by, {}, { skipPermission: false, note: reason })).commit;
    } catch (error) {
      // Not theirs to merge (or it clashes): the revert waits for review as a suggestion.
      if (!(error instanceof CatalogError && error.code === 'forbidden') && !(error instanceof UnresolvedConflictError)) throw error;
    }
    if (commit !== null) {
      await this.credit(target.author, 'reverted');
      await suggestionReverted(this.db, { id: target.id, by, revert: revert.id });
    }
    return { changeset: revert.id, commit };
  }

  /** "Restore this version": a suggestion putting an item back as it was at one revision. */
  async restore(entityId: EntityId, revId: number, by: string): Promise<number> {
    const rev = await this.revision(revId);
    if (!rev || rev.entity_id !== entityId) throw notFound(`version ${revId} of ${entityId}`);
    const cs = await this.createChangeset(by, { title: `Restore ${entityId} to version ${revId}` });
    await this.putRevision(cs.id, by, { id: entityId, type: rev.entity_type, data: rev.data, path: rev.path });
    await this.submit(cs.id, by);
    return cs.id;
  }

  // ------------------------------------------------------------ projects

  /** Opens a project (a branch): suggestions made in it merge into it, and it merges into main when done. Keepers and stewards. */
  async createProject(by: string, input: { slug: string; name: string; goal?: string; set?: EntityId; keepers?: string[] }): Promise<number> {
    return this.db.transaction(async (tx) => {
      const actor = await this.requireAccount(by, tx);
      if (input.set) {
        const set = await this.setInfo(tx, input.set);
        if (!set) throw notFound(`set ${input.set}`);
        if (!actor.is_steward && !set.keepers.includes(by)) throw forbidden('projects are opened by the set\'s keepers');
      } else if (!actor.is_steward) {
        throw forbidden('a project outside a set is opened by a steward');
      }
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.slug)) throw invalid('a project slug is lower-case letters, digits and hyphens');
      const row = await one<{ id: number }>(
        tx,
        `INSERT INTO project (slug, name, goal, set_id, keepers, base_commit, created_by)
         VALUES ($1, $2, $3, $4, $5, (SELECT coalesce(max(seq), 0) FROM commit), $6) RETURNING id`,
        [input.slug, input.name, input.goal ?? null, input.set ?? null, input.keepers ?? [by], by],
      );
      await this.audit(tx, by, 'project.open', 'project', String(row!.id));
      return row!.id;
    });
  }

  /**
   * The Missing board's third list: sefarim with no printing and no scan
   * of one, most-browsed first (by how many sichos they hold).
   */
  async worksWithoutScans(limit = 50): Promise<{ total: number; items: EntityView[] }> {
    const without = `FROM entity e JOIN revision r ON r.id = e.main_rev
       WHERE e.type = 'work' AND NOT e.deleted
         AND NOT EXISTS (SELECT 1 FROM entity_ref p JOIN entity pe ON pe.id = p.from_id AND pe.type = 'publication' AND NOT pe.deleted WHERE p.to_id = e.id AND p.field = 'work')`;
    const total = await one<{ n: number }>(this.db, `SELECT count(*)::int AS n ${without}`);
    const { rows } = await this.db.query<RevisionRow>(
      `SELECT r.* ${without}
       ORDER BY (SELECT count(*) FROM entity_ref u WHERE u.to_id = e.id AND u.field = 'work') DESC, e.path LIMIT ${Math.min(Math.max(limit, 1), 200)}`,
    );
    return { total: total?.n ?? 0, items: rows.map((r) => ({ id: r.entity_id, type: r.entity_type, path: r.path, rev: r.id, data: r.data! })) };
  }

  /**
   * Files Sichos-Kodesh's archive could not get from upstream (migration
   * 0009): a Drive link that is gone, a recording the CDN no longer
   * gives. Each with the item it belongs to, when RebbeHub has it, so
   * someone who has the file can add it there.
   */
  async archiveGaps(limit = 50): Promise<{ total: number; items: Array<ArchiveGapRow & { entity: EntityView | null }> }> {
    const total = await one<{ n: number }>(this.db, 'SELECT count(*)::int AS n FROM archive_gap');
    const { rows } = await this.db.query<ArchiveGapRow & { rev_id: number | null; rev_type: EntityType | null; rev_path: string | null; rev_data: Json | null }>(
      `SELECT g.collection, g.item_id, g.kind, g.role, g.source, g.url, g.label, g.hebrew_date, g.status, g.http_status, g.error, g.attempts, g.checked_at, g.entity_id,
              r.id AS rev_id, r.entity_type AS rev_type, r.path AS rev_path, r.data AS rev_data
       FROM archive_gap g LEFT JOIN entity e ON e.id = g.entity_id AND NOT e.deleted LEFT JOIN revision r ON r.id = e.main_rev
       ORDER BY g.hebrew_date NULLS LAST, g.collection, g.item_id, g.role LIMIT ${Math.min(Math.max(limit, 1), 500)}`,
    );
    return {
      total: total?.n ?? 0,
      items: rows.map(({ rev_id, rev_type, rev_path, rev_data, ...gap }) => ({
        ...gap,
        entity: rev_id !== null && rev_type && rev_data && gap.entity_id ? { id: gap.entity_id as EntityId, type: rev_type, path: rev_path, rev: rev_id, data: rev_data } : null,
      })),
    };
  }

  /** Replaces the archive's list of files it could not get (`rebbehub archive-gaps`). */
  async loadArchiveGaps(gaps: Array<ArchiveGapRow & { source_id: string }>): Promise<number> {
    return this.db.transaction(async (tx) => {
      await tx.query('DELETE FROM archive_gap');
      for (const g of gaps) {
        await tx.query(
          `INSERT INTO archive_gap (collection, item_id, kind, source_id, role, entity_id, source, url, label, hebrew_date, status, http_status, error, attempts, checked_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) ON CONFLICT DO NOTHING`,
          [g.collection, g.item_id, g.kind, g.source_id, g.role, g.entity_id, g.source, g.url, g.label, g.hebrew_date, g.status, g.http_status, g.error, g.attempts, g.checked_at],
        );
      }
      return gaps.length;
    });
  }

  /**
   * A project that works through a gap (migration 0007): opened by a
   * steward or the set's keepers, with a name, a goal in words, and its
   * focus: which farbrengens (a year) lack what (recordings or texts).
   */
  async openFocusProject(by: string, input: { slug: string; name: string; goal?: string; set?: EntityId; focus: ProjectFocus }): Promise<number> {
    if (!['recordings', 'texts', 'sync', 'proofreading'].includes(input.focus.missing)) throw invalid('a project works through farbrengens missing recordings or texts, recordings to sync, or a scan to proofread');
    if (input.focus.missing === 'proofreading') {
      const scan = input.focus.scan ? await this.get(input.focus.scan) : null;
      if (!scan || scan.type !== 'scan') throw invalid('a proofreading project names its scan');
      if (input.focus.level !== undefined && input.focus.level !== 1 && input.focus.level !== 2) throw invalid('level is 1 (proofread once) or 2 (twice)');
    }
    if (input.focus.within !== undefined && !/^\d{4}(-(0[1-9]|1[0-2]|06A|06B))?$/.test(input.focus.within)) throw invalid('within is a year (5745) or a month (5745-05)');
    const id = await this.createProject(by, input);
    await this.db.query('UPDATE project SET focus = $2 WHERE id = $1', [id, JSON.stringify(input.focus)]);
    return id;
  }

  /** Projects with their progress: how many of the farbrengens in their focus now have what was missing. */
  async projects(options: { slug?: string; status?: 'open' | 'merged' | 'closed' } = {}): Promise<ProjectView[]> {
    const params: unknown[] = [];
    const where: string[] = ['focus IS NOT NULL'];
    if (options.slug) where.push(`slug = $${params.push(options.slug)}`);
    if (options.status) where.push(`status = $${params.push(options.status)}`);
    const { rows } = await this.db.query<{ id: number; slug: string; name: string; goal: string | null; set_id: string | null; keepers: string[]; status: ProjectView['status']; focus: ProjectFocus; created_by: string; created_at: Date | string; creator: string | null }>(
      `SELECT p.*, a.display_name AS creator FROM project p LEFT JOIN account a ON a.id = p.created_by WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC`,
      params,
    );
    return Promise.all(
      rows.map(async (p) => {
        const counts = await focusCounts(this, p.focus);
        return {
          id: Number(p.id),
          slug: p.slug,
          name: p.name,
          goal: p.goal,
          set: p.set_id,
          keepers: p.keepers,
          status: p.status,
          focus: p.focus,
          createdBy: p.created_by,
          creatorName: p.creator,
          createdAt: new Date(p.created_at).toISOString(),
          total: counts.total,
          done: counts.done,
        };
      }),
    );
  }

  /** Closes a project (done, or given up): its keepers or a steward. */
  async closeProject(projectId: number, by: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const actor = await this.requireAccount(by, tx);
      const project = await one<{ keepers: string[]; status: string }>(tx, 'SELECT keepers, status FROM project WHERE id = $1', [projectId]);
      if (!project) throw notFound(`project ${projectId}`);
      if (!actor.is_steward && !project.keepers.includes(by)) throw forbidden("a project is closed by its keepers");
      await tx.query("UPDATE project SET status = 'closed' WHERE id = $1 AND status = 'open'", [projectId]);
      await this.audit(tx, by, 'project.close', 'project', String(projectId));
    });
  }

  /** What merging a project into main would clash on, item by item. */
  async projectConflicts(projectId: number): Promise<Conflict[]> {
    const conflicts: Conflict[] = [];
    for (const p of await this.projectProposals(this.db, projectId)) {
      const current = await this.targetRev(this.db, null, p.entityId);
      if ((current?.id ?? null) === p.baseRev) continue;
      const base = p.baseRev === null ? null : await this.revision(p.baseRev);
      conflicts.push(...threeWayMerge(base?.data ?? null, current?.data ?? null, p.rev.data).conflicts.map((c) => ({ ...c, path: `${p.entityId}${c.path}` })));
    }
    return conflicts;
  }

  private async projectProposals(db: Db, projectId: number): Promise<Proposal[]> {
    const { rows } = await db.query<RevisionRow & { base_rev: number | null }>(
      'SELECT r.*, h.base_rev FROM project_head h JOIN revision r ON r.id = h.rev_id WHERE h.project_id = $1 ORDER BY h.entity_id',
      [projectId],
    );
    return rows.map(({ base_rev, ...rev }) => ({ entityId: rev.entity_id, type: rev.entity_type, baseRev: base_rev, rev }));
  }

  /** Merges a finished project into main as one commit. */
  async mergeProject(projectId: number, by: string, resolutions: Record<string, Record<string, Resolution>> = {}): Promise<number> {
    return this.db.transaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock($1)', [MERGE_LOCK]);
      const project = await one<{ id: number; name: string; status: string; set_id: EntityId | null; keepers: string[]; created_by: string }>(tx, 'SELECT * FROM project WHERE id = $1', [projectId]);
      if (!project) throw notFound(`project ${projectId}`);
      if (project.status !== 'open') throw badState('this project is closed');
      const actor = await this.requireAccount(by, tx);
      const proposals = await this.projectProposals(tx, projectId);
      if (proposals.length === 0) throw badState('this project has changed nothing yet');
      const sets = await this.setsOfProposals(tx, proposals);
      const decision = canApprove(actor, { author: '', types: new Set(proposals.map((p) => p.type)), sets, projectKeepers: project.keepers });
      if (!decision.ok) throw forbidden(decision.reason);
      const carrier = await one<{ id: number }>(
        tx,
        `INSERT INTO changeset (title, author, status, kind, project_id, base_commit, submitted_at)
         VALUES ($1, $2, 'open', 'suggestion', $3, (SELECT coalesce(max(seq), 0) FROM commit), now()) RETURNING id`,
        [`Project: ${project.name}`, by, projectId],
      );
      const seq = await this.applyToMain(tx, carrier!.id, proposals, by, `Project: ${project.name}`, resolutions);
      await tx.query("UPDATE changeset SET status = 'merged', merged_commit = $2, closed_at = now() WHERE id = $1", [carrier!.id, seq]);
      await tx.query("UPDATE project SET status = 'merged', merged_commit = $2 WHERE id = $1", [projectId, seq]);
      await this.audit(tx, by, 'project.merge', 'project', String(projectId), { commit: seq });
      return seq;
    });
  }

  // ------------------------------------------------------------ reports, follows

  /**
   * "Report a problem": no account needed. Lands in the inbox of the item's
   * set, whose keepers are told. A report is read by everyone, kept as an
   * issue, unless it is `private`: a rights claim or something offensive
   * always is (PRIVATE_REASONS).
   */
  async report(input: { entityId?: EntityId; reason: ReportReason; note?: string; reporter?: string; reporterHash?: string; title?: string; private?: boolean }): Promise<number> {
    return this.db.transaction(async (tx) => {
      let setId: string | null = null;
      if (input.entityId) {
        const main = await this.targetRev(tx, null, input.entityId);
        if (!main || main.data === null) throw notFound(`item ${input.entityId}`);
        const sets = await this.setsOf(tx, main.entity_type, main.data);
        setId = sets[0]?.id ?? null;
      }
      if (input.note && input.note.length > 10_000) throw invalid('a report note is at most 10,000 characters');
      const title = input.title?.replace(/\s+/g, ' ').trim().slice(0, 200) || null;
      const row = await one<{ id: number }>(
        tx,
        'INSERT INTO report (entity_id, set_id, reason, note, reporter, reporter_hash, title, private) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
        [input.entityId ?? null, setId, input.reason, input.note ?? null, input.reporter ?? null, input.reporterHash ?? null, title, (input.private ?? false) || PRIVATE_REASONS.has(input.reason)],
      );
      const id = Number(row!.id);
      await reportOpened(tx, { id, reporter: input.reporter ?? null, note: input.note ?? null, entityId: input.entityId ?? null, setId });
      return id;
    });
  }

  /** A set's inbox of open reports (all sets, and reports on no set, for stewards). */
  async reports(options: { set?: EntityId; status?: 'open' | 'resolved' | 'dismissed'; limit?: number } = {}): Promise<unknown[]> {
    const params: unknown[] = [options.status ?? 'open'];
    const where = ['status = $1'];
    if (options.set) where.push(`set_id = $${params.push(options.set)}`);
    const { rows } = await this.db.query(`SELECT * FROM report WHERE ${where.join(' AND ')} ORDER BY created_at LIMIT ${Math.min(options.limit ?? 100, 500)}`, params);
    return rows;
  }

  async closeReport(reportId: number, by: string, outcome: 'resolved' | 'dismissed', resolution?: { changeset?: number; note?: string }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const report = await one<{ set_id: EntityId | null; status: string }>(tx, 'SELECT set_id, status FROM report WHERE id = $1', [reportId]);
      if (!report) throw notFound(`report ${reportId}`);
      if (report.status !== 'open') throw badState(`this report is ${report.status}`);
      const actor = await this.requireAccount(by, tx);
      const set = report.set_id ? await this.setInfo(tx, report.set_id) : null;
      if (!actor.is_steward && !(set && set.keepers.includes(by))) throw forbidden("reports are closed by the set's keepers");
      await tx.query('UPDATE report SET status = $2, resolved_by = $3, resolution_changeset = $4, closed_at = now(), updated_at = now() WHERE id = $1', [reportId, outcome, by, resolution?.changeset ?? null]);
      await this.audit(tx, by, `report.${outcome}`, 'report', String(reportId), { note: resolution?.note });
      await reportStateChanged(tx, { id: reportId, by, outcome, note: resolution?.note, changeset: resolution?.changeset });
    });
  }

  async follow(accountId: string, target: { kind: 'entity' | 'set' | 'project' | 'changeset' | 'report'; id: string }, on = true): Promise<void> {
    if (on) {
      await this.db.query('INSERT INTO follow (account_id, target_kind, target_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [accountId, target.kind, target.id]);
    } else {
      await this.db.query('DELETE FROM follow WHERE account_id = $1 AND target_kind = $2 AND target_id = $3', [accountId, target.kind, target.id]);
    }
  }

  /** What a person follows: items and sets, newest first. */
  async follows(accountId: string): Promise<Array<{ kind: 'entity' | 'set' | 'project' | 'changeset' | 'report'; id: string; since: string }>> {
    const { rows } = await this.db.query<{ target_kind: 'entity' | 'set' | 'project' | 'changeset' | 'report'; target_id: string; created_at: Date | string }>(
      'SELECT target_kind, target_id, created_at FROM follow WHERE account_id = $1 ORDER BY created_at DESC',
      [accountId],
    );
    return rows.map((r) => ({ kind: r.target_kind, id: r.target_id, since: new Date(r.created_at).toISOString() }));
  }

  /**
   * What changed lately in what a person follows: the item itself, and what
   * belongs to it (a sefer's sichos, a farbrengen's recordings, a set's
   * items). One line per merge, with how many of the followed things it
   * changed; changes from before they followed are left out. For email
   * notifications: only merges after `afterSeq`, and none of the person's own.
   */
  async followFeed(
    accountId: string,
    limit = 20,
    options: { afterSeq?: number; notOwn?: boolean } = {},
  ): Promise<Array<{ seq: number; at: string; message: string; authorName: string; authorIsBot: boolean; entityId: string; changes: number }>> {
    const { rows } = await this.db.query<{ seq: string; at: Date | string; message: string; author_name: string; author_is_bot: boolean; entity_id: string; changes: number }>(
      `WITH targets AS (SELECT target_id, created_at FROM follow WHERE account_id = $1 AND target_kind IN ('entity', 'set')),
            touched AS (
              SELECT cc.commit_seq, cc.entity_id, t.created_at FROM commit_change cc JOIN targets t ON t.target_id = cc.entity_id
              UNION
              SELECT cc.commit_seq, cc.entity_id, t.created_at FROM entity_ref r JOIN targets t ON t.target_id = r.to_id
                JOIN commit_change cc ON cc.entity_id = r.from_id
              WHERE r.field IN ('work', 'event', 'sets')
            )
       SELECT c.seq, c.at, c.message, a.display_name AS author_name, a.is_bot AS author_is_bot, min(x.entity_id) AS entity_id, count(*)::int AS changes
       FROM touched x JOIN commit c ON c.seq = x.commit_seq JOIN changeset cs ON cs.id = c.changeset_id JOIN account a ON a.id = cs.author
       WHERE c.at >= x.created_at AND c.seq > $2 AND NOT ($3 AND cs.author = $1)
       GROUP BY c.seq, c.at, c.message, a.display_name, a.is_bot
       ORDER BY c.seq DESC LIMIT ${Math.min(Math.max(limit, 1), 100)}`,
      [accountId, options.afterSeq ?? 0, options.notOwn ?? false],
    );
    return rows.map((r) => ({ seq: Number(r.seq), at: new Date(r.at).toISOString(), message: r.message, authorName: r.author_name, authorIsBot: r.author_is_bot, entityId: r.entity_id, changes: r.changes }));
  }

  /** Who is told when this item changes: its own followers and those of its sets. */
  async followersOfEntity(id: EntityId): Promise<string[]> {
    const main = await this.targetRev(this.db, null, id);
    const sets = main?.data ? (await this.setsOf(this.db, main.entity_type, main.data)).map((s) => s.id) : [];
    const { rows } = await this.db.query<{ account_id: string }>(
      "SELECT DISTINCT account_id FROM follow WHERE (target_kind = 'entity' AND target_id = $1) OR (target_kind = 'set' AND target_id = ANY($2::text[])) ORDER BY account_id",
      [id, sets],
    );
    return rows.map((r) => r.account_id);
  }

  // ------------------------------------------------------------ editions

  /** Tags the head of main as a catalog edition (`2026.40`: year and ISO week). Stewards only. */
  async tagEdition(by: string, options: { tag?: string; notes?: string } = {}): Promise<{ tag: string; commit: number }> {
    return this.db.transaction(async (tx) => {
      const actor = await this.requireAccount(by, tx);
      if (!actor.is_steward) throw forbidden('catalog editions are made by stewards');
      const seq = await this.head(tx);
      if (seq === 0) throw badState('the catalog is empty');
      let tag = options.tag ?? isoWeekTag((this.options.now ?? (() => new Date()))());
      if (!options.tag) {
        for (let n = 1; await one(tx, 'SELECT 1 FROM catalog_edition WHERE tag = $1', [tag]); n++) tag = `${isoWeekTag((this.options.now ?? (() => new Date()))())}.${n}`;
      }
      await tx.query('INSERT INTO catalog_edition (tag, commit_seq, created_by, notes) VALUES ($1, $2, $3, $4)', [tag, seq, by, options.notes ?? null]);
      await this.audit(tx, by, 'edition.tag', 'edition', tag, { commit: seq });
      return { tag, commit: seq };
    });
  }

  async editions(): Promise<Array<{ tag: string; commit_seq: number; created_at: string; notes: string | null; manifest: unknown }>> {
    const { rows } = await this.db.query<{ tag: string; commit_seq: number; created_at: string; notes: string | null; manifest: unknown }>(
      'SELECT tag, commit_seq, created_at, notes, manifest FROM catalog_edition ORDER BY commit_seq DESC',
    );
    return rows;
  }

  /** Records the signed manifest of an edition's dumps. */
  async setEditionManifest(tag: string, manifest: unknown): Promise<void> {
    await this.db.query('UPDATE catalog_edition SET manifest = $2 WHERE tag = $1', [tag, JSON.stringify(manifest)]);
  }

  // ------------------------------------------------------------ snapshots (for the git mirror and dumps)

  /** Every live item as of a commit, in id order, a page at a time. */
  async snapshot(at: number, options: { after?: EntityId; limit?: number } = {}): Promise<EntityView[]> {
    const { rows } = await this.db.query<RevisionRow>(
      `SELECT r.* FROM (
         SELECT DISTINCT ON (entity_id) entity_id, rev_id FROM commit_change
         WHERE commit_seq <= $1 AND entity_id > $2 ORDER BY entity_id, commit_seq DESC
       ) latest JOIN revision r ON r.id = latest.rev_id
       WHERE r.data IS NOT NULL ORDER BY latest.entity_id LIMIT ${Math.min(options.limit ?? 1000, 10_000)}`,
      [at, options.after ?? ''],
    );
    return rows.map((r) => ({ id: r.entity_id, type: r.entity_type, path: r.path, rev: r.id, data: r.data! }));
  }

  /**
   * The children of an item as of a commit, in their order: a text's
   * segments (`'segment', 'text', id`), an alignment's spans. Deleted and
   * moved-away children are left out.
   */
  async childrenAt(at: number, childType: 'segment' | 'alignment-span', parentField: 'text' | 'alignment', parentId: EntityId): Promise<EntityView[]> {
    // Both names are from the fixed unions above, never from input, so they are safe to write into the SQL (and let it use the partial indexes).
    const { rows } = await this.db.query<RevisionRow>(
      `SELECT r.* FROM (
         SELECT DISTINCT ON (cc.entity_id) cc.entity_id, cc.rev_id FROM commit_change cc
         WHERE cc.commit_seq <= $1 AND cc.entity_id IN (SELECT DISTINCT entity_id FROM revision WHERE entity_type = '${childType}' AND data->>'${parentField}' = $2)
         ORDER BY cc.entity_id, cc.commit_seq DESC
       ) latest JOIN revision r ON r.id = latest.rev_id
       WHERE r.data IS NOT NULL AND r.data->>'${parentField}' = $2
       ORDER BY coalesce(r.data->>'order', lpad(r.data->>'startMs', 12, '0')) COLLATE "C", r.entity_id`,
      [at, parentId],
    );
    return rows.map((r) => ({ id: r.entity_id, type: r.entity_type, path: r.path, rev: r.id, data: r.data! }));
  }

  /** The commits after `since`, each with the items it changed (null data: deleted), for incremental export. */
  async commitsSince(since: number, limit = 100): Promise<Array<{ seq: number; at: string; message: string; mergedBy: string; author: string; changes: Array<{ id: EntityId; type: EntityType; path: string | null; rev: number; data: Json | null }> }>> {
    const { rows: commits } = await this.db.query<{ seq: number; at: string; message: string; merged_by: string; author: string }>(
      'SELECT c.seq, c.at, c.message, c.merged_by, cs.author FROM commit c JOIN changeset cs ON cs.id = c.changeset_id WHERE c.seq > $1 ORDER BY c.seq LIMIT $2',
      [since, limit],
    );
    const out = [];
    for (const c of commits) {
      const { rows } = await this.db.query<RevisionRow>('SELECT r.* FROM commit_change cc JOIN revision r ON r.id = cc.rev_id WHERE cc.commit_seq = $1 ORDER BY cc.entity_id', [c.seq]);
      out.push({ seq: c.seq, at: c.at, message: c.message, mergedBy: c.merged_by, author: c.author, changes: rows.map((r) => ({ id: r.entity_id, type: r.entity_type, path: r.path, rev: r.id, data: r.data })) });
    }
    return out;
  }

  // ------------------------------------------------------------ checks

  private async runChecks(tx: Db, cs: ChangesetRow, proposals: Proposal[]): Promise<Check[]> {
    const registry = await this.registry(tx);
    const checks: Check[] = [];
    const inChange = new Map(proposals.map((p) => [p.entityId, p]));
    for (const p of proposals) {
      const id = p.entityId;
      if (p.rev.data === null) {
        const { rows } = await tx.query<{ from_id: string }>('SELECT from_id FROM entity_ref WHERE to_id = $1 LIMIT 5', [id]);
        const still = rows.filter((r) => inChange.get(r.from_id as EntityId)?.rev.data !== null);
        if (still.length > 0) checks.push({ check: 'references', status: 'fail', entityId: id, message: `${id} is still pointed at by ${still.map((r) => r.from_id).join(', ')}` });
        continue;
      }
      if (p.type === 'schema') {
        // A new schema must itself be usable before it governs anything.
        const schema = p.rev.data as unknown as SchemaData;
        try {
          new SchemaRegistry(new Map([[schema.entityType, schema.jsonSchema]])).validate(schema.entityType, {});
        } catch (error) {
          checks.push({ check: 'schema', status: 'fail', entityId: id, message: `the JSON Schema cannot be used: ${(error as Error).message}` });
        }
      }
      for (const field of ['file'] as const) {
        const sha256 = (p.rev.data as Record<string, unknown>)[field];
        if ((p.type === 'scan' || p.type === 'recording') && typeof sha256 === 'string') {
          const file = await one(tx, 'SELECT 1 FROM file WHERE sha256 = $1', [sha256]);
          if (!file) checks.push({ check: 'references', status: 'fail', entityId: id, path: field, message: `no file ${sha256.slice(0, 12)}… has been uploaded` });
        }
      }
      const valid = registry.validate(p.type, p.rev.data);
      checks.push(
        valid.ok
          ? { check: 'schema', status: 'pass', entityId: id, message: 'fields are well formed' }
          : { check: 'schema', status: 'fail', entityId: id, message: valid.issues.map((i) => `${i.path || '/'}: ${i.message}`).join('; ') },
      );
      for (const ref of referencesOf(p.type, p.rev.data)) {
        const other = inChange.get(ref.id);
        let type: string | null = null;
        if (other) type = other.rev.data === null ? null : other.type;
        else {
          const row = await one<{ type: string; deleted: boolean; main_rev: number | null }>(tx, 'SELECT type, deleted, main_rev FROM entity WHERE id = $1', [ref.id]);
          const inProject = cs.project_id !== null && row ? await one(tx, 'SELECT 1 FROM project_head WHERE project_id = $1 AND entity_id = $2', [cs.project_id, ref.id]) : null;
          type = row && !row.deleted && (row.main_rev !== null || inProject) ? row.type : null;
        }
        if (type === null) checks.push({ check: 'references', status: 'fail', entityId: id, path: ref.field, message: `${ref.field} points at ${ref.id}, which is not in the catalog` });
        else if (ref.expected.length > 0 && !ref.expected.includes(type as EntityType)) checks.push({ check: 'references', status: 'fail', entityId: id, path: ref.field, message: `${ref.field} should be a ${ref.expected.join(' or ')}, but ${ref.id} is a ${type}` });
      }
      for (const [field, value] of dateFields(p.rev.data)) {
        const check = validateDateKey(value);
        checks.push(check.ok ? { check: 'dates', status: 'pass', entityId: id, path: field, message: `${value} is a real date` } : { check: 'dates', status: 'fail', entityId: id, path: field, message: check.reason });
      }
      if (p.rev.path !== null) {
        const taken = await one<{ id: string }>(tx, 'SELECT id FROM entity WHERE path = $1 AND id <> $2 AND NOT deleted', [p.rev.path, id]);
        const movingAway = taken ? inChange.get(taken.id as EntityId)?.rev.path !== p.rev.path && inChange.has(taken.id as EntityId) : false;
        if (taken && !movingAway) checks.push({ check: 'path', status: 'fail', entityId: id, message: `the path ${p.rev.path} already belongs to ${taken.id}` });
      }
      const externalIds = (p.rev.data as { externalIds?: Record<string, string> }).externalIds ?? {};
      for (const [key, value] of Object.entries(externalIds)) {
        const dup = await one<{ id: string }>(
          tx,
          'SELECT e.id FROM entity_external_id x JOIN entity e ON e.id = x.entity_id WHERE x.key = $3 AND x.value = $4 AND e.type = $1 AND e.id <> $2 AND NOT e.deleted LIMIT 1',
          [p.type, id, key, value],
        );
        if (dup) checks.push({ check: 'duplicates', status: 'warn', entityId: id, message: `${dup.id} has the same ${key} (${value}): the same item twice?` });
      }
    }
    const author = await this.requireAccount(cs.author, tx);
    if (author.is_bot) checks.push({ check: 'machine', status: 'warn', message: `made by ${author.display_name}, a bot` });
    return checks;
  }

  // ------------------------------------------------------------ sets

  private async setInfo(db: Db, id: EntityId): Promise<SetInfo | null> {
    const main = await this.targetRev(db, null, id);
    if (!main || main.data === null || main.entity_type !== 'set') return null;
    const data = main.data as unknown as SetData;
    return { id, policy: data.policy, keepers: data.keepers };
  }

  /** The sets an item belongs to: its own `sets`, else its parent's (a segment's text's unit's work's). */
  async setsOf(db: Db, type: EntityType, data: Json, depth = 0): Promise<SetInfo[]> {
    if (type === 'set') {
      const parent = (data as unknown as SetData).parent;
      const info = parent ? await this.setInfo(db, parent) : null;
      return info ? [info] : [];
    }
    const own = (data as { sets?: EntityId[] }).sets;
    if (own && own.length > 0) return (await Promise.all(own.map((id) => this.setInfo(db, id)))).filter((s): s is SetInfo => s !== null);
    if (depth > 6) return [];
    for (const field of SET_PARENTS[type] ?? []) {
      const parentId = (data as Record<string, unknown>)[field];
      if (typeof parentId !== 'string' || !isEntityId(parentId)) continue;
      const parent = await this.targetRev(db, null, parentId);
      if (parent?.data) return this.setsOf(db, parent.entity_type, parent.data, depth + 1);
    }
    return [];
  }

  private async setsOfProposals(db: Db, proposals: Proposal[]): Promise<SetInfo[]> {
    const byId = new Map<string, SetInfo>();
    for (const p of proposals) {
      const data = p.rev.data ?? (p.baseRev !== null ? (await this.revision(p.baseRev, db))?.data : null) ?? null;
      if (data === null) continue;
      // A change to a set is judged by the set as it stands now (its keepers approve changes to it, stewards its policy).
      const sets = await this.setsOf(db, p.type, data);
      if (p.type === 'set') {
        const itself = await this.setInfo(db, p.entityId);
        if (itself) sets.push(itself);
      }
      for (const s of sets) byId.set(s.id, s);
    }
    return [...byId.values()];
  }

  // ------------------------------------------------------------ internals

  private async credit(accountId: string, what: 'approved' | 'reverted'): Promise<void> {
    await this.db.transaction(async (tx) => {
      const column = what === 'approved' ? 'approved_count' : 'reverted_count';
      const row = await one<Account>(tx, `UPDATE account SET ${column} = ${column} + 1 WHERE id = $1 RETURNING *`, [accountId]);
      if (row && !row.is_bot) await tx.query('UPDATE account SET trust = $2 WHERE id = $1', [accountId, earnedTrust(row)]);
    });
  }

  private async audit(db: Db, actor: string, action: string, targetKind: string, targetId: string, detail: Record<string, unknown> = {}): Promise<void> {
    await db.query('INSERT INTO audit_log (actor, action, target_kind, target_id, detail) VALUES ($1, $2, $3, $4, $5)', [actor, action, targetKind, targetId, JSON.stringify(detail)]);
  }

  /** The audit log for one target, oldest first: every moderator action is logged. */
  async auditLog(target: { kind: string; id: string }): Promise<Array<{ at: string; actor: string; action: string; detail: unknown }>> {
    const { rows } = await this.db.query<{ at: string; actor: string; action: string; detail: unknown }>(
      'SELECT at, actor, action, detail FROM audit_log WHERE target_kind = $1 AND target_id = $2 ORDER BY id',
      [target.kind, target.id],
    );
    return rows;
  }
}

/** Fields holding date keys, anywhere in the data, as [field path, key]. */
function dateFields(data: Json): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (value: Json, path: string, key: string): void => {
    if (typeof value === 'string' && ['date', 'dateEnd', 'born', 'passed'].includes(key)) out.push([path, value]);
    else if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}/${i}`, key));
    else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, `${path}/${k}`, k);
  };
  walk(data, '', '');
  return out;
}

/** `2026.40`: the ISO week-numbering year and week of a date. */
export function isoWeekTag(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}.${String(week).padStart(2, '0')}`;
}
