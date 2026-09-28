import { canonicalJson, contentHash, idFromSeed, type EntityId, type EntityType } from '@rebbehub/model';
import { threeWayMerge, type Catalog, type Json } from '@rebbehub/core';

/**
 * Bot contributors (docs/plans/rebbehub.md, section 2): an importer reads
 * a source and says what the catalog should hold; the runner turns that
 * into suggestions from the bot's own account, which a steward or keeper
 * approves like anyone else's. Bots never merge their own work.
 *
 * Records are keyed (`sichos-kodesh-work:tanya`), and a key always maps to
 * the same entity id, so an importer run again updates what it made
 * instead of duplicating it. What people have fixed since is kept: the
 * new import is merged three ways against what the bot last said, and
 * where a person and the source disagree, the person wins.
 */

/** A reference to another record by key, resolved to its entity id when the import runs. */
export interface KeyRef {
  $ref: string;
}

/** JSON, with `KeyRef`s anywhere an entity id goes. Checked against the type's schema when the suggestion is sent. */
export type ImportData = unknown;

export interface ImportRecord {
  /** Stable across runs and across importers: `<namespace>:<the source's own id>`. */
  key: string;
  type: EntityType;
  data: ImportData;
  path?: string;
  /**
   * For an item another importer made (a letter's date on the works
   * importer's letter): `data` holds only what this source knows, and the
   * item keeps everything else. `set` puts these fields on it; `add` adds
   * the items of each list in `data` to the item's list of that name (its
   * sources), never one a person has since taken off. The record is
   * skipped until the item exists.
   */
  patch?: 'set' | 'add';
  /** Records of one group go into a suggestion of their own, titled with it: each of the archive's commits stays one bot commit. */
  group?: { key: string; title: string };
}

export interface Importer {
  /** `sichos-kodesh-works`. */
  id: string;
  bot: { id: string; displayName: string };
  /** Records in dependency order: what is referred to before what refers to it. */
  records(): AsyncIterable<ImportRecord> | Iterable<ImportRecord>;
}

export const ref = (key: string): KeyRef => ({ $ref: key });

export const idForKey = (key: string): Promise<EntityId> => {
  const at = key.indexOf(':');
  if (at <= 0) throw new RangeError(`an import key is "<namespace>:<id>": ${key}`);
  return idFromSeed(key.slice(0, at), key.slice(at + 1));
};

async function resolve(data: ImportData): Promise<Json> {
  if (Array.isArray(data)) return Promise.all(data.map(resolve));
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    if (typeof record.$ref === 'string' && Object.keys(record).length === 1) return idForKey(record.$ref);
    const out: { [key: string]: Json } = {};
    for (const [k, v] of Object.entries(record)) if (v !== undefined) out[k] = await resolve(v);
    return out;
  }
  return data as Json;
}

export interface ImportOptions {
  /** Records per suggestion; the default keeps one run in one suggestion, so references between records always check out. */
  chunkSize?: number;
  /** Approves each suggestion as this account (a steward's first seeding). Without it they wait for review. */
  approveAs?: string;
  /** Reports what would change without writing anything. */
  dryRun?: boolean;
  log?: (line: string) => void;
}

export interface ImportResult {
  created: number;
  updated: number;
  unchanged: number;
  /** Patches for items not in the catalog yet (their own importer has not brought them). */
  skipped: number;
  /** Fields where people had changed what the source still says: kept as people have it. */
  keptHumanEdits: number;
  changesets: number[];
}

export async function runImport(catalog: Catalog, importer: Importer, options: ImportOptions = {}): Promise<ImportResult> {
  const log = options.log ?? (() => {});
  const result: ImportResult = { created: 0, updated: 0, unchanged: 0, skipped: 0, keptHumanEdits: 0, changesets: [] };
  if (!options.dryRun) await catalog.createAccount({ id: importer.bot.id, displayName: importer.bot.displayName, isBot: true });
  const chunkSize = options.chunkSize ?? Number.POSITIVE_INFINITY;
  let changeset: number | null = null;
  let inChunk = 0;
  let chunkNo = 0;

  const close = async () => {
    if (changeset === null) return;
    const submitted = await catalog.submit(changeset, importer.bot.id);
    const failed = submitted.checks.filter((c) => c.status === 'fail');
    if (failed.length > 0) log(`suggestion ${changeset}: ${failed.length} failed checks, e.g. ${failed[0]!.message}`);
    if (options.approveAs) await catalog.merge(changeset, options.approveAs, {}, `Seeded by ${importer.id}`);
    result.changesets.push(changeset);
    log(`suggestion ${changeset}: ${inChunk} changes${options.approveAs ? ', merged' : ', waiting for review'}`);
    changeset = null;
    inChunk = 0;
  };

  let group: string | undefined;
  for await (const record of importer.records()) {
    const id = await idForKey(record.key);
    const data = await resolve(record.data);
    const main = await catalog.get(id);
    let proposed: Json = data;
    if (record.patch) {
      if (!main) {
        result.skipped++;
        continue; // what it adds to is not in the catalog yet
      }
      const previous = await catalog.lastMergedBy(id, importer.bot.id);
      const patched = applyPatch(record.patch, main.data, previous?.data ?? null, data);
      result.keptHumanEdits += patched.kept;
      if ((await contentHash(patched.data)) === (await contentHash(main.data))) {
        result.unchanged++;
        continue;
      }
      proposed = patched.data;
    } else if (main) {
      const previous = await catalog.lastMergedBy(id, importer.bot.id);
      if (previous && (await contentHash(previous.data)) === (await contentHash(data)) && (previous.path ?? undefined) === (record.path ?? undefined)) {
        result.unchanged++;
        continue; // the source has not changed since the bot last said this
      }
      const merged = threeWayMerge(previous?.data ?? null, main.data, data);
      result.keptHumanEdits += merged.conflicts.length;
      proposed = merged.merged!; // conflicting fields stay as people have them
      if ((await contentHash(proposed)) === (await contentHash(main.data)) && (record.path === undefined || record.path === main.path)) {
        result.unchanged++;
        continue;
      }
    }
    main ? result.updated++ : result.created++;
    if (options.dryRun) continue;
    if (changeset !== null && record.group?.key !== group) await close();
    group = record.group?.key;
    if (changeset === null) {
      chunkNo++;
      const title = record.group?.title ?? `Import from ${importer.id}${Number.isFinite(chunkSize) ? ` (part ${chunkNo})` : ''}`;
      const cs = await catalog.createChangeset(importer.bot.id, { title: title.slice(0, 200), kind: 'import' });
      changeset = cs.id;
    }
    // A patch leaves the item where its own importer put it.
    const path = record.patch ? (main?.path ?? undefined) : record.path;
    await catalog.putRevision(changeset, importer.bot.id, { id, type: record.type, data: proposed, path });
    if (++inChunk >= chunkSize) await close();
  }
  await close();
  return result;
}

const isObject = (value: Json | null | undefined): value is { [key: string]: Json } => typeof value === 'object' && value !== null && !Array.isArray(value);
// Compared as canonical JSON: the store keeps objects with their keys in its own order.
const sameJson = (a: Json, b: Json) => canonicalJson(a) === canonicalJson(b);

/**
 * A patch on an item another importer made. `set`: each field as the
 * source now says it, unless a person changed it since this bot last did
 * (then theirs stays). `add`: each list gains the source's items it lacks,
 * except the ones this bot added before and a person has since taken off.
 */
export function applyPatch(mode: 'set' | 'add', main: Json, previous: Json | null, patch: Json): { data: Json; kept: number } {
  if (!isObject(main) || !isObject(patch)) throw new TypeError('a patch, and the item it patches, are objects');
  const out: { [key: string]: Json } = structuredClone(main);
  const before = isObject(previous) ? previous : null;
  let kept = 0;
  for (const [field, value] of Object.entries(patch)) {
    if (mode === 'set') {
      // What this bot said last time; with no earlier word, what the item has now.
      const base = before ? (before[field] ?? null) : (main[field] ?? null);
      const merged = threeWayMerge(base, main[field] ?? null, value);
      kept += merged.conflicts.length;
      if (merged.merged === null) delete out[field];
      else out[field] = merged.merged;
      continue;
    }
    if (!Array.isArray(value)) throw new TypeError(`what a patch adds to is a list: ${field}`);
    const have = Array.isArray(main[field]) ? [...main[field]] : [];
    const had = before && Array.isArray(before[field]) ? before[field] : [];
    for (const item of value) {
      if (have.some((x) => sameJson(x, item))) continue;
      if (had.some((x) => sameJson(x, item))) {
        kept++; // added before, and taken off by a person since
        continue;
      }
      have.push(item);
    }
    if (have.length) out[field] = have;
  }
  return { data: out, kept };
}
