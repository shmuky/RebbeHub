import { ADDITION_KINDS, isEntityId, isEntityPath, isOrderKey, newId, orderBetween, slugify, type AdditionKind, type EntityId, type EntityType, type LocalName } from '@rebbehub/model';
import type { Catalog, ChangesetRow, EntityView } from './catalog.js';
import { invalid, notFound } from './errors.js';
import { diffData, type FieldChange, type Json } from './merge.js';

/**
 * Organizing the catalog by hand: moving sefarim between sets, sets under
 * other sets, sichos between sefarim; renaming, putting in order, making
 * and removing sets, merging duplicates and splitting a sefer in two.
 *
 * Every plan is a list of operations. It is worked out here against main
 * as it is now, item by item, into the new versions it needs, and becomes
 * ONE Suggestion (however many items it touches), reviewed like anyone's.
 * A preview gives the same result without saving anything, so a person
 * or an agent sees the change before sending it. The API, the site and the
 * MCP server all call these functions, so they organize the same way.
 *
 * Readable paths follow: a renamed sefer's sichos move with it
 * (`/likkutei-sichos/12/3` → `/likkutei-sichos-new/12/3`), and every old
 * path redirects once the suggestion is approved. A merged item's paths
 * lead to the item it was merged into (entity_forward, migration 0022).
 */

/** An item in a plan: its id, or `new:<key>` for a set the same plan makes. */
export type OrganizeRef = string;

/** Where a moved or reordered item goes among its new siblings. */
export type OrganizePosition = 'start' | 'end' | { after: OrganizeRef } | { before: OrganizeRef };

export type OrganizeOperation =
  /**
   * Move items under a new parent. Into a set: a sefer (or any item) joins
   * it, leaving `from` when given (`mode: 'only'` makes it the item's one
   * set); `to: null` with `from` takes it out of that set. A set moves
   * under another set, or to the top (`to: null`). A sicha moves to another
   * sefer, a printing to another sefer, a scan to another printing, a
   * recording to another farbrengen.
   */
  | { op: 'move'; items: OrganizeRef[]; to: OrganizeRef | null; from?: OrganizeRef; mode?: 'add' | 'only'; position?: OrganizePosition }
  /** One step up the tree: a set to its parent's parent; a sefer out of a set into that set's parent. */
  | { op: 'move-up'; items: OrganizeRef[]; from?: OrganizeRef }
  /** A new name (Hebrew, English), and optionally a new slug or a whole new path; old paths redirect. */
  | { op: 'rename'; item: OrganizeRef; name?: { he?: string; en?: string }; slug?: string; path?: string }
  /**
   * Put items in order among their siblings. Without `position`, the items
   * take the places they hold now in the order given (the whole list, or a
   * few swapped); with it, they go together to the start, the end, or
   * beside a sibling. `parent` says whose children they are where an item
   * has several (a sefer in two sets), and is null for the top sets.
   */
  | { op: 'reorder'; items: OrganizeRef[]; parent?: OrganizeRef | null; position?: OrganizePosition }
  /** A new set, under `parent` or at the top, optionally with items moved into it at once. */
  | { op: 'create-set'; key?: string; name: { he: string; en?: string }; slug: string; parent?: OrganizeRef | null; description?: { he: string; en?: string }; items?: OrganizeRef[]; path?: string }
  /** Removes a set that holds nothing (no sets under it, no items in it); its path leads to its parent. */
  | { op: 'delete-set'; item: OrganizeRef }
  /**
   * Merges duplicate `from` into `into` (the same type): everything under
   * or pointing at `from` moves to `into`, what `into` lacks is taken from
   * `from` (external ids, sets, editions and the like are joined), and
   * `from` is deleted, its paths leading to `into`.
   */
  | { op: 'merge'; from: OrganizeRef; into: OrganizeRef }
  /** Moves some of a sefer's units (a list, or a range from one to another) into a new sefer beside it. */
  | { op: 'split'; work: OrganizeRef; units?: OrganizeRef[]; range?: { from: OrganizeRef; to: OrganizeRef }; title: { he: string; en?: string }; slug: string; path?: string }
  /**
   * Marks a sefer as an addition (WorkData.addition): not one of the
   * official sefarim the tree is built of, but a commentary, an index, a
   * book about one, a collection: listed on the page of the official sefer
   * it belongs to (`to`), or, without one, apart at the end of its shelf.
   */
  | { op: 'addition'; item: OrganizeRef; to?: OrganizeRef | null; kind: AdditionKind }
  /** Makes an addition an official sefer again, listed on its shelves in their order. */
  | { op: 'official'; item: OrganizeRef };

export interface OrganizePlan {
  /** The suggestion's title; made from the operations when left out. */
  title?: string;
  description?: string;
  operations: OrganizeOperation[];
}

/** One item the plan changes, as the reviewer sees it. */
export interface OrganizeItem {
  id: EntityId;
  type: EntityType;
  name: string;
  isNew: boolean;
  deleted: boolean;
  pathBefore: string | null;
  path: string | null;
  changes: FieldChange[];
}

export interface OrganizePreview {
  title: string;
  /** One line per operation, in plain words. */
  summary: string[];
  items: OrganizeItem[];
  /** Old paths and where they lead once the suggestion is approved. */
  redirects: Array<{ id: EntityId; from: string; to: string | null }>;
  /** Items merged into others (and empty sets into their parents). */
  forwards: Array<{ from: EntityId; to: EntityId }>;
  warnings: string[];
  /** The new sets the plan makes, by their key. */
  created: Record<string, EntityId>;
  /** The versions to propose (internal: what the suggestion is made of). */
  revisions: Array<{ id: EntityId; type: EntityType; data: Json | null; path: string | null }>;
}

/** How many items one plan may touch: large enough for a sefer of thousands of sichos, small enough to review. */
export const MAX_ORGANIZE_ITEMS = 5000;
export const MAX_OPERATIONS = 200;

/** Which field a child points at its parent through, by child type and parent type. */
export const MOVE_FIELDS: Partial<Record<EntityType, Partial<Record<EntityType, string>>>> = {
  unit: { work: 'work' },
  publication: { work: 'work' },
  scan: { publication: 'publication' },
  'contents-map': { publication: 'publication' },
  recording: { event: 'event' },
  text: { unit: 'unit' },
  segment: { text: 'text' },
  'text-page': { 'text-layer': 'layer' },
  place: { place: 'within' },
  topic: { topic: 'broader' },
};

/** Parents an item can never be without. */
const REQUIRED_PARENT: Partial<Record<EntityType, string>> = { unit: 'work', scan: 'publication', segment: 'text', 'text-page': 'layer', 'contents-map': 'publication' };

/** Types kept in their own order among siblings (a fractional `order`, order.ts). */
const ORDERED: ReadonlySet<EntityType> = new Set(['unit', 'segment', 'set', 'work']);
/** Types whose order is required, so a moved one always gets a place. */
const ORDER_REQUIRED: ReadonlySet<EntityType> = new Set(['unit', 'segment']);

/** Fields a merge never takes from the duplicate: where it sits and what it is called in paths. */
const MERGE_KEEP: ReadonlySet<string> = new Set(['addition', 'parent', 'order', 'slug', 'position', 'work', 'publication', 'event', 'text', 'unit', 'layer', 'scan', 'policy', 'within', 'broader']);

const NAME_FIELDS = ['name', 'title', 'label'] as const;

type Data = Record<string, unknown>;

interface Entry {
  id: EntityId;
  type: EntityType;
  base: EntityView | null;
  data: Data | null;
  path: string | null;
}

interface Siblings {
  parent: EntityId | null;
  field: string;
  type: EntityType;
}

const clone = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));

/** An item's name in both languages, for plain-words summaries. */
export function nameOfData(data: Data | null | undefined, fallback: string): string {
  for (const field of NAME_FIELDS) {
    const value = data?.[field] as LocalName | undefined;
    if (value && typeof value === 'object') return [value.he, value.en].filter(Boolean).join(' / ') || fallback;
  }
  return fallback;
}

function nameFieldOf(data: Data): (typeof NAME_FIELDS)[number] | null {
  return NAME_FIELDS.find((f) => data[f] && typeof data[f] === 'object') ?? null;
}

/** `/a/b/c` → `/a/b`; a top-level path's parent is ''. */
const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/'));

/**
 * Keys for `count` items between two neighbours, as short as they can be:
 * the middle first, then each half.
 */
export function keysBetween(before: string | null, after: string | null, count: number): string[] {
  if (count <= 0) return [];
  const mid = orderBetween(before, after);
  const left = Math.floor((count - 1) / 2);
  return [...keysBetween(before, mid, left), mid, ...keysBetween(mid, after, count - 1 - left)];
}

/**
 * New keys for a list put in a new order, touching as few items as it
 * can: the longest run of items whose keys already rise is kept, and only
 * the others get keys between their kept neighbours. Returns the items
 * whose key changes.
 */
export function rekey(sequence: Array<{ id: string; order: string | null | undefined }>): Map<string, string> {
  const n = sequence.length;
  const valid = sequence.map((s) => (typeof s.order === 'string' && isOrderKey(s.order) ? s.order : null));
  // Longest strictly rising run of keys (patience sorting, with the path back).
  const tails: number[] = [];
  const prev = new Array<number>(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const key = valid[i] ?? null;
    if (key === null) continue;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (valid[tails[mid]!]! < key) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1]!;
    tails[lo] = i;
  }
  const kept = new Set<number>();
  for (let i = tails.length ? tails[tails.length - 1]! : -1; i >= 0; i = prev[i]!) kept.add(i);
  const out = new Map<string, string>();
  let i = 0;
  while (i < n) {
    if (kept.has(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && !kept.has(j)) j++;
    const before = i > 0 ? valid[i - 1]! : null;
    const after = j < n ? valid[j]! : null;
    const keys = keysBetween(before, after, j - i);
    for (let k = i; k < j; k++) out.set(sequence[k]!.id, keys[k - i]!);
    i = j;
  }
  return out;
}

/** Replaces one id with another everywhere in an item's data, joining lists that then hold it twice. */
function replaceId(value: unknown, from: string, to: string): unknown {
  if (value === from) return to;
  if (Array.isArray(value)) {
    const out = value.map((v) => replaceId(v, from, to));
    if (value.includes(from)) return out.filter((v, i) => typeof v !== 'string' || out.indexOf(v) === i);
    return out;
  }
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replaceId(v, from, to)]));
  return value;
}

function containsId(value: unknown, id: string): boolean {
  if (value === id) return true;
  if (Array.isArray(value)) return value.some((v) => containsId(v, id));
  if (value && typeof value === 'object') return Object.values(value).some((v) => containsId(v, id));
  return false;
}

/** What `into` takes from its duplicate `from`: what it lacks, lists joined, names in languages it has not got. */
function unionData(into: Data, from: Data, warnings: string[], label: string): Data {
  const out = clone(into);
  for (const [key, value] of Object.entries(from)) {
    if (MERGE_KEEP.has(key)) continue;
    const mine = out[key];
    if (mine === undefined) {
      out[key] = clone(value);
      continue;
    }
    if (Array.isArray(mine) && Array.isArray(value)) {
      const seen = new Set(mine.map((v) => JSON.stringify(v)));
      out[key] = [...mine, ...value.filter((v) => !seen.has(JSON.stringify(v)))];
      continue;
    }
    if (key === 'externalIds' && typeof mine === 'object' && typeof value === 'object') {
      const merged = { ...(value as Record<string, string>), ...(mine as Record<string, string>) };
      for (const [k, v] of Object.entries(value as Record<string, string>)) if ((mine as Record<string, string>)[k] !== undefined && (mine as Record<string, string>)[k] !== v) warnings.push(`${label}: kept its own ${k} (${(mine as Record<string, string>)[k]}), not the duplicate's (${v})`);
      out[key] = merged;
      continue;
    }
    if ((NAME_FIELDS as readonly string[]).includes(key) || key === 'description') {
      if (mine && typeof mine === 'object' && value && typeof value === 'object') out[key] = { ...(value as Data), ...(mine as Data) };
    }
  }
  return out;
}

class Workspace {
  readonly entries = new Map<EntityId, Entry>();
  readonly created = new Map<string, EntityId>();
  readonly forwards: Array<{ from: EntityId; to: EntityId }> = [];
  readonly warnings: string[] = [];
  readonly summary: string[] = [];

  constructor(readonly catalog: Catalog) {}

  ref(raw: OrganizeRef | null | undefined, what: string): EntityId {
    if (typeof raw !== 'string' || !raw) throw invalid(`say which ${what}`);
    if (raw.startsWith('new:')) {
      const id = this.created.get(raw.slice(4));
      if (!id) throw invalid(`${raw}: no set made earlier in this plan has that key`);
      return id;
    }
    const id = raw.toLowerCase();
    if (!isEntityId(id)) throw invalid(`"${raw}" is not an id (rh-…)`);
    return id as EntityId;
  }

  async load(id: EntityId): Promise<Entry> {
    const known = this.entries.get(id);
    if (known) {
      if (known.data === null) throw invalid(`${id} is removed earlier in this plan`);
      return known;
    }
    const view = await this.catalog.get(id);
    if (!view) throw notFound(`item ${id}`);
    const entry: Entry = { id, type: view.type, base: view, data: clone(view.data as Data), path: view.path };
    this.entries.set(id, entry);
    return entry;
  }

  /** Loads many at once (a sefer's thousands of sichos), a page of ids at a time. */
  async loadMany(ids: EntityId[]): Promise<Entry[]> {
    const missing = ids.filter((id) => !this.entries.has(id));
    for (let i = 0; i < missing.length; i += 500) {
      for (const view of await this.catalog.getMany(missing.slice(i, i + 500))) {
        if (!this.entries.has(view.id)) this.entries.set(view.id, { id: view.id, type: view.type, base: view, data: clone(view.data as Data), path: view.path });
      }
    }
    return ids.map((id) => this.entries.get(id)).filter((e): e is Entry => e !== undefined && e.data !== null);
  }

  add(entry: Entry): void {
    this.entries.set(entry.id, entry);
  }

  name(entry: Entry): string {
    return nameOfData(entry.data ?? (entry.base?.data as Data | undefined), entry.id);
  }

  /** Whether a path is free for `id` once the plan lands. */
  async pathFree(path: string, id: EntityId): Promise<boolean> {
    for (const e of this.entries.values()) if (e.id !== id && e.data !== null && e.path === path) return false;
    const { rows } = await this.catalog.db.query<{ id: EntityId }>('SELECT id FROM entity WHERE path = $1 AND NOT deleted', [path]);
    return rows.every((r) => {
      if (r.id === id) return true;
      const e = this.entries.get(r.id);
      return e !== undefined && (e.data === null || e.path !== path);
    });
  }

  async uniquePath(path: string, id: EntityId): Promise<string> {
    if (await this.pathFree(path, id)) return path;
    for (let n = 2; n < 100; n++) {
      const candidate = `${path}-${n}`;
      if (isEntityPath(candidate) && (await this.pathFree(candidate, id))) {
        this.warnings.push(`${path} was taken, so ${id} is at ${candidate}`);
        return candidate;
      }
    }
    throw invalid(`no free path near ${path}`);
  }

  /**
   * Gives an item a new path, and moves the paths made from it along
   * (a sefer's sichos under the sefer's path).
   */
  async setPath(entry: Entry, path: string | null): Promise<void> {
    const old = entry.path;
    if (old === path) return;
    entry.path = path;
    if (old === null || path === null) return;
    const prefix = `${old}/`;
    const { rows } = await this.catalog.db.query<{ id: EntityId }>(
      `SELECT DISTINCT e.id FROM entity e JOIN entity_ref x ON x.from_id = e.id AND x.to_id = $1
       WHERE e.path LIKE $2 AND NOT e.deleted AND e.main_rev IS NOT NULL`,
      [entry.id, `${prefix}%`],
    );
    const ids = new Set(rows.map((r) => r.id));
    for (const e of this.entries.values()) if (e.data !== null && e.path?.startsWith(prefix) && containsId(e.data, entry.id)) ids.add(e.id);
    this.limit(ids.size);
    for (const child of await this.loadMany([...ids])) {
      if (!child.path?.startsWith(prefix)) continue;
      child.path = await this.uniquePath(`${path}/${child.path.slice(prefix.length)}`, child.id);
    }
  }

  limit(more: number): void {
    if (this.entries.size + more > MAX_ORGANIZE_ITEMS * 2) throw invalid(`this plan touches too many items (at most ${MAX_ORGANIZE_ITEMS} in one suggestion); split it into parts`);
  }

  /** The set a set sits under, as the plan has it so far. */
  async parentOf(setId: EntityId): Promise<EntityId | null> {
    const entry = await this.load(setId);
    const parent = entry.data?.parent;
    return typeof parent === 'string' ? (parent as EntityId) : null;
  }

  /** Whether `candidate` is `ancestor` or lies under it (for a set: its parent chain; for places and topics: theirs). */
  async isUnder(candidate: EntityId, ancestor: EntityId, field = 'parent'): Promise<boolean> {
    let current: EntityId | null = candidate;
    for (let hop = 0; current !== null && hop < 100; hop++) {
      if (current === ancestor) return true;
      const entry = await this.load(current);
      const up = entry.data?.[field];
      current = typeof up === 'string' ? (up as EntityId) : null;
    }
    return false;
  }

  /** The siblings of a kind under a parent, as the plan has them so far, in their order. */
  async children(ctx: Siblings): Promise<Entry[]> {
    const params: unknown[] = [ctx.type];
    let sql: string;
    if (ctx.parent === null) {
      sql = `SELECT e.id FROM entity e JOIN revision r ON r.id = e.main_rev
             WHERE e.type = $1 AND NOT e.deleted AND NOT (r.data ? '${ctx.field}')`;
    } else {
      params.push(ctx.parent, ctx.field);
      sql = `SELECT DISTINCT e.id FROM entity_ref x JOIN entity e ON e.id = x.from_id AND NOT e.deleted AND e.main_rev IS NOT NULL
             WHERE e.type = $1 AND x.to_id = $2 AND x.field = $3`;
    }
    const { rows } = await this.catalog.db.query<{ id: EntityId }>(sql, params);
    this.limit(rows.length);
    const ids = new Set(rows.map((r) => r.id));
    for (const e of this.entries.values()) if (e.type === ctx.type) ids.add(e.id);
    const all = await this.loadMany([...ids]);
    const under = all.filter((e) => this.pointsAt(e, ctx));
    return under.sort((a, b) => {
      const ka = typeof a.data!.order === 'string' ? (a.data!.order as string) : '~';
      const kb = typeof b.data!.order === 'string' ? (b.data!.order as string) : '~';
      if (ka !== kb) return ka < kb ? -1 : 1;
      const pa = a.path ?? '';
      const pb = b.path ?? '';
      return pa !== pb ? (pa < pb ? -1 : 1) : a.id < b.id ? -1 : 1;
    });
  }

  pointsAt(entry: Entry, ctx: Siblings): boolean {
    if (entry.data === null || entry.type !== ctx.type) return false;
    const value = entry.data[ctx.field];
    if (ctx.parent === null) return value === undefined || value === null;
    if (Array.isArray(value)) return value.includes(ctx.parent);
    return value === ctx.parent;
  }

  /** Whose children an item is, for ordering it: given the parent where it has several (a sefer's sets). */
  siblingsOf(entry: Entry, parent?: EntityId | null): Siblings {
    const data = entry.data!;
    if (entry.type === 'set') return { parent: parent !== undefined ? parent : ((data.parent as EntityId | undefined) ?? null), field: 'parent', type: 'set' };
    if (entry.type === 'unit') return { parent: data.work as EntityId, field: 'work', type: 'unit' };
    if (entry.type === 'segment') return { parent: data.text as EntityId, field: 'text', type: 'segment' };
    const sets = (data.sets as EntityId[] | undefined) ?? [];
    const set = parent ?? (sets.length === 1 ? sets[0]! : null);
    if (!set) throw invalid(`${this.name(entry)} is in ${sets.length} sets; say which set's order (parent)`);
    return { parent: set, field: 'sets', type: entry.type };
  }

  /**
   * Places items together among their siblings (at the start, the end, or
   * beside one), or, with no position, in the order given in the places
   * they hold now. Siblings keep their keys wherever they can.
   */
  async place(items: Entry[], ctx: Siblings, position: OrganizePosition | undefined): Promise<void> {
    if (!ORDERED.has(ctx.type)) throw invalid(`${ctx.type} items have no order of their own`);
    const siblings = await this.children(ctx);
    const moving = new Set(items.map((i) => i.id));
    let sequence: Entry[];
    if (position === undefined) {
      const slots = siblings.map((s, i) => (moving.has(s.id) ? i : -1)).filter((i) => i >= 0);
      if (slots.length !== items.length) throw invalid('to put items in order, every one must be a sibling of the others');
      sequence = [...siblings];
      slots.forEach((slot, i) => (sequence[slot] = items[i]!));
    } else {
      const rest = siblings.filter((s) => !moving.has(s.id));
      let at = rest.length;
      if (position === 'start') at = 0;
      else if (position !== 'end') {
        const anchor = 'after' in position ? this.ref(position.after, 'sibling') : this.ref(position.before, 'sibling');
        const index = rest.findIndex((s) => s.id === anchor);
        if (index < 0) throw invalid(`${anchor} is not beside these items`);
        at = 'after' in position ? index + 1 : index;
      }
      sequence = [...rest.slice(0, at), ...items, ...rest.slice(at)];
    }
    // Siblings that never had an order (sets and sefarim listed by path) are given one only when the order matters.
    const anyOrdered = siblings.some((s) => typeof s.data!.order === 'string');
    if (!anyOrdered && !ORDER_REQUIRED.has(ctx.type) && position === 'end') return;
    const keys = rekey(sequence.map((e) => ({ id: e.id, order: e.data!.order as string | undefined })));
    this.limit(keys.size);
    for (const e of sequence) {
      const key = keys.get(e.id);
      if (key !== undefined) e.data!.order = key;
    }
  }
}

/** Works a plan out against main: the new versions, the paths that move, and what to tell the reviewer. Saves nothing. */
export async function previewOrganize(catalog: Catalog, plan: OrganizePlan): Promise<OrganizePreview> {
  if (!plan || !Array.isArray(plan.operations) || plan.operations.length === 0) throw invalid('give at least one operation');
  if (plan.operations.length > MAX_OPERATIONS) throw invalid(`at most ${MAX_OPERATIONS} operations in one plan`);
  const ws = new Workspace(catalog);
  for (const operation of plan.operations) await run(ws, operation);

  const items: OrganizeItem[] = [];
  const revisions: OrganizePreview['revisions'] = [];
  const redirects: OrganizePreview['redirects'] = [];
  for (const e of ws.entries.values()) {
    const before = (e.base?.data as Json | undefined) ?? null;
    const after = (e.data as Json | null) ?? null;
    const pathBefore = e.base?.path ?? null;
    const changes = e.data === null ? [] : diffData(before, after);
    if (e.base === null && e.data === null) continue;
    if (e.base !== null && e.data !== null && changes.length === 0 && pathBefore === e.path) continue;
    items.push({ id: e.id, type: e.type, name: ws.name(e), isNew: e.base === null, deleted: e.data === null, pathBefore, path: e.data === null ? null : e.path, changes });
    // A deleted item gives up its path, so the old one is kept as a redirect (to where it was merged, once approved).
    revisions.push({ id: e.id, type: e.type, data: after, path: e.data === null ? null : e.path });
    if (pathBefore !== null && (e.data === null || pathBefore !== e.path)) {
      const forward = e.data === null ? ws.forwards.find((f) => f.from === e.id) : undefined;
      const to = e.data !== null ? e.path : forward ? (ws.entries.get(forward.to)?.path ?? (await catalog.get(forward.to))?.path ?? null) : null;
      redirects.push({ id: e.id, from: pathBefore, to });
    }
  }
  if (items.length > MAX_ORGANIZE_ITEMS) throw invalid(`this plan changes ${items.length} items (at most ${MAX_ORGANIZE_ITEMS} in one suggestion); split it into parts`);
  const title = (plan.title?.trim() || (ws.summary.length === 1 ? ws.summary[0]! : `Organize the catalog: ${ws.summary[0]} and ${ws.summary.length - 1} more`)).slice(0, 200);
  return { title, summary: ws.summary, items, redirects, forwards: ws.forwards, warnings: ws.warnings, created: Object.fromEntries(ws.created), revisions };
}

/**
 * Makes a plan into one suggestion under `by`'s name and sends it for
 * review (or keeps it a draft). What the API's POST /v1/organize does.
 */
export async function applyOrganize(catalog: Catalog, by: string, plan: OrganizePlan, options: { draft?: boolean } = {}): Promise<{ suggestion: ChangesetRow; preview: OrganizePreview }> {
  const preview = await previewOrganize(catalog, plan);
  if (preview.revisions.length === 0) throw invalid('this plan changes nothing');
  const lines = preview.summary.map((s) => `- ${s}`).join('\n');
  const description = [plan.description?.trim(), lines, preview.warnings.length ? `Notes:\n${preview.warnings.map((w) => `- ${w}`).join('\n')}` : ''].filter(Boolean).join('\n\n').slice(0, 20_000);
  const suggestion = await catalog.createChangeset(by, { title: preview.title, description });
  // New sets first, so the items that move into them point at something already in the suggestion.
  const fresh = new Set(preview.items.filter((i) => i.isNew).map((i) => i.id));
  const ordered = [...preview.revisions].sort((a, b) => Number(fresh.has(b.id)) - Number(fresh.has(a.id)));
  for (const r of ordered) await catalog.putRevision(suggestion.id, by, { id: r.id, type: r.type, data: r.data, path: r.path });
  for (const f of preview.forwards) await catalog.db.query('INSERT INTO entity_forward (changeset_id, from_id, to_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [suggestion.id, f.from, f.to]);
  const sent = options.draft ? suggestion : await catalog.submit(suggestion.id, by);
  return { suggestion: sent, preview };
}

async function run(ws: Workspace, operation: OrganizeOperation): Promise<void> {
  switch (operation?.op) {
    case 'move':
      return move(ws, operation);
    case 'move-up':
      return moveUp(ws, operation);
    case 'rename':
      return rename(ws, operation);
    case 'reorder':
      return reorder(ws, operation);
    case 'create-set':
      return createSet(ws, operation);
    case 'delete-set':
      return deleteSet(ws, operation);
    case 'merge':
      return merge(ws, operation);
    case 'split':
      return split(ws, operation);
    case 'addition':
      return addition(ws, operation);
    case 'official':
      return official(ws, operation);
    default:
      throw invalid(`unknown operation "${(operation as { op?: string })?.op}": move, move-up, rename, reorder, create-set, delete-set, merge, split, addition or official`);
  }
}

function refsOf(items: unknown, ws: Workspace): EntityId[] {
  if (!Array.isArray(items) || items.length === 0) throw invalid('say which items (items: [ids])');
  const ids = items.map((i) => ws.ref(i as string, 'item'));
  return [...new Set(ids)];
}

async function move(ws: Workspace, op: Extract<OrganizeOperation, { op: 'move' }>): Promise<void> {
  const ids = refsOf(op.items, ws);
  const target = op.to === null || op.to === undefined ? null : await ws.load(ws.ref(op.to, 'place to move to'));
  const from = op.from ? ws.ref(op.from, 'set to move from') : null;
  const moved: Entry[] = [];
  for (const id of ids) {
    const entry = await ws.load(id);
    const data = entry.data!;
    if (target?.id === entry.id) throw invalid(`${ws.name(entry)} cannot go inside itself`);
    if (entry.type === 'set' && (target === null || target.type === 'set') && !(target === null && from !== null)) {
      // A set under another set, or to the top.
      if (target && (await ws.isUnder(target.id, entry.id))) throw invalid(`${ws.name(entry)} cannot go under ${ws.name(target)}, which is inside it`);
      if (target) data.parent = target.id;
      else delete data.parent;
      moved.push(entry);
      continue;
    }
    if (target === null || target.type === 'set') {
      const sets = [...((data.sets as EntityId[] | undefined) ?? [])];
      if (from !== null && !sets.includes(from)) throw invalid(`${ws.name(entry)} is not in the set ${from}`);
      let next = sets;
      if (target === null) {
        if (from === null) {
          const field = REQUIRED_PARENT[entry.type];
          throw invalid(field ? `a ${entry.type} always belongs to its ${field}; move it to another one instead` : `say which set to take ${ws.name(entry)} out of (from)`);
        }
        next = sets.filter((s) => s !== from);
      } else if (op.mode === 'only') next = [target.id];
      else if (from !== null) next = sets.map((s) => (s === from ? target.id : s)).filter((s, i, all) => all.indexOf(s) === i);
      else if (!sets.includes(target.id)) next = [...sets, target.id];
      if (next.length === 0) delete data.sets;
      else data.sets = next;
      moved.push(entry);
      continue;
    }
    const field = MOVE_FIELDS[entry.type]?.[target.type];
    if (!field) {
      const can = Object.keys(MOVE_FIELDS[entry.type] ?? {});
      throw invalid(`a ${entry.type} cannot go into a ${target.type}${can.length ? `; it moves into a ${can.join(' or ')}` : entry.type === 'set' ? '; a set moves under another set' : '; it moves into sets'}`);
    }
    if (field === 'within' || field === 'broader') {
      if (await ws.isUnder(target.id, entry.id, field)) throw invalid(`${ws.name(entry)} cannot go under ${ws.name(target)}, which is under it`);
    }
    const oldParent = typeof data[field] === 'string' ? (data[field] as EntityId) : null;
    if (oldParent === target.id) {
      moved.push(entry);
      continue;
    }
    data[field] = target.id;
    // A sicha's path is its sefer's path and its place: it moves with it.
    if (entry.path !== null && oldParent !== null && target.path !== null) {
      const old = await ws.load(oldParent).catch(() => null);
      const oldBase = old?.path ?? old?.base?.path ?? null;
      if (oldBase && entry.path.startsWith(`${oldBase}/`)) await ws.setPath(entry, await ws.uniquePath(`${target.path}${entry.path.slice(oldBase.length)}`, entry.id));
    }
    moved.push(entry);
  }
  // Their places among their new siblings.
  {
    const byCtx = new Map<string, { ctx: Siblings; items: Entry[] }>();
    for (const entry of moved) {
      if (!ORDERED.has(entry.type)) continue;
      // Taken out of a set, an item has no new place to be given.
      if (target === null && entry.type !== 'set') continue;
      const ctx = target === null ? ws.siblingsOf(entry) : target.type === 'set' && entry.type !== 'set' ? { parent: target.id, field: 'sets', type: entry.type } : ws.siblingsOf(entry, entry.type === 'set' ? target.id : undefined);
      const key = `${ctx.parent}|${ctx.field}|${ctx.type}`;
      const group = byCtx.get(key) ?? { ctx, items: [] };
      group.items.push(entry);
      byCtx.set(key, group);
    }
    for (const { ctx, items } of byCtx.values()) await ws.place(items, ctx, op.position ?? 'end');
  }
  const where = target ? ws.name(target) : from ? `out of ${ws.name(await ws.load(from))}` : 'the top';
  ws.summary.push(`Move ${ids.length === 1 ? ws.name(await ws.load(ids[0]!)) : `${ids.length} items`} ${target ? 'into ' : from ? '' : 'to '}${where}`);
}

async function moveUp(ws: Workspace, op: Extract<OrganizeOperation, { op: 'move-up' }>): Promise<void> {
  const ids = refsOf(op.items, ws);
  const names: string[] = [];
  for (const id of ids) {
    const entry = await ws.load(id);
    const data = entry.data!;
    names.push(ws.name(entry));
    if (entry.type === 'set') {
      const parent = typeof data.parent === 'string' ? (data.parent as EntityId) : null;
      if (!parent) throw invalid(`${ws.name(entry)} is already at the top`);
      const grand = await ws.parentOf(parent);
      if (grand) data.parent = grand;
      else delete data.parent;
      const ctx: Siblings = { parent: grand, field: 'parent', type: 'set' };
      // Just after the set it came out of, where the sets there are in order.
      const siblings = await ws.children(ctx);
      await ws.place([entry], ctx, siblings.some((s) => typeof s.data!.order === 'string') && siblings.some((s) => s.id === parent) ? { after: parent } : 'end');
      continue;
    }
    if (REQUIRED_PARENT[entry.type] || MOVE_FIELDS[entry.type]) {
      if (!Array.isArray(data.sets) || data.sets.length === 0) throw invalid(`a ${entry.type} sits in its ${REQUIRED_PARENT[entry.type] ?? Object.values(MOVE_FIELDS[entry.type] ?? {})[0]}; move it to another one instead`);
    }
    const sets = (data.sets as EntityId[] | undefined) ?? [];
    const from = op.from ? ws.ref(op.from, 'set') : sets.length === 1 ? sets[0]! : null;
    if (!from) throw invalid(sets.length === 0 ? `${ws.name(entry)} is in no set` : `${ws.name(entry)} is in ${sets.length} sets; say which to move up from (from)`);
    if (!sets.includes(from)) throw invalid(`${ws.name(entry)} is not in the set ${from}`);
    const grand = await ws.parentOf(from);
    if (!grand) throw invalid(`${ws.name(await ws.load(from))} is a top set; to take ${ws.name(entry)} out of it, move it into another set`);
    data.sets = sets.map((s) => (s === from ? grand : s)).filter((s, i, all) => all.indexOf(s) === i);
    if (ORDERED.has(entry.type)) await ws.place([entry], { parent: grand, field: 'sets', type: entry.type }, 'end');
  }
  ws.summary.push(`Move ${ids.length === 1 ? names[0] : `${ids.length} items`} up a level`);
}

async function rename(ws: Workspace, op: Extract<OrganizeOperation, { op: 'rename' }>): Promise<void> {
  const entry = await ws.load(ws.ref(op.item, 'item to rename'));
  const data = entry.data!;
  const before = ws.name(entry);
  if (op.name) {
    const field = nameFieldOf(data);
    if (!field) throw invalid(`${entry.id} has no name to change`);
    const current = { ...(data[field] as Data) };
    if (op.name.he !== undefined) {
      if (!op.name.he.trim()) throw invalid('a Hebrew name cannot be empty');
      current.he = op.name.he.trim();
    }
    if (op.name.en !== undefined) {
      if (op.name.en.trim()) current.en = op.name.en.trim();
      else delete current.en;
    }
    data[field] = current;
  }
  let path: string | null = entry.path;
  if (op.slug !== undefined) {
    const slug = slugify(op.slug);
    if (!slug || slug !== op.slug) throw invalid(`a slug is lower-case letters, digits and hyphens ("${slugify(op.slug) || 'my-set'}")`);
    if (entry.type === 'set') data.slug = slug;
    if (entry.path !== null) path = `${dirOf(entry.path)}/${slug}`;
  }
  if (op.path !== undefined) {
    const lower = op.path.toLowerCase();
    if (!isEntityPath(lower)) throw invalid(`"${op.path}" is not a path: lower-case letters, digits and hyphens between slashes`);
    path = lower;
  }
  if (path !== entry.path && path !== null) {
    if (!(await ws.pathFree(path, entry.id))) throw invalid(`the path ${path} is taken`);
    await ws.setPath(entry, path);
  }
  if (!op.name && op.slug === undefined && op.path === undefined) throw invalid('give a new name, slug or path');
  ws.summary.push(`Rename ${before}${op.name ? ` to ${ws.name(entry)}` : ''}${path !== (entry.base?.path ?? null) && path ? ` (${path})` : ''}`);
}

async function reorder(ws: Workspace, op: Extract<OrganizeOperation, { op: 'reorder' }>): Promise<void> {
  const ids = refsOf(op.items, ws);
  const items = [];
  for (const id of ids) items.push(await ws.load(id));
  const parent = op.parent === undefined ? undefined : op.parent === null ? null : ws.ref(op.parent, 'parent');
  const ctx = ws.siblingsOf(items[0]!, parent);
  for (const item of items) if (!ws.pointsAt(item, ctx)) throw invalid(`${ws.name(item)} is not beside the others; move it first`);
  await ws.place(items, ctx, op.position);
  const under = ctx.parent ? ws.name(await ws.load(ctx.parent)) : 'the top';
  ws.summary.push(`Put ${ids.length === 1 ? ws.name(items[0]!) : `${ids.length} items`} in order in ${under}`);
}

async function createSet(ws: Workspace, op: Extract<OrganizeOperation, { op: 'create-set' }>): Promise<void> {
  if (!op.name?.he?.trim()) throw invalid('a new set needs a Hebrew name');
  const slug = op.slug;
  if (!slug || slugify(slug) !== slug) throw invalid(`a slug is lower-case letters, digits and hyphens ("${slugify(slug ?? '') || 'my-set'}")`);
  const parent = op.parent ? await ws.load(ws.ref(op.parent, 'parent set')) : null;
  if (parent && parent.type !== 'set') throw invalid(`a set goes under another set, not a ${parent.type}`);
  const id = newId();
  if (op.key) {
    if (ws.created.has(op.key)) throw invalid(`two new sets have the key ${op.key}`);
    ws.created.set(op.key, id);
  }
  const path = op.path ? op.path.toLowerCase() : `/sets/${slug}`;
  if (!isEntityPath(path)) throw invalid(`"${path}" is not a path`);
  if (!(await ws.pathFree(path, id))) throw invalid(`the path ${path} is taken; choose another slug`);
  const parentData = parent?.data as { policy?: string; keepers?: string[] } | undefined;
  const data: Data = {
    name: { he: op.name.he.trim(), ...(op.name.en?.trim() ? { en: op.name.en.trim() } : {}) },
    slug,
    // A set made inside another is kept as that one is, by the same keepers.
    policy: parentData?.policy ?? 'moderated',
    keepers: [...(parentData?.keepers ?? [])],
  };
  if (op.description?.he) data.description = op.description;
  if (parent) data.parent = parent.id;
  const entry: Entry = { id, type: 'set', base: null, data, path };
  ws.add(entry);
  const siblings: Siblings = { parent: parent?.id ?? null, field: 'parent', type: 'set' };
  await ws.place([entry], siblings, 'end');
  ws.summary.push(`New set ${ws.name(entry)}${parent ? ` in ${ws.name(parent)}` : ''}`);
  if (op.items?.length) await move(ws, { op: 'move', items: op.items, to: id });
}

async function deleteSet(ws: Workspace, op: Extract<OrganizeOperation, { op: 'delete-set' }>): Promise<void> {
  const entry = await ws.load(ws.ref(op.item, 'set to remove'));
  if (entry.type !== 'set') throw invalid(`${entry.id} is a ${entry.type}; only sets are removed here`);
  const { rows } = await ws.catalog.db.query<{ id: EntityId }>(
    'SELECT DISTINCT x.from_id AS id FROM entity_ref x JOIN entity e ON e.id = x.from_id AND NOT e.deleted AND e.main_rev IS NOT NULL WHERE x.to_id = $1 LIMIT 5000',
    [entry.id],
  );
  const holders = new Set(rows.map((r) => r.id));
  for (const e of ws.entries.values()) if (e.data !== null && containsId(e.data, entry.id)) holders.add(e.id);
  const still = (await ws.loadMany([...holders])).filter((e) => e.id !== entry.id && containsId(e.data, entry.id));
  if (still.length > 0) throw invalid(`${ws.name(entry)} still holds ${still.length} item${still.length === 1 ? '' : 's'} (${still.slice(0, 3).map((e) => ws.name(e)).join(', ')}${still.length > 3 ? '…' : ''}); move them out first`);
  const parent = typeof entry.data!.parent === 'string' ? (entry.data!.parent as EntityId) : null;
  entry.data = null;
  if (parent) ws.forwards.push({ from: entry.id, to: parent });
  ws.summary.push(`Remove the empty set ${ws.name(entry)}`);
}

async function merge(ws: Workspace, op: Extract<OrganizeOperation, { op: 'merge' }>): Promise<void> {
  const from = await ws.load(ws.ref(op.from, 'duplicate (from)'));
  const into = await ws.load(ws.ref(op.into, 'item to keep (into)'));
  if (from.id === into.id) throw invalid('an item cannot be merged into itself');
  if (from.type !== into.type) throw invalid(`${ws.name(from)} is a ${from.type} and ${ws.name(into)} a ${into.type}; only items of one type merge`);
  if (from.type === 'schema') throw invalid('schemas are not merged');
  if (from.type === 'set' && (await ws.isUnder(into.id, from.id))) throw invalid(`${ws.name(into)} is inside ${ws.name(from)}; move it out before merging`);
  const fromName = ws.name(from);
  into.data = unionData(into.data!, from.data!, ws.warnings, ws.name(into));

  // Everything that points at the duplicate points at the one kept.
  const { rows } = await ws.catalog.db.query<{ id: EntityId }>(
    'SELECT DISTINCT x.from_id AS id FROM entity_ref x JOIN entity e ON e.id = x.from_id AND NOT e.deleted AND e.main_rev IS NOT NULL WHERE x.to_id = $1',
    [from.id],
  );
  ws.limit(rows.length);
  const ids = new Set(rows.map((r) => r.id));
  for (const e of ws.entries.values()) if (e.data !== null && containsId(e.data, from.id)) ids.add(e.id);
  ids.delete(from.id);
  const referrers = await ws.loadMany([...ids]);
  // Ordered children (a sefer's sichos) keep their order, after the kept item's own.
  const children = new Map<string, { ctx: Siblings; items: Entry[] }>();
  for (const r of referrers) {
    for (const [field, parentType] of Object.entries({ work: 'work', text: 'text', parent: 'set', sets: 'set' })) {
      if (parentType !== from.type || !ORDERED.has(r.type)) continue;
      const value = r.data![field];
      if (value === from.id || (Array.isArray(value) && value.includes(from.id))) {
        const key = `${field}|${r.type}`;
        const group = children.get(key) ?? { ctx: { parent: into.id, field, type: r.type }, items: [] };
        group.items.push(r);
        children.set(key, group);
      }
    }
  }
  const byOrder = (a: Entry, b: Entry) => {
    const ka = String(a.data!.order ?? '~');
    const kb = String(b.data!.order ?? '~');
    if (ka !== kb) return ka < kb ? -1 : 1;
    return (a.path ?? '') < (b.path ?? '') ? -1 : 1;
  };
  for (const group of children.values()) group.items.sort(byOrder);
  const fromPath = from.path;
  for (const r of referrers) {
    if (r.id === into.id) {
      r.data = replaceId(r.data, from.id, into.id) as Data;
      continue;
    }
    r.data = replaceId(r.data, from.id, into.id) as Data;
    if (fromPath !== null && into.path !== null && r.path?.startsWith(`${fromPath}/`)) r.path = await ws.uniquePath(`${into.path}${r.path.slice(fromPath.length)}`, r.id);
  }
  for (const { ctx, items } of children.values()) {
    const ordered = items.filter((i) => ws.pointsAt(i, ctx));
    if (ordered.length > 0 && (ORDER_REQUIRED.has(ctx.type) || ordered.some((i) => typeof i.data!.order === 'string'))) await ws.place(ordered, ctx, 'end');
  }
  from.data = null;
  ws.forwards.push({ from: from.id, to: into.id });
  ws.summary.push(`Merge ${fromName} into ${ws.name(into)}`);
}

async function split(ws: Workspace, op: Extract<OrganizeOperation, { op: 'split' }>): Promise<void> {
  const work = await ws.load(ws.ref(op.work, 'sefer to split'));
  if (work.type !== 'work') throw invalid(`${work.id} is a ${work.type}; only a sefer (work) is split`);
  if (!op.title?.he?.trim()) throw invalid('the new sefer needs a Hebrew title');
  if (!op.slug || slugify(op.slug) !== op.slug) throw invalid('a slug is lower-case letters, digits and hyphens');
  const units = await ws.children({ parent: work.id, field: 'work', type: 'unit' });
  let chosen: Entry[];
  if (op.range) {
    const a = units.findIndex((u) => u.id === ws.ref(op.range!.from, 'first unit'));
    const b = units.findIndex((u) => u.id === ws.ref(op.range!.to, 'last unit'));
    if (a < 0 || b < 0) throw invalid('the range must be units of this sefer');
    chosen = units.slice(Math.min(a, b), Math.max(a, b) + 1);
  } else {
    const ids = new Set(refsOf(op.units, ws));
    chosen = units.filter((u) => ids.has(u.id));
    if (chosen.length !== ids.size) throw invalid('every unit must be of this sefer');
  }
  if (chosen.length === 0) throw invalid('choose the units to move');
  if (chosen.length === units.length) throw invalid('that is every unit; rename the sefer instead');
  const id = newId();
  const base = work.data!;
  const data: Data = { title: { he: op.title.he.trim(), ...(op.title.en?.trim() ? { en: op.title.en.trim() } : {}) }, slug: op.slug, authors: base.authors ?? [], genre: base.genre, levels: base.levels ?? [] };
  if (base.sets) data.sets = clone(base.sets);
  const path = op.path ? op.path.toLowerCase() : work.path !== null ? `${dirOf(work.path)}/${op.slug}` : null;
  if (path !== null && (!isEntityPath(path) || !(await ws.pathFree(path, id)))) throw invalid(`the path ${path} is taken or not a path`);
  const entry: Entry = { id, type: 'work', base: null, data, path };
  ws.add(entry);
  if (typeof base.order === 'string') {
    const sets = (base.sets as EntityId[] | undefined) ?? [];
    if (sets.length > 0) await ws.place([entry], { parent: sets[0]!, field: 'sets', type: 'work' }, { after: work.id });
  }
  for (const unit of chosen) {
    unit.data!.work = id;
    if (work.path !== null && path !== null && unit.path?.startsWith(`${work.path}/`)) unit.path = await ws.uniquePath(`${path}${unit.path.slice(work.path.length)}`, unit.id);
  }
  ws.summary.push(`Split ${chosen.length} units of ${ws.name(work)} into a new sefer ${ws.name(entry)}`);
}

async function addition(ws: Workspace, op: Extract<OrganizeOperation, { op: 'addition' }>): Promise<void> {
  const entry = await ws.load(ws.ref(op.item, 'sefer to mark as an addition'));
  if (entry.type !== 'work') throw invalid(`${ws.name(entry)} is a ${entry.type}; only a sefer (work) is an addition`);
  if (!(ADDITION_KINDS as readonly string[]).includes(op.kind)) throw invalid(`say what kind of addition it is: ${ADDITION_KINDS.join(', ')}`);
  let to: Entry | null = null;
  if (op.to !== undefined && op.to !== null) {
    to = await ws.load(ws.ref(op.to, 'sefer it belongs to (to)'));
    if (to.id === entry.id) throw invalid('a sefer is not an addition to itself');
    if (to.type !== 'work') throw invalid(`${ws.name(to)} is a ${to.type}; an addition belongs to a sefer (work)`);
    // The tree is built of official sefarim: an addition hangs on one of them, never on another addition.
    if (to.data!.addition) throw invalid(`${ws.name(to)} is itself an addition; give the official sefer it belongs to`);
  }
  entry.data!.addition = { kind: op.kind, ...(to ? { to: to.id } : {}) };
  const { rows } = await ws.catalog.db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM entity_ref x JOIN entity e ON e.id = x.from_id AND ${LIVE} WHERE x.to_id = $1 AND x.field = 'addition.to'`,
    [entry.id],
  );
  if (rows[0]?.n) ws.warnings.push(`${rows[0].n} addition${rows[0].n === 1 ? '' : 's'} to ${ws.name(entry)} now hang on an addition; move them to the official sefer`);
  ws.summary.push(`Mark ${ws.name(entry)} as an addition (${op.kind})${to ? ` to ${ws.name(to)}` : ''}`);
}

async function official(ws: Workspace, op: Extract<OrganizeOperation, { op: 'official' }>): Promise<void> {
  const entry = await ws.load(ws.ref(op.item, 'sefer to make official'));
  if (entry.type !== 'work') throw invalid(`${ws.name(entry)} is a ${entry.type}; only a sefer (work) is official`);
  if (!entry.data!.addition) throw invalid(`${ws.name(entry)} is already an official sefer`);
  delete entry.data!.addition;
  ws.summary.push(`Make ${ws.name(entry)} an official sefer`);
}

// ------------------------------------------------------------------ the tree

export interface TreeNode {
  id: EntityId;
  type: EntityType;
  path: string | null;
  name: LocalName | null;
  order: string | null;
  /** How much it holds: sets under it, items in it, units of a sefer. */
  counts: { sets?: number; items?: number; units?: number };
  children?: TreeNode[];
  /** Children left out past the limit. */
  more?: number;
  /** For a sefer that is an addition, not an official sefer: its kind, and the official sefer it belongs to. */
  addition?: { kind: AdditionKind; to?: EntityId };
}

function nodeOf(view: { id: EntityId; type: EntityType; path: string | null; data: unknown }): TreeNode {
  const data = (view.data ?? {}) as Data;
  const field = nameFieldOf(data);
  const node: TreeNode = { id: view.id, type: view.type, path: view.path, name: field ? (data[field] as LocalName) : null, order: typeof data.order === 'string' ? data.order : null, counts: {} };
  if (view.type === 'work' && data.addition && typeof data.addition === 'object') node.addition = data.addition as TreeNode['addition'];
  return node;
}

const LIVE = 'NOT e.deleted AND e.main_rev IS NOT NULL';

/**
 * The catalog as a tree, for people and agents organizing it: the top
 * sets (or one set or sefer) with the sets under them, the items in them
 * and how much each holds, `depth` levels down, `limit` children a level.
 * A set's official sefarim come first, in their order, then the additions
 * in it (each says so), then everything else.
 */
export async function catalogTree(catalog: Catalog, options: { root?: EntityId | null; depth?: number; limit?: number } = {}): Promise<{ root: TreeNode | null; children: TreeNode[]; more: number }> {
  const depth = Math.min(Math.max(options.depth ?? 1, 0), 4);
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const db = catalog.db;
  const count = async (sql: string, params: unknown[]) => Number((await db.query<{ n: number }>(sql, params)).rows[0]?.n ?? 0);
  const rows = async (sql: string, params: unknown[]) =>
    (await db.query<{ entity_id: EntityId; entity_type: EntityType; path: string | null; data: unknown }>(sql, params)).rows.map((r) => nodeOf({ id: r.entity_id, type: r.entity_type, path: r.path, data: r.data }));
  const ORDER = `ORDER BY coalesce(r.data->>'order', '~') COLLATE "C", coalesce(e.path, '') || e.id`;

  async function fill(node: TreeNode, level: number): Promise<void> {
    if (node.type === 'set') {
      node.counts.sets = await count(`SELECT count(DISTINCT e.id)::int AS n FROM entity_ref x JOIN entity e ON e.id = x.from_id AND ${LIVE} WHERE x.to_id = $1 AND x.field = 'parent' AND e.type = 'set'`, [node.id]);
      node.counts.items = await count(`SELECT count(DISTINCT e.id)::int AS n FROM entity_ref x JOIN entity e ON e.id = x.from_id AND ${LIVE} WHERE x.to_id = $1 AND x.field = 'sets'`, [node.id]);
      if (level >= depth) return;
      const sets = await rows(`SELECT r.entity_id, r.entity_type, e.path, r.data FROM entity_ref x JOIN entity e ON e.id = x.from_id AND ${LIVE} JOIN revision r ON r.id = e.main_rev WHERE x.to_id = $1 AND x.field = 'parent' AND e.type = 'set' ${ORDER} LIMIT ${limit}`, [node.id]);
      const items = await rows(
        `SELECT r.entity_id, r.entity_type, e.path, r.data FROM entity_ref x JOIN entity e ON e.id = x.from_id AND ${LIVE} JOIN revision r ON r.id = e.main_rev WHERE x.to_id = $1 AND x.field = 'sets' ORDER BY (e.type <> 'work'), (r.data ? 'addition'), coalesce(r.data->>'order', '~') COLLATE "C", coalesce(e.path, '') || e.id LIMIT ${limit}`,
        [node.id],
      );
      node.children = [...sets, ...items];
      node.more = Math.max(0, node.counts.sets - sets.length) + Math.max(0, node.counts.items - items.length);
      for (const child of node.children) await fill(child, level + 1);
    } else if (node.type === 'work') {
      node.counts.units = await count(`SELECT count(DISTINCT e.id)::int AS n FROM entity_ref x JOIN entity e ON e.id = x.from_id AND ${LIVE} WHERE x.to_id = $1 AND x.field = 'work' AND e.type = 'unit'`, [node.id]);
      if (level >= depth) return;
      node.children = (await catalog.children(node.id, 'work', 'unit', { limit })).map(nodeOf);
      node.more = Math.max(0, node.counts.units - node.children.length);
    }
  }

  if (options.root) {
    const view = await catalog.get(options.root);
    if (!view) throw notFound(`item ${options.root}`);
    const root = nodeOf(view);
    await fill(root, 0);
    return { root, children: root.children ?? [], more: root.more ?? 0 };
  }
  const top = await rows(`SELECT r.entity_id, r.entity_type, e.path, r.data FROM entity e JOIN revision r ON r.id = e.main_rev WHERE e.type = 'set' AND ${LIVE} AND NOT (r.data ? 'parent') ${ORDER} LIMIT ${limit}`, []);
  const total = await count(`SELECT count(*)::int AS n FROM entity e JOIN revision r ON r.id = e.main_rev WHERE e.type = 'set' AND ${LIVE} AND NOT (r.data ? 'parent')`, []);
  if (depth > 0) for (const node of top) await fill(node, 1);
  return { root: null, children: top, more: Math.max(0, total - top.length) };
}
