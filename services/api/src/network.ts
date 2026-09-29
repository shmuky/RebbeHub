import type { Hono } from 'hono';
import { catalogHealth, EMBEDDED_TYPES, relationsOf, searchMoments, searchSimilar, type Catalog, type Embedder } from '@rebbehub/core';
import { readId, type EntityType } from '@rebbehub/model';
import { HttpError } from './app.js';
import { PUBLIC_SUMMARY } from './platform.js';

/**
 * The API's phase-6 reading (the plan, section 9): search that lands on
 * the moment, search by meaning, an item's links both ways, and the
 * health of the catalog. Everything here reads; nothing needs an account.
 */

const whole = (value: string | undefined, name: string, max: number): number | undefined => {
  if (value === undefined || value === '') return undefined;
  if (!/^\d+$/.test(value)) throw new HttpError(400, `${name} must be a whole number`);
  return Math.min(Number(value), max);
};

export function networkRoutes(app: Hono, catalog: Catalog, options: { embedder?: Embedder | null }): void {
  // Lines on scans' pages and paragraphs of texts and transcripts where the words are: where to open, and whether a person has checked it.
  app.get('/v1/search/moments', async (c) => {
    const q = c.req.query('q') ?? '';
    return c.json({ query: q, moments: await searchMoments(catalog, q, { limit: whole(c.req.query('limit'), 'limit', 100) }) });
  });

  // Search by meaning: off (available: false) until the embeddings' keys are set. Every result is the machine's guess, and says so.
  app.get('/v1/search/similar', async (c) => {
    const q = (c.req.query('q') ?? '').trim();
    const embedder = options.embedder ?? null;
    if (!embedder) return c.json({ query: q, available: false, machine: true, results: [] });
    const types = (c.req.query('types') ?? '').split(',').filter(Boolean);
    for (const t of types) if (!EMBEDDED_TYPES.includes(t as EntityType)) throw new HttpError(400, `types are some of ${EMBEDDED_TYPES.join(', ')}`);
    if (!q) return c.json({ query: q, available: true, model: embedder.model, machine: true, results: [] });
    if (q.length > 1000) throw new HttpError(400, 'ask in at most 1,000 characters');
    const results = await searchSimilar(catalog, embedder, q, { limit: whole(c.req.query('limit'), 'limit', 50), types: types.length ? (types as EntityType[]) : undefined });
    return c.json({ query: q, available: true, model: embedder.model, machine: true, results } as Record<string, unknown>);
  });

  // An item's links: what it cites, where it was printed, the farbrengen it is based on, and what cites it.
  app.get('/v1/entities/:id/relations', async (c) => {
    const id = readId(c.req.param('id'));
    if (!id) throw new HttpError(400, `"${c.req.param('id')}" is not an id (rh-…)`);
    return c.json({ relations: await relationsOf(catalog, id) });
  });

  // Coverage per year and set, pages nobody checked, recordings not synced, links that do not answer, suggestions waiting longest.
  app.get('/v1/health', async (c) => c.json((await catalogHealth(catalog, { limit: whole(c.req.query('limit'), 'limit', 500) })) as unknown as Record<string, unknown>, 200, { 'Cache-Control': PUBLIC_SUMMARY }));
}
