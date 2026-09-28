import { one } from '@rebbehub/db';
import type { EntityId, LocalName } from '@rebbehub/model';
import type { Catalog, ProjectFocus } from './catalog.js';
import { badState, notFound } from './errors.js';
import { scanProgress } from './text.js';

/**
 * A project's work, item by item (the plan, section 7: "the page shows
 * progress and hands out the next unclaimed page or recording"): what is
 * left in its focus, how much is done, and handing the next one to whoever
 * asks, claimed for them for a while (migration 0013) so two people are
 * not given the same one.
 */

/** How long a claim holds before the item goes back to the pile. */
export const CLAIM_HOURS = 3;

/** One thing to do in a project: a farbrengen that lacks something, a recording to sync, a page to proofread. */
export interface ProjectItem {
  /** The key it is claimed by: an entity id, or `page:<n>`. */
  item: string;
  kind: 'event' | 'recording' | 'page';
  id: EntityId | null;
  /** For a page: its number; for the others, the item's date when it has one. */
  page?: number;
  date?: string | null;
  title?: LocalName | null;
  /** The farbrengen a recording belongs to. */
  event?: EntityId | null;
  /** For a page: how far it is proofread now. */
  level?: number;
  /** Who holds it, while their claim is live. */
  claimedBy?: string | null;
}

const withinClause = (column: string, param: string) => `(${column} = ${param} OR ${column} LIKE ${param} || '-%')`;

/** Recordings with a transcript to sync (of a year or month), and whether each one's sync is all checked. */
async function syncRecordings(catalog: Catalog, within: string | undefined, onlyOpen: boolean, limit: number): Promise<Array<{ id: EntityId; title: LocalName | null; event: EntityId | null; date: string | null; done: boolean }>> {
  const params: unknown[] = [];
  const within_ = within ? `AND ${withinClause("er.data->>'date'", `$${params.push(within)}`)}` : '';
  const { rows } = await catalog.db.query<{ id: EntityId; title: LocalName | null; event: EntityId | null; date: string | null; done: boolean }>(
    `SELECT * FROM (
       SELECT rec.id, rr.data->'title' AS title, rr.data->>'event' AS event, er.data->>'date' AS date, coalesce((rr.data->>'part')::int, 0) AS part,
              (EXISTS (SELECT 1 FROM entity a JOIN revision ar ON ar.id = a.main_rev
                       WHERE a.type = 'alignment' AND NOT a.deleted AND ar.data->>'recording' = rec.id AND ar.data->>'text' = tx.id)
               AND NOT EXISTS (
                 SELECT 1 FROM entity a JOIN revision ar ON ar.id = a.main_rev
                 JOIN entity_ref y ON y.to_id = a.id AND y.field = 'alignment'
                 JOIN entity sp ON sp.id = y.from_id AND sp.type = 'alignment-span' AND NOT sp.deleted JOIN revision spr ON spr.id = sp.main_rev
                 WHERE a.type = 'alignment' AND NOT a.deleted AND ar.data->>'recording' = rec.id AND ar.data->>'text' = tx.id
                   AND spr.data ? 'origin' AND coalesce((spr.data->>'locked')::boolean, FALSE) = FALSE
                   AND coalesce((spr.data->'origin'->>'checked')::boolean, FALSE) = FALSE)) AS done
       FROM entity rec JOIN revision rr ON rr.id = rec.main_rev
       JOIN LATERAL (
         SELECT t.id FROM entity_ref x JOIN entity t ON t.id = x.from_id AND t.type = 'text' AND NOT t.deleted JOIN revision tr ON tr.id = t.main_rev
         WHERE x.to_id = rec.id AND x.field = 'recording' AND tr.data->>'kind' = 'transcript' ORDER BY t.id LIMIT 1
       ) tx ON TRUE
       LEFT JOIN entity ev ON ev.id = rr.data->>'event' LEFT JOIN revision er ON er.id = ev.main_rev
       WHERE rec.type = 'recording' AND NOT rec.deleted ${within_}
     ) q ${onlyOpen ? 'WHERE NOT done' : ''}
     ORDER BY date COLLATE "C" NULLS LAST, event, part, id LIMIT ${Math.min(Math.max(limit, 1), 20_000)}`,
    params,
  );
  return rows;
}

/** A project's progress: how many items its focus holds, and how many of them are done. */
export async function focusCounts(catalog: Catalog, focus: ProjectFocus): Promise<{ total: number; done: number }> {
  if (focus.missing === 'sync') {
    const all = await syncRecordings(catalog, focus.within, false, 20_000);
    return { total: all.length, done: all.filter((r) => r.done).length };
  }
  if (focus.missing === 'proofreading') {
    const progress = focus.scan ? await scanProgress(catalog, focus.scan) : null;
    if (!progress) return { total: 0, done: 0 };
    return { total: progress.pages, done: progress.levels.filter((l) => l >= (focus.level ?? 1)).length };
  }
  const counts = await one<{ total: number; done: number }>(
    catalog.db,
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE ${focus.missing === 'recordings'
              ? "EXISTS (SELECT 1 FROM entity_ref x JOIN entity f ON f.id = x.from_id AND f.type = 'recording' AND NOT f.deleted WHERE x.to_id = e.id AND x.field = 'event')"
              : "coalesce(jsonb_array_length(r.data->'links'), 0) > 0"})::int AS done
     FROM entity e JOIN revision r ON r.id = e.main_rev
     WHERE e.type = 'event' AND NOT e.deleted ${focus.within ? "AND r.data->>'date' LIKE $1 || '%'" : ''}`,
    focus.within ? [focus.within] : [],
  );
  return { total: counts?.total ?? 0, done: counts?.done ?? 0 };
}

async function liveClaims(catalog: Catalog, projectId: number): Promise<Map<string, string>> {
  const { rows } = await catalog.db.query<{ item: string; account_id: string }>(
    `SELECT item, account_id FROM project_claim WHERE project_id = $1 AND claimed_at > now() - interval '${CLAIM_HOURS} hours'`,
    [projectId],
  );
  return new Map(rows.map((r) => [r.item, r.account_id]));
}

/** What is left to do in a project, in order, each with who holds it now. */
export async function projectTodo(catalog: Catalog, project: { id: number; focus: ProjectFocus }, limit = 30): Promise<ProjectItem[]> {
  const claims = await liveClaims(catalog, project.id);
  const { focus } = project;
  let items: ProjectItem[];
  if (focus.missing === 'sync') {
    items = (await syncRecordings(catalog, focus.within, true, limit + claims.size)).map((r) => ({ item: r.id, kind: 'recording', id: r.id, title: r.title, event: r.event, date: r.date }));
  } else if (focus.missing === 'proofreading') {
    const progress = focus.scan ? await scanProgress(catalog, focus.scan) : null;
    items = (progress?.levels ?? [])
      .map((level, i) => ({ level, page: i + 1 }))
      .filter((p) => p.level < (focus.level ?? 1))
      .slice(0, limit + claims.size)
      .map((p) => ({ item: `page:${p.page}`, kind: 'page', id: focus.scan ?? null, page: p.page, level: p.level }));
  } else {
    items = (await catalog.events({ within: focus.within, missing: focus.missing, limit: limit + claims.size })).map((e) => ({
      item: e.id,
      kind: 'event',
      id: e.id,
      title: (e.data as { title?: LocalName }).title ?? null,
      date: (e.data as { date?: string }).date ?? null,
    }));
  }
  return items.slice(0, limit + claims.size).map((i) => ({ ...i, claimedBy: claims.get(i.item) ?? null }));
}

/**
 * "Give me the next one": the item `by` already holds, if it is still to
 * do; else the first one nobody holds, claimed for them. Null when
 * everything left is done or held by others.
 */
export async function claimNext(catalog: Catalog, slug: string, by: string): Promise<ProjectItem | null> {
  const project = await one<{ id: number; status: string; focus: ProjectFocus | null }>(catalog.db, 'SELECT id, status, focus FROM project WHERE slug = $1', [slug]);
  if (!project?.focus) throw notFound(`project ${slug}`);
  if (project.status !== 'open') throw badState('that project is closed');
  const todo = await projectTodo(catalog, { id: Number(project.id), focus: project.focus }, 200);
  const mine = todo.find((t) => t.claimedBy === by);
  if (mine) return mine;
  for (const t of todo) {
    if (t.claimedBy) continue;
    // Taken only if nobody holds it now: a claim that lapsed is taken over.
    const taken = await one<{ item: string }>(
      catalog.db,
      `INSERT INTO project_claim (project_id, item, account_id) VALUES ($1, $2, $3)
       ON CONFLICT (project_id, item) DO UPDATE SET account_id = EXCLUDED.account_id, claimed_at = now()
       WHERE project_claim.claimed_at <= now() - interval '${CLAIM_HOURS} hours' OR project_claim.account_id = EXCLUDED.account_id
       RETURNING item`,
      [project.id, t.item, by],
    );
    if (taken) return { ...t, claimedBy: by };
  }
  return null;
}

/** Lets go of an item: done, or passed on. */
export async function releaseClaim(catalog: Catalog, slug: string, by: string, item: string): Promise<void> {
  await catalog.db.query('DELETE FROM project_claim WHERE project_id = (SELECT id FROM project WHERE slug = $1) AND item = $2 AND account_id = $3', [slug, item, by]);
}
