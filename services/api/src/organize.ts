import type { Context, Hono } from 'hono';
import { applyOrganize, catalogTree, previewOrganize, type Catalog, type OrganizePlan, type OrganizePreview } from '@rebbehub/core';
import { isEntityId, type EntityId } from '@rebbehub/model';
import { HttpError } from './app.js';

/**
 * Organizing the catalog (core/organize.ts), for the site, agents and
 * anyone's tools:
 *
 *   GET  /v1/tree?root=<set or sefer>&depth=&limit=   the tree, with counts
 *   POST /v1/organize/preview   { operations }         the change, saved nowhere
 *   POST /v1/organize           { operations, title?, description?, draft?, apply? }
 *                                                      one suggestion, sent for review
 *
 * `apply: true` also approves it at once when the person may approve it
 * themselves (stewards); for everyone else it waits for review like any
 * suggestion.
 */
export function organizeRoutes(app: Hono, catalog: Catalog, signedIn: (c: Context) => Promise<string>): void {
  const planOf = async (c: Context): Promise<OrganizePlan & { draft?: boolean; apply?: boolean }> => {
    let input: unknown;
    try {
      input = await c.req.json();
    } catch {
      throw new HttpError(400, 'the request body must be JSON');
    }
    if (!input || typeof input !== 'object' || !Array.isArray((input as OrganizePlan).operations)) throw new HttpError(400, 'give operations: a list of { op, … }');
    return input as OrganizePlan & { draft?: boolean; apply?: boolean };
  };
  // What a person or agent sees: everything but the full new versions (which can be long).
  const shown = ({ revisions: _revisions, ...preview }: OrganizePreview) => preview;

  app.get('/v1/tree', async (c) => {
    const raw = c.req.query('root');
    const root = raw ? raw.toLowerCase() : null;
    if (root !== null && !isEntityId(root)) throw new HttpError(400, `"${raw}" is not an id`);
    const number = (name: string) => {
      const value = c.req.query(name);
      if (value === undefined || value === '') return undefined;
      if (!/^\d{1,4}$/.test(value)) throw new HttpError(400, `${name} must be a whole number`);
      return Number(value);
    };
    return c.json(await catalogTree(catalog, { root: root as EntityId | null, depth: number('depth'), limit: number('limit') }));
  });

  app.post('/v1/organize/preview', async (c) => c.json(shown(await previewOrganize(catalog, await planOf(c)))));

  app.post('/v1/organize', async (c) => {
    const by = await signedIn(c);
    const plan = await planOf(c);
    const { suggestion, preview } = await applyOrganize(catalog, by, plan, { draft: plan.draft === true });
    let merged = suggestion.status === 'merged';
    let mayApprove = false;
    if (!merged && suggestion.status === 'open') {
      mayApprove = (await catalog.mayApprove(suggestion.id, by)).ok;
      if (plan.apply === true && mayApprove) {
        await catalog.merge(suggestion.id, by);
        merged = true;
      }
    }
    const now = await catalog.changeset(suggestion.id);
    return c.json({ suggestion: now, merged, mayApprove: merged ? false : mayApprove, preview: shown(preview) }, 201);
  });
}
