import type { EntityId } from '@rebbehub/model';
import type { Catalog } from './catalog.js';
import type { Json } from './merge.js';

/**
 * What the machines wrote that no person has checked yet: farbrengens whose
 * transcripts have paragraphs nobody checked, and scans read by OCR with
 * pages nobody proofread. The newest first, so what the bots did last night
 * is at the top of the list people check from (the home page links to it).
 * Two queries, whatever the size of the catalog; the rows carry facts, not
 * words.
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

export interface MachineToCheck {
  transcripts: TranscriptToCheck[];
  scans: ScanToCheck[];
  /** All of them, not only the rows listed. */
  totals: { transcripts: number; paragraphs: number; scans: number; pages: number };
}

const iso = (value: unknown): string => new Date(value as string).toISOString();

export async function machineToCheck(catalog: Catalog, options: { limit?: number } = {}): Promise<MachineToCheck> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const [transcripts, scans] = await Promise.all([
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
  ]);
  const newest = <T extends { made: string }>(a: T, b: T) => b.made.localeCompare(a.made);
  const open = transcripts.rows.filter((r) => r.checked < r.paragraphs).map((r) => ({ ...r, made: iso(r.made) }));
  const unread = scans.rows.map((r) => ({ ...r, made: iso(r.made) }));
  return {
    transcripts: open.sort(newest).slice(0, limit),
    scans: unread.sort(newest).slice(0, limit),
    totals: {
      transcripts: open.length,
      paragraphs: open.reduce((n, r) => n + r.paragraphs - r.checked, 0),
      scans: unread.length,
      pages: unread.reduce((n, r) => n + r.pages - r.checked, 0),
    },
  };
}
