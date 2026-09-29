import type { Db } from '@rebbehub/db';
import type { EntityType } from '@rebbehub/model';
import { invalid } from './errors.js';

/**
 * What search engines are told there is: every item with a page of its own,
 * in sitemaps of a bounded size, each saying when its items last changed.
 * Read straight from `entity` by type and id (migration 0019's index), never
 * item by item, so the whole catalog is listed in a few small queries
 * however large it grows.
 */

/** The kinds of item with a page worth finding from a search engine; the rest are parts of those pages. */
export const SITEMAP_TYPES: readonly EntityType[] = ['set', 'author', 'person', 'work', 'unit', 'event', 'publication', 'recording'];

/**
 * Items in one sitemap. The protocol allows 50,000 addresses; each item is
 * listed in both languages, so 10,000 items are 20,000 addresses, and a
 * sitemap stays a few megabytes.
 */
export const SITEMAP_PAGE_SIZE = 10_000;

export interface SitemapChunk {
  type: EntityType;
  /** From 1. */
  page: number;
  count: number;
  /** When the newest change to an item in it was merged; null when none is recorded. */
  lastmod: string | null;
}

export interface SitemapEntry {
  id: string;
  path: string | null;
  lastmod: string | null;
}

const iso = (at: Date | string | null): string | null => (at === null ? null : new Date(at).toISOString());

/** Every sitemap there is to list: each type cut into pages of `size` items (SITEMAP_PAGE_SIZE), in id order. */
export async function sitemapChunks(db: Db, options: { types?: readonly EntityType[]; size?: number } = {}): Promise<SitemapChunk[]> {
  const { types = SITEMAP_TYPES, size = SITEMAP_PAGE_SIZE } = options;
  const { rows } = await db.query<{ type: EntityType; page: number; count: number; lastmod: Date | string | null }>(
    `WITH listed AS (
       SELECT type, updated_seq, ((row_number() OVER (PARTITION BY type ORDER BY id)) - 1) / $2 AS chunk
       FROM entity WHERE type = ANY($1::text[]) AND main_rev IS NOT NULL AND NOT deleted
     ), chunks AS (
       SELECT type, chunk, count(*)::int AS count, max(updated_seq) AS seq FROM listed GROUP BY type, chunk
     )
     SELECT k.type, (k.chunk + 1)::int AS page, k.count, c.at AS lastmod
     FROM chunks k LEFT JOIN commit c ON c.seq = k.seq
     ORDER BY k.type, k.chunk`,
    [types, size],
  );
  return rows.map((r) => ({ type: r.type, page: Number(r.page), count: Number(r.count), lastmod: iso(r.lastmod) }));
}

/** One sitemap's items: the `page`th `size` items of a type, in id order, each with when it last changed. */
export async function sitemapPage(db: Db, type: EntityType, page: number, size = SITEMAP_PAGE_SIZE): Promise<SitemapEntry[]> {
  if (!SITEMAP_TYPES.includes(type)) throw invalid(`there is no sitemap of ${type}`);
  if (!Number.isInteger(page) || page < 1) throw invalid('page counts from 1');
  const { rows } = await db.query<{ id: string; path: string | null; lastmod: Date | string | null }>(
    `SELECT e.id, e.path, c.at AS lastmod
     FROM (SELECT id, path, updated_seq FROM entity
           WHERE type = $1 AND main_rev IS NOT NULL AND NOT deleted
           ORDER BY id OFFSET $2 LIMIT $3) e
     LEFT JOIN commit c ON c.seq = e.updated_seq
     ORDER BY e.id`,
    [type, (page - 1) * size, size],
  );
  return rows.map((r) => ({ id: r.id, path: r.path, lastmod: iso(r.lastmod) }));
}
