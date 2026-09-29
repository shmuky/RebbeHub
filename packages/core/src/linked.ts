import { one, type Db } from '@rebbehub/db';
import type { EntityId, EntityType } from '@rebbehub/model';
import { FACTS, type EntityView, type RevisionRow } from './catalog.js';
import { invalid } from './errors.js';

/**
 * What belongs to an item, all of it (the plan's promise "one permanent
 * page per item with all its printings, scans, texts, recordings"): a set
 * lists every sefer in it, a sefer every sicha, a farbrengen every
 * recording, a person every farbrengen they were at - whatever points at
 * the item, grouped by kind and field, with how many there are, a page at a
 * time. A page never ends a list without saying how much more there is.
 *
 * Items come in their own order: by `order` (a sefer's units, a text's
 * paragraphs), then date (farbrengens), then part (a farbrengen's
 * recordings), then page (a teshura's contents), then path.
 */

/** One kind of thing pointing at an item through one field, and how many there are. */
export interface LinkGroup {
  type: EntityType;
  field: string;
  count: number;
}

/** How the items pointing at an item are grouped, largest group first. */
export async function linkedCounts(db: Db, id: EntityId): Promise<LinkGroup[]> {
  const { rows } = await db.query<LinkGroup>(
    `SELECT e.type, x.field, count(*)::int AS count FROM entity_ref x JOIN entity e ON e.id = x.from_id AND NOT e.deleted AND e.main_rev IS NOT NULL
     WHERE x.to_id = $1 GROUP BY e.type, x.field ORDER BY count(*) DESC, e.type, x.field`,
    [id],
  );
  return rows;
}

/** The sort key: order, date, part, page, path, id - each padded so text order is their order. */
const SORT_KEY = `(coalesce(r.data->>'order', '') || chr(1) || coalesce(r.data->>'date', '') || chr(1) || lpad(coalesce(r.data->>'part', ''), 6, '0') || chr(1)
  || lpad(coalesce(r.data->'pages'->>'from', r.data->>'page', ''), 6, '0') || chr(1) || coalesce(e.path, '') || chr(1) || e.id) COLLATE "C"`;

const FIELD = /^[a-z][a-zA-Z]{0,40}$/;

/** A cursor is the last item's sort key, carried in links as base64url (without Node's Buffer: the API runs on Workers too). */
const encode = (key: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(key)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const decode = (cursor: string) => {
  if (!/^[A-Za-z0-9_-]{1,2000}$/.test(cursor)) throw invalid('not a cursor');
  try {
    const bytes = atob(cursor.replace(/-/g, '+').replace(/_/g, '/'));
    return new TextDecoder().decode(Uint8Array.from(bytes, (c) => c.charCodeAt(0)));
  } catch {
    throw invalid('not a cursor');
  }
};

/**
 * One group of what points at each of several items (through `field`, of
 * `type` when given), in the group's order, at most `limit` for each: a
 * sefer's page asks once for all its sichos' texts and a farbrengen's once
 * for its sichos' words, where each used to ask for every row (a volume
 * of Igros Kodesh made 166 requests). One statement, however many items.
 */
export async function linkedOfEach(db: Db, ids: readonly EntityId[], options: { field: string; type?: EntityType; limit?: number }): Promise<Map<EntityId, EntityView[]>> {
  if (!FIELD.test(options.field)) throw invalid('say which field points here (field=work)');
  const out = new Map<EntityId, EntityView[]>();
  const wanted = [...new Set(ids)].slice(0, 200);
  if (!wanted.length) return out;
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
  const params: unknown[] = [wanted, options.field];
  const typed = options.type ? `AND e.type = $${params.push(options.type)}` : '';
  const { rows } = await db.query<RevisionRow & { to: EntityId; n: number }>(
    `SELECT * FROM (
       SELECT x.to_id AS "to", ${FACTS}, row_number() OVER (PARTITION BY x.to_id ORDER BY ${SORT_KEY}) AS n
       FROM entity_ref x JOIN entity e ON e.id = x.from_id AND NOT e.deleted AND e.main_rev IS NOT NULL JOIN revision r ON r.id = e.main_rev
       WHERE x.to_id = ANY($1::text[]) AND x.field = $2 ${typed}
     ) l WHERE l.n <= ${limit} ORDER BY l."to", l.n`,
    params,
  );
  for (const r of rows) {
    const list = out.get(r.to) ?? out.set(r.to, []).get(r.to)!;
    list.push({ id: r.entity_id, type: r.entity_type, path: r.path, rev: r.id, data: r.data! });
  }
  return out;
}

/**
 * What a list says of each of several texts without reading their words:
 * how many paragraphs each has (headings aside) and how many of them a
 * person checked (`proofread`). One statement.
 */
export async function textsProgress(db: Db, texts: readonly EntityId[]): Promise<Map<EntityId, { paragraphs: number; checked: number }>> {
  const out = new Map<EntityId, { paragraphs: number; checked: number }>();
  const wanted = [...new Set(texts)].slice(0, 200);
  if (!wanted.length) return out;
  const { rows } = await db.query<{ text: EntityId; paragraphs: number; checked: number }>(
    `SELECT x.to_id AS text,
            count(*) FILTER (WHERE coalesce(r.data->>'kind', '') <> 'heading')::int AS paragraphs,
            count(*) FILTER (WHERE coalesce(r.data->>'kind', '') <> 'heading' AND coalesce((r.data->>'proofread')::int, 0) >= 1)::int AS checked
     FROM entity_ref x JOIN entity e ON e.id = x.from_id AND e.type = 'segment' AND NOT e.deleted AND e.main_rev IS NOT NULL JOIN revision r ON r.id = e.main_rev
     WHERE x.to_id = ANY($1::text[]) AND x.field = 'text' GROUP BY x.to_id`,
    [wanted],
  );
  for (const r of rows) out.set(r.text, { paragraphs: r.paragraphs, checked: r.checked });
  return out;
}

/**
 * One page of what points at an item through `field` (and is of `type`,
 * when given), in order, with how many there are in all and the cursor
 * for the next page (null on the last).
 */
export async function linkedPage(
  db: Db,
  id: EntityId,
  options: { field: string; type?: EntityType; after?: string; limit?: number },
): Promise<{ items: EntityView[]; total: number; next: string | null }> {
  if (!FIELD.test(options.field)) throw invalid('say which field points here (field=work)');
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const params: unknown[] = [id, options.field];
  const typed = options.type ? `AND e.type = $${params.push(options.type)}` : '';
  const total = (await one<{ n: number }>(
    db,
    `SELECT count(*)::int AS n FROM entity_ref x JOIN entity e ON e.id = x.from_id AND NOT e.deleted AND e.main_rev IS NOT NULL WHERE x.to_id = $1 AND x.field = $2 ${typed}`,
    params,
  ))!.n;
  const after = options.after ? `AND ${SORT_KEY} > $${params.push(decode(options.after))}` : '';
  const { rows } = await db.query<RevisionRow & { sort_key: string }>(
    `SELECT ${FACTS}, ${SORT_KEY} AS sort_key FROM entity_ref x JOIN entity e ON e.id = x.from_id AND NOT e.deleted AND e.main_rev IS NOT NULL JOIN revision r ON r.id = e.main_rev
     WHERE x.to_id = $1 AND x.field = $2 ${typed} ${after}
     ORDER BY ${SORT_KEY} LIMIT ${limit + 1}`,
    params,
  );
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  return {
    items: page.map((r) => ({ id: r.entity_id, type: r.entity_type, path: r.path, rev: r.id, data: r.data! })),
    total,
    next: more && page.length ? encode(page[page.length - 1]!.sort_key) : null,
  };
}
