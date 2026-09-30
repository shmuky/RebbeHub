import { one } from '@rebbehub/db';
import type { EntityId, EntityType } from '@rebbehub/model';
import type { Catalog, ChangesetRow } from './catalog.js';
import { badState, forbidden, invalid } from './errors.js';
import { resolveConflicts, threeWayMerge, type Json } from './merge.js';

/**
 * Several suggestions of one person made into one, as a pull request holds
 * many commits: their changes applied in the order they were made, each
 * over the ones before it and over the site as it is now, so the one
 * suggestion is reviewed and approved at once and never clashes with
 * itself. Changes to different words of one text are both kept
 * (merge.ts); where a later change rewrites what an earlier one did, the
 * later one stands, as its author meant. The suggestions combined are
 * withdrawn, each pointing to the new one.
 */
export async function combineSuggestions(catalog: Catalog, by: string, input: { suggestions: number[]; title?: string }): Promise<ChangesetRow> {
  const ids = [...new Set(input.suggestions)].sort((a, b) => a - b);
  if (ids.length < 2) throw invalid('two suggestions or more to combine');
  if (ids.length > 100) throw invalid('at most 100 suggestions at a time');
  const rows = await Promise.all(ids.map((id) => catalog.changeset(id)));
  for (const cs of rows) {
    if (cs.author !== by) throw forbidden(`suggestion ${cs.number ?? cs.id} is not yours to combine`);
    if (cs.status !== 'open' && cs.status !== 'draft' && cs.status !== 'sent_back') throw badState(`suggestion ${cs.number ?? cs.id} is ${cs.status}`);
    if (cs.project_id !== rows[0]!.project_id) throw invalid('suggestions of different projects are not combined');
  }

  // Each item as the combined suggestion will hold it, starting from the site now.
  const items = new Map<EntityId, { type: EntityType; data: Json | null; path: string | null }>();
  const baseData = async (rev: number | null): Promise<Json | null> => (rev === null ? null : ((await one<{ data: Json | null }>(catalog.db, 'SELECT data FROM revision WHERE id = $1', [rev]))?.data ?? null));
  for (const cs of rows) {
    for (const p of await catalog.proposals(cs.id)) {
      const held = items.get(p.entityId);
      const now = held ? held.data : ((await catalog.get(p.entityId))?.data ?? null);
      const result = threeWayMerge(await baseData(p.baseRev), now as Json | null, p.rev.data);
      // Where this change rewrites what came before, it stands.
      const data = result.conflicts.length ? resolveConflicts(result, Object.fromEntries(result.conflicts.map((c) => [c.path, { take: 'theirs' as const }]))) : result.merged;
      items.set(p.entityId, { type: p.type, data, path: p.rev.path });
    }
  }

  const titles = [...new Set(rows.map((cs) => cs.title))];
  const combined = await catalog.createChangeset(by, {
    title: input.title?.trim().slice(0, 200) || (titles.length === 1 ? titles[0]! : titles.slice(0, 3).join(' · ')),
    description: `Combines ${rows.map((cs) => (cs.number !== null ? `#${cs.number}` : `suggestion ${cs.id}`)).join(', ')}.`,
    ...(rows[0]!.project_id !== null ? { project: rows[0]!.project_id } : {}),
  });
  for (const [id, item] of items) await catalog.putRevision(combined.id, by, { id, type: item.type, data: item.data, path: item.path ?? undefined });
  const sent = await catalog.submit(combined.id, by);
  for (const cs of rows) await catalog.withdraw(cs.id, by);
  return sent;
}
