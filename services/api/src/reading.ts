import type { Context, Hono } from 'hono';
import { addTranslation, fixTranslation, forgetPlace, listPlaces, savePlace, type Catalog, type PlaceKind } from '@rebbehub/core';
import { readId, type EntityId } from '@rebbehub/model';

/**
 * A reader's own things: where they stopped reading and listening
 * (packages/core/src/places.ts), and translations of a unit, added and
 * fixed as Suggestions (packages/core/src/translations.ts).
 *
 *   GET    /v1/places?kind=&key=&limit=     where the signed-in person stopped lately
 *   PUT    /v1/places                       keeps a place { kind, key, title, sub, href, place }
 *   DELETE /v1/places?kind=&key=            forgets one
 *   POST   /v1/units/<id>/translations      { language, credit, licence?, translationOf?, content, machine? }
 *   POST   /v1/translations/fix             { segment, content }
 */

type Fail = (status: 400 | 401, message: string) => never;

export function readingRoutes(app: Hono, catalog: Catalog, signedIn: (c: Context) => Promise<string>, fail: Fail): void {
  const json = async <T>(c: Context): Promise<T> => {
    try {
      return (await c.req.json()) as T;
    } catch {
      return fail(400, 'the request body must be JSON');
    }
  };
  const kindOf = (value: string | undefined): PlaceKind | undefined => {
    if (value === undefined) return undefined;
    if (value !== 'read' && value !== 'listen') fail(400, 'kind is read or listen');
    return value as PlaceKind;
  };

  // Personal: never cached anywhere.
  app.get('/v1/places', async (c) => {
    const by = await signedIn(c);
    const limit = Number(c.req.query('limit') ?? 20);
    const places = await listPlaces(catalog, by, { kind: kindOf(c.req.query('kind')), key: c.req.query('key') || undefined, limit: Number.isFinite(limit) ? limit : 20 });
    return c.json({ places }, 200, { 'Cache-Control': 'no-store' });
  });

  app.put('/v1/places', async (c) => {
    const by = await signedIn(c);
    return c.json(await savePlace(catalog, by, await json(c)), 200, { 'Cache-Control': 'no-store' });
  });

  app.delete('/v1/places', async (c) => {
    const by = await signedIn(c);
    const kind = kindOf(c.req.query('kind'));
    const key = c.req.query('key');
    if (!kind || !key) fail(400, 'say which place (kind and key)');
    await forgetPlace(catalog, by, kind!, key!);
    return c.json({ ok: true });
  });

  app.post('/v1/units/:id/translations', async (c) => {
    const by = await signedIn(c);
    const unit = readId(c.req.param('id'));
    if (!unit) fail(400, `"${c.req.param('id')}" is not an id`);
    const input = await json<{ language?: string; credit?: string; licence?: string; translationOf?: string; content?: string; machine?: string }>(c);
    if (typeof input.language !== 'string' || typeof input.credit !== 'string' || typeof input.content !== 'string') fail(400, 'give language, credit and content');
    const translationOf = input.translationOf ? (readId(input.translationOf) ?? fail(400, 'translationOf is an id')) : undefined;
    const suggestion = await addTranslation(catalog, by, {
      unit: unit!,
      language: input.language!,
      credit: input.credit!,
      licence: input.licence || undefined,
      translationOf: translationOf as EntityId | undefined,
      content: input.content!,
      machine: input.machine || undefined,
    });
    return c.json(suggestion, 201);
  });

  app.post('/v1/translations/fix', async (c) => {
    const by = await signedIn(c);
    const input = await json<{ segment?: string; content?: string }>(c);
    const segment = input.segment ? readId(input.segment) : null;
    if (!segment || typeof input.content !== 'string') fail(400, 'give segment and content');
    return c.json(await fixTranslation(catalog, by, { segment: segment!, content: input.content! }), 201);
  });
}
