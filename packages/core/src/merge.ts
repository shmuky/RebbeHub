import { isEntityId } from '@rebbehub/model';

/**
 * Three-way merge of an item's data against the version a suggestion was
 * written from (docs/plans/rebbehub.md, section 6, "Merging"):
 *
 * - fields are merged one by one, nested objects field by field, so one
 *   person fixing the English title and another the date never clash;
 * - lists of ids (sets, authors, events) merge as sets: what either side
 *   added is kept, what either side removed is gone;
 * - lists of items with their own `id` (a page's lines) merge item by
 *   item, so two people fixing different lines of a page never clash;
 * - any other list, and any plain value, is one field.
 *
 * A real clash - both sides changed the same field to different values -
 * is returned as a conflict for the reviewer to decide ("A says 10 Shvat,
 * B says 11 Shvat"); it never goes back to the contributor.
 */

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export interface Conflict {
  /** JSON Pointer to the field: `/date`, `/title/en`, `/lines/b7/text` (list items by their id). An empty path is the whole item. */
  path: string;
  base: Json | undefined;
  ours: Json | undefined;
  theirs: Json | undefined;
}

export interface MergeResult {
  /** The merge, with each conflicting field left as `ours` until resolved. `null` when the item ends up deleted. */
  merged: Json | null;
  conflicts: Conflict[];
}

/** How a reviewer settled a conflict: one side, or a value of their own. */
export type Resolution = { take: 'ours' } | { take: 'theirs' } | { value: Json | undefined };

/**
 * Whether two values are the same JSON - what `canonicalJson` would write
 * alike: `undefined` members dropped, keys in any order - found by walking
 * them, not by writing them out. A suggestion's page compares each of its
 * items whole, words and all, then field by field, and writing every
 * sicha's text out twice at every level was most of the page's CPU.
 */
function same(a: Json | undefined, b: Json | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!same(a[i] ?? null, b[i] ?? null)) return false;
    return true;
  }
  const keys = Object.keys(a).filter((key) => a[key] !== undefined);
  if (keys.length !== Object.keys(b).filter((key) => b[key] !== undefined).length) return false;
  for (const key of keys) if (b[key] === undefined || !same(a[key], b[key])) return false;
  return true;
}

const isObject = (v: Json | undefined): v is { [key: string]: Json } => typeof v === 'object' && v !== null && !Array.isArray(v);

const isIdList = (v: Json | undefined): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string' && isEntityId(x));

const isKeyedList = (v: Json | undefined): v is Array<{ id: string } & { [key: string]: Json }> =>
  Array.isArray(v) && v.length > 0 && v.every((x) => isObject(x) && typeof x.id === 'string') && new Set(v.map((x) => (x as { id: string }).id)).size === v.length;

const pointer = (path: string, key: string) => `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`;

function mergeValue(base: Json | undefined, ours: Json | undefined, theirs: Json | undefined, path: string, conflicts: Conflict[]): Json | undefined {
  if (same(ours, theirs)) return ours;
  if (same(base, ours)) return theirs;
  if (same(base, theirs)) return ours;
  // Both changed it, differently: look inside when the shape allows.
  if (isObject(ours) && isObject(theirs) && (base === undefined || isObject(base))) return mergeObject(base ?? {}, ours, theirs, path, conflicts);
  if ((isIdList(ours) || (Array.isArray(ours) && ours.length === 0)) && (isIdList(theirs) || (Array.isArray(theirs) && theirs.length === 0)) && (base === undefined || isIdList(base) || (Array.isArray(base) && base.length === 0))) {
    return mergeIdList((base as string[] | undefined) ?? [], ours as string[], theirs as string[]);
  }
  if (isKeyedList(ours) && isKeyedList(theirs) && (base === undefined || isKeyedList(base) || (Array.isArray(base) && base.length === 0))) {
    return mergeKeyedList((base as Array<{ id: string } & { [key: string]: Json }> | undefined) ?? [], ours, theirs, path, conflicts);
  }
  conflicts.push({ path, base, ours, theirs });
  return ours;
}

function mergeObject(base: { [key: string]: Json }, ours: { [key: string]: Json }, theirs: { [key: string]: Json }, path: string, conflicts: Conflict[]): Json {
  const out: { [key: string]: Json } = {};
  const keys = [...new Set([...Object.keys(ours), ...Object.keys(theirs), ...Object.keys(base)])];
  for (const key of keys) {
    const value = mergeValue(base[key], ours[key], theirs[key], pointer(path, key), conflicts);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function mergeIdList(base: string[], ours: string[], theirs: string[]): string[] {
  const removed = new Set([...base.filter((x) => !ours.includes(x)), ...base.filter((x) => !theirs.includes(x))]);
  const out = ours.filter((x) => !removed.has(x));
  for (const x of theirs) if (!removed.has(x) && !out.includes(x)) out.push(x);
  return out;
}

function mergeKeyedList(
  base: Array<{ id: string } & { [key: string]: Json }>,
  ours: Array<{ id: string } & { [key: string]: Json }>,
  theirs: Array<{ id: string } & { [key: string]: Json }>,
  path: string,
  conflicts: Conflict[],
): Json[] {
  const byId = (list: typeof base) => new Map(list.map((x) => [x.id, x as Json]));
  const b = byId(base);
  const o = byId(ours);
  const t = byId(theirs);
  const merged = new Map<string, Json>();
  for (const id of new Set([...o.keys(), ...t.keys(), ...b.keys()])) {
    const value = mergeValue(b.get(id), o.get(id), t.get(id), pointer(path, id), conflicts);
    if (value !== undefined) merged.set(id, value);
  }
  // Our order, with items only they added placed after the item before them in theirs.
  const order = ours.map((x) => x.id).filter((id) => merged.has(id));
  theirs.forEach((item, i) => {
    if (order.includes(item.id) || !merged.has(item.id)) return;
    const before = theirs
      .slice(0, i)
      .map((x) => x.id)
      .reverse()
      .find((id) => order.includes(id));
    order.splice(before === undefined ? 0 : order.indexOf(before) + 1, 0, item.id);
  });
  return order.map((id) => merged.get(id)!);
}

/**
 * Merges `theirs` (the suggestion) into `ours` (main as it is now), both
 * made from `base`. `null` data means the item is deleted on that side.
 */
export function threeWayMerge(base: Json | null, ours: Json | null, theirs: Json | null): MergeResult {
  const conflicts: Conflict[] = [];
  if (same(ours, theirs)) return { merged: ours, conflicts };
  if (same(base, ours)) return { merged: theirs, conflicts };
  if (same(base, theirs)) return { merged: ours, conflicts };
  // One side deleted it and the other changed it: the reviewer decides.
  if (ours === null || theirs === null || base === null) {
    conflicts.push({ path: '', base: base ?? undefined, ours: ours ?? undefined, theirs: theirs ?? undefined });
    return { merged: ours, conflicts };
  }
  const merged = mergeValue(base, ours, theirs, '', conflicts);
  return { merged: merged ?? null, conflicts };
}

function unescape(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

/** Sets the value at a conflict path; list items are addressed by their `id`. */
function setAt(target: Json | null, path: string, value: Json | undefined): Json | null {
  if (path === '') return value === undefined ? null : value;
  const segments = path.slice(1).split('/').map(unescape);
  const root = structuredClone(target) as Json;
  let node: Json = root;
  for (let i = 0; i < segments.length; i++) {
    const key = segments[i]!;
    const last = i === segments.length - 1;
    if (Array.isArray(node)) {
      const index = node.findIndex((x) => isObject(x) && x.id === key);
      if (last) {
        if (value === undefined) {
          if (index >= 0) node.splice(index, 1);
        } else if (index >= 0) node[index] = value;
        else node.push(value);
        return root;
      }
      if (index < 0) throw new RangeError(`no item "${key}" at ${path}`);
      node = node[index]!;
    } else if (isObject(node)) {
      if (last) {
        if (value === undefined) delete node[key];
        else node[key] = value;
        return root;
      }
      if (!(key in node)) node[key] = {};
      node = node[key]!;
    } else {
      throw new RangeError(`cannot set ${path}`);
    }
  }
  return root;
}

/** Applies a reviewer's decisions to a merge. Every conflict must be decided. */
export function resolveConflicts(result: MergeResult, resolutions: Record<string, Resolution>): Json | null {
  let merged = result.merged;
  for (const conflict of result.conflicts) {
    const resolution = resolutions[conflict.path];
    if (!resolution) throw new UnresolvedConflictError([conflict]);
    const value = 'take' in resolution ? (resolution.take === 'ours' ? conflict.ours : conflict.theirs) : resolution.value;
    merged = setAt(merged, conflict.path, value);
  }
  return merged;
}

export class UnresolvedConflictError extends Error {
  constructor(readonly conflicts: Conflict[]) {
    super(`${conflicts.length} conflict(s) need a decision: ${conflicts.map((c) => c.path || '(whole item)').join(', ')}`);
    this.name = 'UnresolvedConflictError';
  }
}

export interface FieldChange {
  path: string;
  before: Json | undefined;
  after: Json | undefined;
}

/** What changed between two versions, field by field, for the reviewer's before/after view. */
export function diffData(before: Json | null, after: Json | null, path = ''): FieldChange[] {
  if (same(before ?? undefined, after ?? undefined)) return [];
  if (isObject(before ?? undefined) && isObject(after ?? undefined)) {
    const b = before as { [key: string]: Json };
    const a = after as { [key: string]: Json };
    return [...new Set([...Object.keys(b), ...Object.keys(a)])].sort().flatMap((key) => diffData(b[key] ?? null, a[key] ?? null, pointer(path, key)));
  }
  if (isKeyedList(before ?? undefined) && isKeyedList(after ?? undefined)) {
    const b = new Map((before as Array<{ id: string }>).map((x) => [x.id, x as unknown as Json]));
    const a = new Map((after as Array<{ id: string }>).map((x) => [x.id, x as unknown as Json]));
    const changes = [...new Set([...b.keys(), ...a.keys()])].flatMap((id) => diffData(b.get(id) ?? null, a.get(id) ?? null, pointer(path, id)));
    return changes.length > 0 ? changes : [{ path, before: before ?? undefined, after: after ?? undefined }]; // reordered only
  }
  return [{ path, before: before ?? undefined, after: after ?? undefined }];
}
