import type { EntityId } from '@rebbehub/model';
import type { Catalog } from './catalog.js';
import type { Json } from './merge.js';

/**
 * What the machines wrote that no person has checked yet: farbrengens whose
 * transcripts have paragraphs nobody checked, scans read by OCR with pages
 * nobody proofread, and pages whose words a machine read (a subject index
 * read from its scan) with segments nobody checked. The newest first, so
 * what the bots did last night is at the top of the list people check from
 * (the home page links to it). Three queries, whatever the size of the
 * catalog; the rows carry facts, not words.
 */

export interface TranscriptToCheck {
  event: EntityId;
  path: string | null;
  title: Json | null;
  date: string | null;
  paragraphs: number;
  checked: number;
  /** When the machine last wrote a transcript of it. */
  made: string;
}

export interface ScanToCheck {
  scan: EntityId;
  publication: EntityId | null;
  title: Json | null;
  pages: number;
  checked: number;
  made: string;
}

/** A page whose words a machine wrote, checked on its edit page segment by segment beside the scan. */
export interface PageToCheck {
  entity: EntityId;
  type: string;
  path: string | null;
  /** The work's title, for a unit; the item's own otherwise. */
  title: Json | null;
  /** A unit's label in its work ("חלק א"). */
  label: Json | null;
  /** Segments the machine labelled one by one, and how many of them a person checked. 0 when only the version is labelled. */
  segments: number;
  checked: number;
  made: string;
}

export interface MachineToCheck {
  transcripts: TranscriptToCheck[];
  scans: ScanToCheck[];
  texts: PageToCheck[];
  /** All of them, not only the rows listed. `entries`: segments of `texts` not checked yet. */
  totals: { transcripts: number; paragraphs: number; scans: number; pages: number; texts: number; entries: number };
}

/**
 * The versions a machine wrote words of. Word for word the predicate of the
 * index revision_machine_words (migration 0027), so this is a lookup.
 */
const MACHINE_WORDS = `jsonb_path_exists(r.data, 'lax $.body.versions[*].**.origin.by')`;

const iso = (value: unknown): string => new Date(value as string).toISOString();

export async function machineToCheck(catalog: Catalog, options: { limit?: number } = {}): Promise<MachineToCheck> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const [transcripts, scans, texts] = await Promise.all([
    catalog.db.query<{ event: EntityId; path: string | null; title: Json | null; date: string | null; paragraphs: number; checked: number; made: string }>(
      `SELECT ev.id AS event, ev.path, er.data->'title' AS title, er.data->>'date' AS date,
              count(s.id)::int AS paragraphs,
              count(s.id) FILTER (WHERE coalesce((sr.data->>'proofread')::int, 0) > 0 OR sr.data->'origin'->>'checked' = 'true')::int AS checked,
              max(t.created_at) AS made
       FROM entity t JOIN revision tr ON tr.id = t.main_rev AND tr.data->>'kind' = 'transcript'
       JOIN entity rec ON rec.id = tr.data->>'recording' AND NOT rec.deleted JOIN revision rr ON rr.id = rec.main_rev
       JOIN entity ev ON ev.id = rr.data->>'event' AND NOT ev.deleted JOIN revision er ON er.id = ev.main_rev
       JOIN entity_ref x ON x.to_id = t.id AND x.field = 'text'
       JOIN entity s ON s.id = x.from_id AND s.type = 'segment' AND NOT s.deleted JOIN revision sr ON sr.id = s.main_rev
       WHERE t.type = 'text' AND NOT t.deleted
       GROUP BY ev.id, ev.path, er.data`,
    ),
    catalog.db.query<{ scan: EntityId; publication: EntityId | null; title: Json | null; pages: number; checked: number; made: string }>(
      `WITH layers AS (
         SELECT l.id, lr.data->>'scan' AS scan, lr.data->>'kind' AS kind, l.created_at
         FROM entity l JOIN revision lr ON lr.id = l.main_rev WHERE l.type = 'text-layer' AND NOT l.deleted),
       pages AS (
         SELECT l.scan,
                count(DISTINCT pr.data->>'page') FILTER (WHERE l.kind <> 'community')::int AS pages,
                count(DISTINCT pr.data->>'page') FILTER (WHERE l.kind = 'community' AND coalesce((pr.data->>'proofread')::int, 0) > 0)::int AS checked,
                max(l.created_at) FILTER (WHERE l.kind <> 'community') AS made
         FROM entity p JOIN revision pr ON pr.id = p.main_rev JOIN layers l ON l.id = pr.data->>'layer'
         WHERE p.type = 'text-page' AND NOT p.deleted GROUP BY 1)
       SELECT s.scan, sr.data->>'publication' AS publication, pr.data->'title' AS title, s.pages, least(s.checked, s.pages)::int AS checked, s.made
       FROM pages s JOIN entity se ON se.id = s.scan AND NOT se.deleted JOIN revision sr ON sr.id = se.main_rev
       LEFT JOIN entity pe ON pe.id = sr.data->>'publication' LEFT JOIN revision pr ON pr.id = pe.main_rev
       WHERE s.pages > s.checked AND s.made IS NOT NULL`,
    ),
    // The segments are counted strict and silent: lax would unwrap each array `**` passes and count its segments twice.
    catalog.db.query<{ entity: EntityId; type: string; path: string | null; title: Json | null; label: Json | null; segments: number; checked: number; whole: boolean; made: string }>(
      `SELECT e.id AS entity, e.type, e.path, coalesce(wr.data->'title', r.data->'title') AS title, r.data->'label' AS label,
              (SELECT count(*) FROM jsonb_path_query(r.data, 'strict $.body.versions[*].segments.**.origin ? (exists(@.by))', '{}', true))::int AS segments,
              (SELECT count(*) FROM jsonb_path_query(r.data, 'strict $.body.versions[*].segments.**.origin ? (exists(@.by) && @.checked == true)', '{}', true))::int AS checked,
              jsonb_path_exists(r.data, 'lax $.body.versions[*].origin ? (exists(@.by) && !(@.checked == true))') AS whole,
              r.created_at AS made
       FROM revision r JOIN entity e ON e.id = r.entity_id AND e.main_rev = r.id AND NOT e.deleted
       LEFT JOIN entity w ON w.id = r.data->>'work' LEFT JOIN revision wr ON wr.id = w.main_rev
       WHERE ${MACHINE_WORDS}`,
    ),
  ]);
  const newest = <T extends { made: string }>(a: T, b: T) => b.made.localeCompare(a.made);
  const open = transcripts.rows.filter((r) => r.checked < r.paragraphs).map((r) => ({ ...r, made: iso(r.made) }));
  const unread = scans.rows.map((r) => ({ ...r, made: iso(r.made) }));
  // A version labelled as a whole, with no segment labelled, waits until a person checks it all.
  const pages = texts.rows
    .filter((r) => r.checked < r.segments || (r.whole && r.segments === 0))
    .map(({ whole: _, ...r }) => ({ ...r, made: iso(r.made) }))
    // Newest first by the minute, so the volumes of one upload stay in their order.
    .sort((a, b) => b.made.slice(0, 16).localeCompare(a.made.slice(0, 16)) || (a.path ?? '').localeCompare(b.path ?? '', undefined, { numeric: true }));
  return {
    transcripts: open.sort(newest).slice(0, limit),
    scans: unread.sort(newest).slice(0, limit),
    texts: pages.slice(0, limit),
    totals: {
      transcripts: open.length,
      paragraphs: open.reduce((n, r) => n + r.paragraphs - r.checked, 0),
      scans: unread.length,
      pages: unread.reduce((n, r) => n + r.pages - r.checked, 0),
      texts: pages.length,
      entries: pages.reduce((n, r) => n + r.segments - r.checked, 0),
    },
  };
}
