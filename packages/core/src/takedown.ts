import { one } from '@rebbehub/db';
import { readId, type EntityId, type RightsState } from '@rebbehub/model';
import type { Catalog } from './catalog.js';
import { cleanEmail } from './email.js';
import { forbidden, invalid, notFound } from './errors.js';
import { setRights } from './files.js';

/**
 * Takedowns (the plan, sections 8 and 11: "a public form; a steward moves
 * a file to `preserved` in one click, logged", "takedown with a stated
 * response time"). Anyone asks, with no account, saying who they are and
 * what they want taken down; the request is a Report (reason `rights`) in
 * the set's inbox, with the asker's name and address kept beside it for
 * stewards alone. A steward sees the files the item has and takes each
 * down in one click: it stops being served at once, a private copy is
 * kept, and the change is in the audit log (`setRights`).
 */

/** How soon a steward answers a takedown request; the form says so. */
export const TAKEDOWN_RESPONSE_DAYS = 14;

export type TakedownRelation = 'rights-holder' | 'family' | 'representative' | 'other';
export const TAKEDOWN_RELATIONS: readonly TakedownRelation[] = ['rights-holder', 'family', 'representative', 'other'];

/** What someone pointed at: an id (rh-…), an address on the site, or a file's address (`/objects/<sha256>`). */
export async function resolveTakedownTarget(catalog: Catalog, target: string): Promise<{ entityId: EntityId | null; sha256: string | null }> {
  const text = target.trim();
  const sha = /(?:^|\/objects\/|\/files\/)([0-9a-f]{64})(?:$|[/?#])/i.exec(text)?.[1]?.toLowerCase() ?? null;
  if (sha) return { entityId: null, sha256: sha };
  const idInText = /\brh-?[0-9a-z]{6,16}\b/i.exec(text)?.[0];
  const id = idInText ? readId(idInText) : null;
  if (id && (await catalog.get(id))) return { entityId: id, sha256: null };
  let path: string | null = null;
  try {
    path = text.startsWith('/') ? text : new URL(text).pathname;
  } catch {
    path = null;
  }
  if (path) {
    const found = await catalog.resolvePath(decodeURIComponent(path.split('?')[0]!));
    if (found) return { entityId: found.id, sha256: null };
  }
  return { entityId: null, sha256: null };
}

/**
 * A takedown request from the public form. Kept even when what it points
 * at is not found (a steward reads it and asks); returns its Report's id.
 */
export async function requestTakedown(
  catalog: Catalog,
  input: { target: string; name: string; email: string; relation: TakedownRelation; statement: string; reporterHash?: string },
): Promise<number> {
  const name = input.name.replace(/\s+/g, ' ').trim();
  const email = cleanEmail(input.email);
  const statement = input.statement.trim();
  const target = input.target.trim();
  if (!name || name.length > 200) throw invalid('your name, up to 200 characters');
  if (!email) throw invalid('an email address to answer you at');
  if (!TAKEDOWN_RELATIONS.includes(input.relation)) throw invalid(`relation is one of ${TAKEDOWN_RELATIONS.join(', ')}`);
  if (!target || target.length > 1000) throw invalid('say what should be taken down (its address on the site)');
  if (statement.length < 10 || statement.length > 4000) throw invalid('say in a few words why (10 to 4000 characters)');
  const found = await resolveTakedownTarget(catalog, target);
  const reportId = await catalog.report({ entityId: found.entityId ?? undefined, reason: 'rights', note: `Takedown request: ${statement}`.slice(0, 2000), reporterHash: input.reporterHash });
  await catalog.db.query('INSERT INTO takedown (report_id, name, email, relation, target) VALUES ($1, $2, $3, $4, $5)', [reportId, name, email, input.relation, target]);
  return reportId;
}

export interface TakedownView {
  report: number;
  status: 'open' | 'resolved' | 'dismissed';
  at: string;
  name: string;
  email: string;
  relation: TakedownRelation;
  target: string;
  statement: string | null;
  entityId: EntityId | null;
  /** The files it points at: the item's own, its recordings' and scans' (and a file named directly). */
  files: Array<{ sha256: string; mime: string; bytes: number; rights: RightsState; usedBy: EntityId | null }>;
}

/** The files an item holds or leads to: its own file, a farbrengen's recordings, a sefer's or publication's scans. */
async function filesOf(catalog: Catalog, entityId: EntityId): Promise<Array<{ sha256: string; usedBy: EntityId }>> {
  const { rows } = await catalog.db.query<{ sha256: string; id: EntityId }>(
    `WITH RECURSIVE near (id, depth) AS (
       SELECT $1::text, 0
       UNION
       SELECT x.from_id, n.depth + 1 FROM near n JOIN entity_ref x ON x.to_id = n.id
         JOIN entity e ON e.id = x.from_id AND NOT e.deleted AND e.type IN ('recording', 'scan', 'publication')
       WHERE n.depth < 2 AND x.field IN ('event', 'work', 'publication')
     )
     SELECT DISTINCT r.data->>'file' AS sha256, e.id FROM near n JOIN entity e ON e.id = n.id JOIN revision r ON r.id = e.main_rev
     WHERE r.data->>'file' ~ '^[0-9a-f]{64}$' LIMIT 50`,
    [entityId],
  );
  return rows.map((r) => ({ sha256: r.sha256, usedBy: r.id }));
}

/** Takedown requests, open ones first, for stewards: who asked, what, and the files a click takes down. */
export async function takedowns(catalog: Catalog, by: string, options: { status?: 'open' | 'resolved' | 'dismissed' } = {}): Promise<TakedownView[]> {
  const actor = await catalog.account(by);
  if (!actor?.is_steward) throw forbidden('takedown requests are read by stewards');
  const { rows } = await catalog.db.query<{ report_id: string | number; status: TakedownView['status']; created_at: Date | string; name: string; email: string; relation: TakedownRelation; target: string; note: string | null; entity_id: EntityId | null }>(
    `SELECT t.report_id, r.status, t.created_at, t.name, t.email, t.relation, t.target, r.note, r.entity_id
     FROM takedown t JOIN report r ON r.id = t.report_id WHERE r.status = $1 ORDER BY t.created_at LIMIT 100`,
    [options.status ?? 'open'],
  );
  const views: TakedownView[] = [];
  for (const row of rows) {
    const named = await resolveTakedownTarget(catalog, row.target);
    const found = [...(row.entity_id ? await filesOf(catalog, row.entity_id) : []), ...(named.sha256 ? [{ sha256: named.sha256, usedBy: null }] : [])];
    const files: TakedownView['files'] = [];
    for (const f of found) {
      if (files.some((x) => x.sha256 === f.sha256)) continue;
      const file = await one<{ mime: string; bytes: string | number; rights_state: RightsState }>(catalog.db, 'SELECT mime, bytes, rights_state FROM file WHERE sha256 = $1', [f.sha256]);
      if (file) files.push({ sha256: f.sha256, mime: file.mime, bytes: Number(file.bytes), rights: file.rights_state, usedBy: f.usedBy });
    }
    views.push({
      report: Number(row.report_id),
      status: row.status,
      at: new Date(row.created_at).toISOString(),
      name: row.name,
      email: row.email,
      relation: row.relation,
      target: row.target,
      statement: row.note?.replace(/^Takedown request: /, '') ?? null,
      entityId: row.entity_id,
      files,
    });
  }
  return views;
}

/**
 * "Take down", one click: the file moves to `preserved` (no longer served,
 * a private copy kept, its reading copies with it) and the audit log says
 * who did it and for which request. The request stays open until the
 * steward marks it done, since it may name several files.
 */
export async function takeDownFile(catalog: Catalog, by: string, input: { sha256: string; report?: number }): Promise<void> {
  if (!/^[0-9a-f]{64}$/.test(input.sha256)) throw invalid('a file is named by its sha256');
  if (input.report !== undefined && !(await one(catalog.db, 'SELECT 1 FROM takedown WHERE report_id = $1', [input.report]))) throw notFound(`takedown request ${input.report}`);
  await setRights(catalog.db, by, input.sha256, 'preserved', input.report !== undefined ? `takedown request ${input.report}` : 'takedown');
}
