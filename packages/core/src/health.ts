import { one } from '@rebbehub/db';
import type { EntityId } from '@rebbehub/model';
import type { Catalog } from './catalog.js';
import type { Json } from './merge.js';
import { embeddingCoverage } from './semantic.js';

/**
 * The health of the catalog (the plan, section 9: "Health dashboards:
 * coverage per set and year, dead links, unchecked pages, unsynced
 * recordings, oldest open suggestions"). Counts from main as it is now,
 * for the keepers and anyone who wants to know where help is needed.
 * Dead links come from the last run of `rebbehub check-links`.
 */

export interface CatalogHealth {
  /** Farbrengens of each year, and how many have a recording, a text, a transcript. */
  years: Array<{ year: number; events: number; withRecording: number; withText: number; withTranscript: number }>;
  /** Each set, and how many items of each kind it holds. */
  sets: Array<{ id: EntityId; path: string | null; name: Json; items: number; byType: Record<string, number> }>;
  /** Pages of scans read by machine, and how many a person has checked. */
  pages: { total: number; checked: number };
  /** The scans with most pages nobody has checked. */
  uncheckedScans: Array<{ scan: EntityId; publication: EntityId | null; title: Json | null; pages: number; checked: number }>;
  recordings: { total: number; transcribed: number; synced: number };
  /** Recordings with no sync yet, the first of them. */
  unsynced: Array<{ id: EntityId; path: string | null; title: Json | null; event: EntityId | null }>;
  /** Suggestions waiting for review, the longest-waiting first. */
  openSuggestions: Array<{ id: number; title: string; author: string; authorName: string; authorIsBot: boolean; submittedAt: string }>;
  links: { checked: number; dead: number; lastChecked: string | null };
  /** Links that did not answer at the last check, those failing longest first. */
  deadLinks: Array<{ url: string; status: number | null; error: string | null; checkedAt: string; failingSince: string | null; entities: EntityId[] }>;
  embeddings: { embedded: number; waiting: number };
}

const iso = (value: unknown): string | null => (value === null || value === undefined ? null : new Date(value as string).toISOString());

export async function catalogHealth(catalog: Catalog, options: { limit?: number } = {}): Promise<CatalogHealth> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
  const db = catalog.db;
  const hasTranscript = `EXISTS (SELECT 1 FROM entity_ref y JOIN entity t ON t.id = y.from_id AND t.type = 'text' AND NOT t.deleted
      JOIN revision tr ON tr.id = t.main_rev WHERE y.to_id = rec.id AND y.field = 'recording' AND tr.data->>'kind' = 'transcript')`;
  const hasSync = `EXISTS (SELECT 1 FROM entity_ref y JOIN entity a ON a.id = y.from_id AND a.type = 'alignment' AND NOT a.deleted WHERE y.to_id = rec.id AND y.field = 'recording')`;

  const [years, sets, pages, scans, recordings, unsynced, suggestions, links, dead, embeddings] = await Promise.all([
    db.query<{ year: number; events: number; with_recording: number; with_text: number; with_transcript: number }>(
      `SELECT substring(r.data->>'date' from 1 for 4)::int AS year, count(*)::int AS events,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM entity_ref x JOIN entity rec ON rec.id = x.from_id AND rec.type = 'recording' AND NOT rec.deleted
                                             WHERE x.to_id = e.id AND x.field = 'event'))::int AS with_recording,
              count(*) FILTER (WHERE coalesce(jsonb_array_length(r.data->'links'), 0) > 0
                                  OR EXISTS (SELECT 1 FROM entity_ref x JOIN entity u ON u.id = x.from_id AND u.type = 'unit' AND NOT u.deleted
                                             WHERE x.to_id = e.id AND x.field = 'events'))::int AS with_text,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM entity_ref x JOIN entity rec ON rec.id = x.from_id AND rec.type = 'recording' AND NOT rec.deleted
                                             WHERE x.to_id = e.id AND x.field = 'event' AND ${hasTranscript}))::int AS with_transcript
       FROM entity e JOIN revision r ON r.id = e.main_rev
       WHERE e.type = 'event' AND NOT e.deleted AND r.data->>'date' ~ '^[0-9]{4}'
       GROUP BY 1 ORDER BY 1`,
    ),
    db.query<{ id: EntityId; path: string | null; name: Json; type: string | null; n: number }>(
      `SELECT s.id, s.path, sr.data->'name' AS name, m.type, count(m.id)::int AS n
       FROM entity s JOIN revision sr ON sr.id = s.main_rev
       LEFT JOIN entity_ref x ON x.to_id = s.id AND x.field = 'sets'
       LEFT JOIN entity m ON m.id = x.from_id AND NOT m.deleted AND m.main_rev IS NOT NULL
       WHERE s.type = 'set' AND NOT s.deleted GROUP BY s.id, s.path, sr.data->'name', m.type ORDER BY s.path, s.id`,
    ),
    one<{ total: number; checked: number }>(
      db,
      `SELECT coalesce(sum(pages), 0)::int AS total, coalesce(sum(least(checked, pages)), 0)::int AS checked FROM (${scanPages}) s`,
    ),
    db.query<{ scan: EntityId; publication: EntityId | null; title: Json | null; pages: number; checked: number }>(
      `SELECT s.scan, sr.data->>'publication' AS publication, pr.data->'title' AS title, s.pages, least(s.checked, s.pages) AS checked
       FROM (${scanPages}) s JOIN entity se ON se.id = s.scan JOIN revision sr ON sr.id = se.main_rev
       LEFT JOIN entity pe ON pe.id = sr.data->>'publication' LEFT JOIN revision pr ON pr.id = pe.main_rev
       WHERE s.pages > s.checked ORDER BY s.pages - s.checked DESC, s.scan LIMIT 20`,
    ),
    one<{ total: number; transcribed: number; synced: number }>(
      db,
      `SELECT count(*)::int AS total, count(*) FILTER (WHERE ${hasTranscript})::int AS transcribed, count(*) FILTER (WHERE ${hasSync})::int AS synced
       FROM entity rec WHERE rec.type = 'recording' AND NOT rec.deleted AND rec.main_rev IS NOT NULL`,
    ),
    db.query<{ id: EntityId; path: string | null; title: Json | null; event: EntityId | null }>(
      `SELECT rec.id, rec.path, r.data->'title' AS title, r.data->>'event' AS event FROM entity rec JOIN revision r ON r.id = rec.main_rev
       WHERE rec.type = 'recording' AND NOT rec.deleted AND NOT ${hasSync} ORDER BY rec.id LIMIT ${limit}`,
    ),
    db.query<{ id: number; title: string; author: string; author_name: string; author_is_bot: boolean; submitted_at: string }>(
      `SELECT c.id, c.title, c.author, a.display_name AS author_name, a.is_bot AS author_is_bot, coalesce(c.submitted_at, c.created_at) AS submitted_at
       FROM changeset c JOIN account a ON a.id = c.author WHERE c.status = 'open'
       ORDER BY coalesce(c.submitted_at, c.created_at), c.id LIMIT ${limit}`,
    ),
    one<{ checked: number; dead: number; last: string | null }>(db, 'SELECT count(*)::int AS checked, count(*) FILTER (WHERE NOT ok)::int AS dead, max(checked_at) AS last FROM link_check'),
    db.query<{ url: string; status: number | null; error: string | null; checked_at: string; failing_since: string | null; entity_ids: EntityId[] }>(
      `SELECT url, status, error, checked_at, failing_since, entity_ids FROM link_check WHERE NOT ok ORDER BY failing_since NULLS LAST, url LIMIT ${limit * 2}`,
    ),
    embeddingCoverage(catalog),
  ]);

  const bySet = new Map<string, CatalogHealth['sets'][number]>();
  for (const row of sets.rows) {
    const entry = bySet.get(row.id) ?? { id: row.id, path: row.path, name: row.name, items: 0, byType: {} };
    if (row.type) {
      entry.byType[row.type] = row.n;
      entry.items += row.n;
    }
    bySet.set(row.id, entry);
  }

  return {
    years: years.rows.map((r) => ({ year: r.year, events: r.events, withRecording: r.with_recording, withText: r.with_text, withTranscript: r.with_transcript })),
    sets: [...bySet.values()],
    pages: pages ?? { total: 0, checked: 0 },
    uncheckedScans: scans.rows,
    recordings: recordings ?? { total: 0, transcribed: 0, synced: 0 },
    unsynced: unsynced.rows,
    openSuggestions: suggestions.rows.map((r) => ({ id: r.id, title: r.title, author: r.author, authorName: r.author_name, authorIsBot: r.author_is_bot, submittedAt: iso(r.submitted_at)! })),
    links: { checked: links?.checked ?? 0, dead: links?.dead ?? 0, lastChecked: iso(links?.last) },
    deadLinks: dead.rows.map((r) => ({ url: r.url, status: r.status, error: r.error, checkedAt: iso(r.checked_at)!, failingSince: iso(r.failing_since), entities: r.entity_ids })),
    embeddings,
  };
}

/** Each scan's pages read by machine, and how many of them people have checked (its community pages marked checked). */
const scanPages = `SELECT lr.data->>'scan' AS scan,
    count(DISTINCT pr.data->>'page') FILTER (WHERE lr.data->>'kind' <> 'community')::int AS pages,
    count(DISTINCT pr.data->>'page') FILTER (WHERE lr.data->>'kind' = 'community' AND coalesce((pr.data->>'proofread')::int, 0) > 0)::int AS checked
  FROM entity p JOIN revision pr ON pr.id = p.main_rev JOIN entity l ON l.id = pr.data->>'layer' AND NOT l.deleted JOIN revision lr ON lr.id = l.main_rev
  WHERE p.type = 'text-page' AND NOT p.deleted GROUP BY 1`;
