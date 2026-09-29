import type { EntityId } from '@rebbehub/model';
import type { Catalog } from './catalog.js';
import { badState, forbidden, invalid, notFound } from './errors.js';

/**
 * Asking the machines for work (migration 0023): "read this scan" (OCR)
 * or "transcribe this recording". Anyone signed in asks, from the site,
 * the API or the MCP tools; the machines' own jobs (services/jobs) take
 * the waiting requests first, oldest first, then go on to what is new.
 *
 * The jobs that answer run on free CPU only (Tesseract, the local
 * Yiddish Whisper): a request never starts anything that costs money.
 * What they make is machine output, labelled as such until a person
 * checks it, the same as every other machine reading.
 */

export type MachineKind = 'ocr' | 'transcript';
export type MachineRequestStatus = 'waiting' | 'running' | 'done' | 'failed';

export const MACHINE_KINDS: readonly MachineKind[] = ['ocr', 'transcript'];

/** Requests one person may make in a day; stewards are not counted. Enough for real use, not for flooding the queue. */
export const MACHINE_REQUESTS_PER_DAY = 30;

export interface MachineRequest {
  id: number;
  kind: MachineKind;
  item: EntityId;
  requestedBy: string;
  status: MachineRequestStatus;
  note: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Where it stands among the waiting requests of its kind (1 is next); null once it is taken. */
  position: number | null;
}

interface Row {
  id: string | number;
  kind: MachineKind;
  entity_id: EntityId;
  requested_by: string;
  status: MachineRequestStatus;
  note: string | null;
  created_at: Date | string;
  started_at: Date | string | null;
  finished_at: Date | string | null;
  position: string | number | null;
}

const COLUMNS = `r.id, r.kind, r.entity_id, r.requested_by, r.status, r.note, r.created_at, r.started_at, r.finished_at,
  CASE WHEN r.status = 'waiting' THEN (SELECT count(*) FROM machine_request w WHERE w.kind = r.kind AND w.status = 'waiting' AND (w.created_at, w.id) <= (r.created_at, r.id)) END AS position`;

const iso = (d: Date | string | null) => (d === null ? null : new Date(d).toISOString());

function toRequest(r: Row): MachineRequest {
  return {
    id: Number(r.id),
    kind: r.kind,
    item: r.entity_id,
    requestedBy: r.requested_by,
    status: r.status,
    note: r.note,
    createdAt: iso(r.created_at)!,
    startedAt: iso(r.started_at),
    finishedAt: iso(r.finished_at),
    position: r.position === null ? null : Number(r.position),
  };
}

/** Which kind of item each kind of work is done on. */
const TYPE_OF: Record<MachineKind, string> = { ocr: 'scan', transcript: 'recording' };

/** Whether the machine may do this work on this item now: throws why not ("state" when it is done already). */
export async function checkMachineWork(catalog: Catalog, kind: MachineKind, item: EntityId): Promise<void> {
  const view = await catalog.get(item);
  if (!view) throw notFound(`item ${item}`);
  if (view.type !== TYPE_OF[kind]) throw invalid(kind === 'ocr' ? 'only a scan can be read by OCR' : 'only a recording can be transcribed');
  const d = view.data as { file?: string; url?: string };
  const served = d.file
    ? (await catalog.db.query("SELECT 1 FROM file WHERE sha256 = $1 AND storage_tier = 'public' AND rights_state IN ('open', 'credit')", [d.file])).rows.length > 0
    : false;
  if (kind === 'ocr') {
    // The machine reads only what RebbeHub serves and may copy; a linked scan is read where it is kept.
    if (!served) throw invalid('this scan is not served by RebbeHub (or its rights do not allow copies), so the machine cannot read it');
    const { rows } = await catalog.db.query(
      `SELECT 1 FROM entity_ref x JOIN entity l ON l.id = x.from_id AND l.type = 'text-layer' AND NOT l.deleted
       JOIN revision lr ON lr.id = l.main_rev
       WHERE x.to_id = $1 AND x.field = 'scan' AND lr.data->>'kind' = 'machine-ocr' LIMIT 1`,
      [item],
    );
    if (rows.length) throw badState('the machine has read this scan already; fix its lines on the text page');
  } else {
    if (!served && !d.url) throw invalid('this recording has no audio the machine can hear');
    const { rows } = await catalog.db.query(
      `SELECT 1 FROM entity_ref x JOIN entity t ON t.id = x.from_id AND t.type = 'text' AND NOT t.deleted
       JOIN revision tr ON tr.id = t.main_rev
       WHERE x.to_id = $1 AND x.field = 'recording' AND tr.data->>'kind' = 'transcript' LIMIT 1`,
      [item],
    );
    if (rows.length) throw badState('this recording has a transcript already; fix its words on the recording\'s page');
  }
}

/**
 * Asks the machine to read a scan or transcribe a recording. Asking for
 * what is already waiting joins that request (it is returned, with its
 * place in line); asking for what the machine has done already says so.
 */
export async function requestMachineWork(catalog: Catalog, by: string, input: { kind?: unknown; item?: unknown }): Promise<{ request: MachineRequest; created: boolean }> {
  const kind = input.kind;
  if (kind !== 'ocr' && kind !== 'transcript') throw invalid('kind is ocr (read a scan) or transcript (transcribe a recording)');
  if (typeof input.item !== 'string' || !input.item) throw invalid('give the item: a scan for ocr, a recording for transcript');
  const item = input.item as EntityId;
  const account = await catalog.account(by);
  if (!account) throw notFound(`account ${by}`);
  if (account.suspended_at) throw forbidden('this account is suspended');
  await checkMachineWork(catalog, kind, item);

  const waiting = await openRequest(catalog, kind, item);
  if (waiting) return { request: waiting, created: false };

  if (!account.is_steward && !account.is_bot) {
    const { rows } = await catalog.db.query<{ n: string | number }>("SELECT count(*) AS n FROM machine_request WHERE requested_by = $1 AND created_at > now() - interval '1 day'", [by]);
    if (Number(rows[0]?.n ?? 0) >= MACHINE_REQUESTS_PER_DAY) throw forbidden(`at most ${MACHINE_REQUESTS_PER_DAY} requests a day; the machine will get to the rest on its own`);
  }
  const { rows } = await catalog.db.query<{ id: string | number }>(
    `INSERT INTO machine_request (kind, entity_id, requested_by) VALUES ($1, $2, $3)
     ON CONFLICT (kind, entity_id) WHERE status IN ('waiting', 'running') DO NOTHING RETURNING id`,
    [kind, item, by],
  );
  // Two people asking at once: the second joins the first.
  if (!rows.length) return { request: (await openRequest(catalog, kind, item))!, created: false };
  return { request: (await machineRequest(catalog, Number(rows[0]!.id)))!, created: true };
}

async function openRequest(catalog: Catalog, kind: MachineKind, item: EntityId): Promise<MachineRequest | null> {
  const { rows } = await catalog.db.query<Row>(`SELECT ${COLUMNS} FROM machine_request r WHERE r.kind = $1 AND r.entity_id = $2 AND r.status IN ('waiting', 'running')`, [kind, item]);
  return rows[0] ? toRequest(rows[0]) : null;
}

export async function machineRequest(catalog: Catalog, id: number): Promise<MachineRequest | null> {
  const { rows } = await catalog.db.query<Row>(`SELECT ${COLUMNS} FROM machine_request r WHERE r.id = $1`, [id]);
  return rows[0] ? toRequest(rows[0]) : null;
}

/** The requests, the waiting ones first in the order they will be taken, then the latest finished. */
export async function machineRequests(
  catalog: Catalog,
  options: { kind?: MachineKind; item?: EntityId; items?: EntityId[]; status?: MachineRequestStatus; by?: string; limit?: number } = {},
): Promise<MachineRequest[]> {
  const params: unknown[] = [];
  const where: string[] = [];
  if (options.kind) where.push(`r.kind = $${params.push(options.kind)}`);
  if (options.item) where.push(`r.entity_id = $${params.push(options.item)}`);
  if (options.items) where.push(`r.entity_id = ANY($${params.push(options.items)})`);
  if (options.status) where.push(`r.status = $${params.push(options.status)}`);
  if (options.by) where.push(`r.requested_by = $${params.push(options.by)}`);
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));
  const { rows } = await catalog.db.query<Row>(
    `SELECT ${COLUMNS} FROM machine_request r ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY CASE r.status WHEN 'running' THEN 0 WHEN 'waiting' THEN 1 ELSE 2 END,
       CASE WHEN r.status IN ('waiting', 'running') THEN r.created_at END ASC, coalesce(r.finished_at, r.created_at) DESC, r.id
     LIMIT ${limit}`,
    params,
  );
  return rows.map(toRequest);
}

/**
 * What waits for the machines and what is left for them: requests waiting
 * and running, and the served scans and recordings they have not done
 * yet (the backlog they work through on their own, newest first).
 */
export async function machineSummary(catalog: Catalog): Promise<Record<MachineKind, { waiting: number; running: number; doneLastWeek: number; failedLastWeek: number; backlog: number }>> {
  const { rows } = await catalog.db.query<{ kind: MachineKind; waiting: string; running: string; done: string; failed: string }>(
    `SELECT kind,
       count(*) FILTER (WHERE status = 'waiting') AS waiting,
       count(*) FILTER (WHERE status = 'running') AS running,
       count(*) FILTER (WHERE status = 'done' AND finished_at > now() - interval '7 days') AS done,
       count(*) FILTER (WHERE status = 'failed' AND finished_at > now() - interval '7 days') AS failed
     FROM machine_request GROUP BY kind`,
  );
  const served = "EXISTS (SELECT 1 FROM file f WHERE f.sha256 = r.data->>'file' AND f.storage_tier = 'public' AND f.rights_state IN ('open', 'credit'))";
  const { rows: backlog } = await catalog.db.query<{ scans: string; recordings: string }>(
    `SELECT
       (SELECT count(*) FROM entity e JOIN revision r ON r.id = e.main_rev WHERE e.type = 'scan' AND NOT e.deleted AND ${served}
          AND NOT EXISTS (SELECT 1 FROM entity_ref x JOIN entity l ON l.id = x.from_id AND l.type = 'text-layer' AND NOT l.deleted JOIN revision lr ON lr.id = l.main_rev
                          WHERE x.to_id = e.id AND x.field = 'scan' AND lr.data->>'kind' = 'machine-ocr')) AS scans,
       (SELECT count(*) FROM entity e JOIN revision r ON r.id = e.main_rev WHERE e.type = 'recording' AND NOT e.deleted AND ${served}
          AND NOT EXISTS (SELECT 1 FROM entity_ref x JOIN entity t ON t.id = x.from_id AND t.type = 'text' AND NOT t.deleted JOIN revision tr ON tr.id = t.main_rev
                          WHERE x.to_id = e.id AND x.field = 'recording' AND tr.data->>'kind' = 'transcript')) AS recordings`,
  );
  const of = (kind: MachineKind, left: string | undefined) => {
    const r = rows.find((x) => x.kind === kind);
    return { waiting: Number(r?.waiting ?? 0), running: Number(r?.running ?? 0), doneLastWeek: Number(r?.done ?? 0), failedLastWeek: Number(r?.failed ?? 0), backlog: Number(left ?? 0) };
  };
  return { ocr: of('ocr', backlog[0]?.scans), transcript: of('transcript', backlog[0]?.recordings) };
}

/**
 * For the jobs: takes up to `limit` waiting requests of a kind, oldest
 * first, and marks them running. A request left running by a job that
 * died is taken again after `staleHours`.
 */
export async function takeMachineRequests(catalog: Catalog, kind: MachineKind, limit: number, options: { staleHours?: number } = {}): Promise<MachineRequest[]> {
  const stale = Math.max(1, options.staleHours ?? 12);
  const { rows } = await catalog.db.query<{ id: string | number }>(
    `UPDATE machine_request SET status = 'running', started_at = now()
     WHERE id IN (
       SELECT id FROM machine_request
       WHERE kind = $1 AND (status = 'waiting' OR (status = 'running' AND started_at < now() - make_interval(hours => $3)))
       ORDER BY created_at, id LIMIT $2)
     RETURNING id`,
    [kind, Math.max(0, limit), stale],
  );
  const taken = await Promise.all(rows.map((r) => machineRequest(catalog, Number(r.id))));
  return taken.filter((r): r is MachineRequest => r !== null).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
}

/**
 * For the jobs: the work on an item is finished (done, or failed with
 * why), which settles every open request for it, whether the job came to
 * it by request or on its own.
 */
export async function finishMachineWork(catalog: Catalog, kind: MachineKind, item: EntityId, outcome: { status: 'done' | 'failed'; note?: string }): Promise<number> {
  const { rows } = await catalog.db.query(
    `UPDATE machine_request SET status = $3, note = $4, finished_at = now()
     WHERE kind = $1 AND entity_id = $2 AND status IN ('waiting', 'running') RETURNING id`,
    [kind, item, outcome.status, outcome.note?.slice(0, 1000) ?? null],
  );
  return rows.length;
}

/** For the jobs: puts back requests a run took but did not get to (it stopped early), so the next run takes them first. */
export async function releaseMachineRequests(catalog: Catalog, ids: number[]): Promise<void> {
  if (!ids.length) return;
  await catalog.db.query("UPDATE machine_request SET status = 'waiting', started_at = NULL WHERE id = ANY($1) AND status = 'running'", [ids]);
}
