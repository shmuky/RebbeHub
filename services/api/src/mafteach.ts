import type { Hono } from 'hono';
import { mafteach, type Catalog } from '@rebbehub/core';
import { readId } from '@rebbehub/model';
import { HttpError } from './app.js';
import { edgeCached } from './machine.js';

/**
 * A sefer's whole subject index on one page (core/mafteach.ts):
 *
 *   GET /v1/mafteach?index=&sefer=&letter=&q=&limit=&places=&offset=
 *       index  the index: a work whose units are its volumes' index pages (an id, or its path)
 *       sefer  the sefer it indexes, for each place's link to the sicha's page (an id, or its path)
 *       letter one first letter's topics, or
 *       q      the topics whose name, context or sicha holds these words
 *
 * Kept five minutes at the edge; the index is built once and kept until
 * one of its pages changes.
 */
export function mafteachRoutes(app: Hono, catalog: Catalog): void {
  const item = async (raw: string | undefined, name: string) => {
    if (!raw) return null;
    const id = readId(raw);
    if (id) return id;
    if (!raw.startsWith('/')) throw new HttpError(400, `${name} is an id (rh-…) or a path (/…)`);
    const found = await catalog.resolvePath(raw);
    if (!found) throw new HttpError(404, `nothing at ${raw}`);
    return found.id;
  };
  const whole = (raw: string | undefined, name: string, fallback: number, max: number) => {
    const n = raw === undefined ? fallback : Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > max) throw new HttpError(400, `${name} is a whole number from 0 to ${max}`);
    return n;
  };

  app.get('/v1/mafteach', async (c) => {
    const q = c.req.query('q')?.trim().slice(0, 200) || undefined;
    const letter = c.req.query('letter')?.trim() || undefined;
    const limit = whole(c.req.query('limit'), 'limit', 60, 200);
    const places = whole(c.req.query('places'), 'places', 400, 5000);
    const offset = whole(c.req.query('offset'), 'offset', 0, 100_000);
    return edgeCached(c.req.raw, 300, async () => {
      const index = await item(c.req.query('index'), 'index');
      if (!index) throw new HttpError(400, 'say which index (index=/likkutei-sichos-mafteach-inyanim)');
      const answer = await mafteach(catalog, index, { seferId: await item(c.req.query('sefer'), 'sefer'), letter, q, limit: Math.max(limit, 1), places: Math.max(places, 1), offset });
      if (!answer) throw new HttpError(404, 'no such index');
      return Response.json(answer);
    });
  });
}

