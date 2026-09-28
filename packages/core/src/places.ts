import type { Catalog } from './catalog.js';
import { invalid } from './errors.js';

/**
 * Where a person stopped (migration 0014): the page of a PDF in the reader,
 * the part and moment of a farbrengen in the player. The site keeps the
 * same in the browser for everyone; for a signed-in person it is kept here
 * too, so their phone opens where their computer stopped, and the home
 * page offers "continue reading" and "continue listening".
 *
 * A place is personal and small. It is never part of the catalog, the
 * mirror or the dumps, and each account keeps only its latest ones.
 */

export type PlaceKind = 'read' | 'listen';

export interface ReadingPlace {
  kind: PlaceKind;
  /** What it is a place in: a PDF's address for reading, an event's page for listening. */
  key: string;
  title: string;
  sub: string | null;
  /** The site's own address that reopens it (`/read?src=…`, `/events/5742-05-10`). */
  href: string;
  /** What the page needs to reopen there: `{ page }` for reading, `{ queue, index, time }` for listening. */
  place: Record<string, unknown>;
  updatedAt: string;
}

/** How many places an account keeps; the oldest go first. */
export const MAX_PLACES = 60;
/** The largest `place` kept, in characters of JSON (a farbrengen's queue of parts fits easily). */
export const MAX_PLACE_JSON = 16_000;

function toPlace(r: { kind: PlaceKind; key: string; title: string; sub: string | null; href: string; place: Record<string, unknown> | string; updated_at: Date | string }): ReadingPlace {
  return { kind: r.kind, key: r.key, title: r.title, sub: r.sub, href: r.href, place: typeof r.place === 'string' ? JSON.parse(r.place) : r.place, updatedAt: new Date(r.updated_at).toISOString() };
}

/** Keeps where `by` stopped in one thing, replacing the place kept before. */
export async function savePlace(catalog: Catalog, by: string, input: { kind?: unknown; key?: unknown; title?: unknown; sub?: unknown; href?: unknown; place?: unknown }): Promise<ReadingPlace> {
  const kind = input.kind;
  if (kind !== 'read' && kind !== 'listen') throw invalid('a place is for reading (read) or listening (listen)');
  if (typeof input.key !== 'string' || !input.key || input.key.length > 1000) throw invalid('a place needs a key of 1 to 1000 characters');
  if (typeof input.title !== 'string' || !input.title.trim()) throw invalid('a place needs a title');
  // Only the site's own addresses: a place is reopened by following it.
  if (typeof input.href !== 'string' || !/^\/(?!\/)/.test(input.href) || input.href.length > 2000) throw invalid('a place is reopened at an address on this site (starting with one /)');
  if (!input.place || typeof input.place !== 'object' || Array.isArray(input.place)) throw invalid('a place needs where it is (place)');
  const json = JSON.stringify(input.place);
  if (json.length > MAX_PLACE_JSON) throw invalid(`a place is at most ${MAX_PLACE_JSON} characters`);
  const sub = typeof input.sub === 'string' && input.sub.trim() ? input.sub.trim().slice(0, 300) : null;
  const { rows } = await catalog.db.query<Parameters<typeof toPlace>[0]>(
    `INSERT INTO auth.reading_place (account_id, kind, key, title, sub, href, place, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (account_id, kind, key) DO UPDATE SET title = excluded.title, sub = excluded.sub, href = excluded.href, place = excluded.place, updated_at = now()
     RETURNING kind, key, title, sub, href, place, updated_at`,
    [by, kind, input.key, input.title.trim().slice(0, 300), sub, input.href, json],
  );
  await catalog.db.query(
    `DELETE FROM auth.reading_place WHERE account_id = $1 AND (kind, key) NOT IN (
       SELECT kind, key FROM auth.reading_place WHERE account_id = $1 ORDER BY updated_at DESC LIMIT ${MAX_PLACES})`,
    [by],
  );
  return toPlace(rows[0]!);
}

/** Where `by` stopped lately, the latest first. */
export async function listPlaces(catalog: Catalog, by: string, options: { kind?: PlaceKind; key?: string; limit?: number } = {}): Promise<ReadingPlace[]> {
  const params: unknown[] = [by];
  const where = ['account_id = $1'];
  if (options.kind) where.push(`kind = $${params.push(options.kind)}`);
  if (options.key) where.push(`key = $${params.push(options.key)}`);
  const limit = Math.max(1, Math.min(options.limit ?? 20, MAX_PLACES));
  const { rows } = await catalog.db.query<Parameters<typeof toPlace>[0]>(
    `SELECT kind, key, title, sub, href, place, updated_at FROM auth.reading_place WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT ${limit}`,
    params,
  );
  return rows.map(toPlace);
}

/** Forgets one place ("remove from continue"). */
export async function forgetPlace(catalog: Catalog, by: string, kind: PlaceKind, key: string): Promise<void> {
  await catalog.db.query('DELETE FROM auth.reading_place WHERE account_id = $1 AND kind = $2 AND key = $3', [by, kind, key]);
}
