import { applyShaar, hasShaar, isEntityId, shaarFromCatalog, writeShaar, type EntityId, type LocalName, type WorkData } from '@rebbehub/model';
import type { Catalog, ChangesetRow } from './catalog.js';
import { CatalogError, badState, invalid, notFound } from './errors.js';
import type { Json } from './merge.js';

/**
 * A sefer's shaar (model/shaar.ts, docs/shaar.md) through the catalog:
 * the file as it reads now, a person's shaar sent for review, and a shaar
 * made from the catalog's data for every sefer no one has written one for.
 */

/** The names a shaar writes after its authors' ids. */
async function authorNames(catalog: Catalog, ids: readonly string[]): Promise<Record<string, string>> {
  const found = await catalog.getMany(ids.filter(isEntityId) as EntityId[]);
  return Object.fromEntries(found.map((a) => [a.id, (a.data as { name?: LocalName } | null)?.name?.he ?? '']).filter(([, name]) => name));
}

export interface ShaarFile {
  /** The file itself. */
  text: string;
  /** The catalog made it from the sefer's data: no person has read it yet. */
  machine: boolean;
}

/** A sefer's shaar file as it reads now; for a sefer with none yet, the one the catalog makes from its data. */
export async function shaarFile(catalog: Catalog, id: EntityId): Promise<ShaarFile> {
  const entity = await catalog.get(id);
  if (!entity || entity.data === null) throw notFound(`item ${id}`);
  if (entity.type !== 'work') throw invalid('only a sefer has a shaar');
  const data = entity.data as unknown as WorkData;
  const shaar = data.shaar ?? shaarFromCatalog(data);
  return { text: writeShaar({ ...data, shaar }, await authorNames(catalog, data.authors)), machine: Boolean(shaar.origin && !shaar.origin.checked) };
}

export interface ShaarInput {
  entity: EntityId;
  /** The whole file. */
  text: string;
  /** The file as the person opened it, so a change made since is never overwritten. */
  before?: string;
  title?: string;
  note?: string;
}

/**
 * A person's shaar for a sefer, sent for review as a suggestion of its
 * own: the file is read strictly, and a file with anything wrong is
 * refused with every line that is (`detail`), so nothing the catalog
 * cannot read gets in. Sending a shaar the catalog made is reading it:
 * it is the person's now.
 */
export async function suggestShaar(catalog: Catalog, by: string, input: ShaarInput): Promise<ChangesetRow> {
  if (!isEntityId(input.entity)) throw invalid('say which sefer this shaar is of');
  if (typeof input.text !== 'string' || !input.text.trim()) throw invalid('give the shaar file (text)');
  const entity = await catalog.get(input.entity);
  if (!entity || entity.data === null) throw notFound(`item ${input.entity}`);
  if (entity.type !== 'work') throw invalid('only a sefer has a shaar');
  const data = entity.data as unknown as WorkData;
  if (input.before !== undefined) {
    const now = await shaarFile(catalog, entity.id);
    if (input.before.trim() !== now.text.trim()) throw new CatalogError('conflict', "this sefer's shaar has changed since you opened it; open it again to see it as it is now");
  }
  const applied = applyShaar(data, input.text);
  if (!applied.ok) throw invalid(`the shaar cannot be read: ${applied.problems.map((p) => `line ${p.line}: ${p.en}`).join(' ')}`, { problems: applied.problems });
  const next = applied.data;
  const unknown = next.authors.filter((id) => !data.authors.includes(id));
  if (unknown.length) {
    const found = await catalog.getMany(unknown as EntityId[]);
    const missing = unknown.filter((id) => !found.some((a) => a.id === id && (a.type === 'author' || a.type === 'person')));
    if (missing.length) throw invalid(`no author ${missing.join(', ')} in the catalog`);
  }
  if (JSON.stringify(next) === JSON.stringify(data)) throw badState('the shaar is the same as it is now');
  const title = (input.title ?? '').trim().slice(0, 200) || 'The shaar';
  const suggestion = await catalog.createChangeset(by, { title, description: input.note?.trim().slice(0, 2000) || undefined });
  await catalog.putRevision(suggestion.id, by, { id: entity.id, type: 'work', data: next as unknown as Json });
  return catalog.submit(suggestion.id, by);
}

/**
 * Gives every sefer that has no shaar the one the catalog makes from its
 * data (labelled as the catalog's until a person reads it), as system
 * changes of `batch` sefarim each, so it can be stopped and run again:
 * each run takes up only what is left. Returns how many it gave one.
 */
export async function fillShaars(catalog: Catalog, options: { batch?: number; dryRun?: boolean; log?: (line: string) => void } = {}): Promise<number> {
  const batch = Math.min(Math.max(options.batch ?? 500, 1), 5000);
  const log = options.log ?? (() => {});
  let done = 0;
  let after = '';
  for (;;) {
    const { rows } = await catalog.db.query<{ id: EntityId; data: WorkData }>(
      `SELECT e.id, r.data FROM entity e JOIN revision r ON r.id = e.main_rev
       WHERE e.type = 'work' AND NOT e.deleted AND r.data->'shaar' IS NULL AND e.id > $1 ORDER BY e.id LIMIT ${batch}`,
      [after],
    );
    if (!rows.length) break;
    after = rows[rows.length - 1]!.id;
    const wanted = rows.filter((row) => hasShaar(row.data));
    if (!wanted.length) continue;
    if (options.dryRun) {
      done += wanted.length;
      log(`${done} sefarim would get a shaar`);
      continue;
    }
    const cs = await catalog.createChangeset('system', { title: `Shaars made from the catalog (${done + 1}-${done + wanted.length})`, kind: 'import' });
    for (const row of wanted) {
      await catalog.putRevision(cs.id, 'system', { id: row.id, type: 'work', data: { ...row.data, shaar: shaarFromCatalog(row.data) } as unknown as Json });
    }
    await catalog.submit(cs.id, 'system');
    await catalog.merge(cs.id, 'system');
    done += wanted.length;
    log(`${done} sefarim now have a shaar`);
  }
  return done;
}
