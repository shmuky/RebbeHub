import { isAddition, type AdditionKind, type EntityId, type WorkAddition } from '@rebbehub/model';
import type { Catalog, EntityView } from './catalog.js';
import { linkedPage } from './linked.js';

/**
 * The catalog's tree is fixed: the Rebbeim, their sefarim and the other
 * official sets, each sefer in its place. Every other book is an addition
 * to one of those sefarim (WorkData.addition: a commentary, an index, a
 * book about it, a collection from it), shown on that sefer's page and
 * never as a sefer of the tree. Another scan or format of the same book is
 * no addition: it is merged into the sefer (organize.ts, merge).
 *
 * `addition.to` is recorded as a link like any other (entity_ref, field
 * `addition.to`), so a sefer's additions are one statement, and the
 * store's checks keep every addition hung on an official sefer.
 */

/** Whether a work is one of the official sefarim the tree is built of (anything not a work is neither). */
export function isOfficial(view: Pick<EntityView, 'type' | 'data'>): boolean {
  return view.type === 'work' && !isAddition(view.data);
}

/** A work's addition, when it is one. */
export function additionOf(view: Pick<EntityView, 'type' | 'data'>): WorkAddition | null {
  if (view.type !== 'work' || !isAddition(view.data)) return null;
  return (view.data as unknown as { addition: WorkAddition }).addition;
}

/** The additions to a sefer, in their order, a page at a time, with how many there are: one statement for the count, one for the page. */
export async function additionsOf(catalog: Catalog, work: EntityId, options: { after?: string; limit?: number } = {}): Promise<{ items: EntityView[]; total: number; next: string | null }> {
  return linkedPage(catalog.db, work, { field: 'addition.to', type: 'work', after: options.after, limit: options.limit ?? 200 });
}

/** A sefer's additions grouped by kind, each group in its order (for a sefer's page). */
export function additionsByKind<T extends Pick<EntityView, 'type' | 'data'>>(items: readonly T[]): Map<AdditionKind, T[]> {
  const out = new Map<AdditionKind, T[]>();
  for (const item of items) {
    const a = additionOf(item);
    if (!a) continue;
    out.set(a.kind, [...(out.get(a.kind) ?? []), item]);
  }
  return out;
}

/**
 * The official sefer a work stands for in the tree: itself when it is
 * official, the sefer it is an addition to when it says which, and null
 * for an addition that belongs to no sefer (shown apart on its shelf).
 */
export async function seferOf(catalog: Catalog, work: EntityView): Promise<EntityView | null> {
  const a = additionOf(work);
  if (!a) return work.type === 'work' ? work : null;
  if (!a.to) return null;
  const to = await catalog.get(a.to);
  return to && isOfficial(to) ? to : null;
}
