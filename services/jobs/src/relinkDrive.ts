import type { Catalog, Json } from '@rebbehub/core';
import { relinkDrive, SICHOS_KODESH_MEDIA_PROXY } from '@rebbehub/importers';
import type { EntityId, EntityType } from '@rebbehub/model';

/**
 * `rebbehub relink-drive` (docs/operations.md): the links older imports
 * stored on Sichos-Kodesh's media proxy (a hanacha's PDF on a farbrengen,
 * an Otzros page's reading copy) become the file's own Google Drive link,
 * the mafteiach's and Otzros HaRebbe's, which the site reads through
 * RebbeHub's own API. Everything else in the item stays as it is: a link's
 * `origin`, its label, JEM's recordings (not on Drive).
 *
 * Each batch is one Suggestion from the relink bot, sent for review like
 * any bot's; the bot never merges its own. Running it again sends only
 * what is still on the proxy and not already waiting in one of its
 * Suggestions, so it can be run until nothing is left.
 */

export const RELINK_BOT = { id: 'bot:relink-drive', displayName: 'Drive links (relink bot)' };

const PROXY_DRIVE = `${SICHOS_KODESH_MEDIA_PROXY}/drive/`;

export interface RelinkResult {
  /** Items with a Drive file on the proxy, not already waiting in a relink Suggestion. */
  items: number;
  /** Links changed in them. */
  links: number;
  byType: Record<string, number>;
  /** The Suggestions sent (none on a dry run). */
  suggestions: number[];
}

export async function relinkDriveLinks(catalog: Catalog, options: { batch?: number; dryRun?: boolean; log?: (line: string) => void } = {}): Promise<RelinkResult> {
  const batch = Math.min(Math.max(options.batch ?? 500, 1), 5000);
  const log = options.log ?? (() => {});
  const result: RelinkResult = { items: 0, links: 0, byType: {}, suggestions: [] };
  if (!options.dryRun) await catalog.createAccount({ id: RELINK_BOT.id, displayName: RELINK_BOT.displayName, isBot: true });
  let after = '';
  for (;;) {
    const { rows } = await catalog.db.query<{ id: EntityId; type: EntityType; data: Json }>(
      // What main holds now, in id order; an item already in a relink Suggestion waiting for review is left to it.
      `SELECT e.id, e.type, r.data FROM entity e JOIN revision r ON r.id = e.main_rev
       WHERE NOT e.deleted AND e.id > $1 AND r.data::text LIKE $2
         AND NOT EXISTS (SELECT 1 FROM revision p JOIN changeset c ON c.id = p.changeset_id
                         WHERE p.entity_id = e.id AND c.author = $3 AND c.status IN ('draft', 'open', 'sent_back'))
       ORDER BY e.id LIMIT ${batch}`,
      [after, `%${PROXY_DRIVE.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`, RELINK_BOT.id],
    );
    if (!rows.length) break;
    after = rows[rows.length - 1]!.id;
    const changes = rows.flatMap((row) => {
      const relinked = relinkDrive(row.data as never);
      return relinked ? [{ ...row, data: relinked.data as Json, links: relinked.links }] : [];
    });
    if (!changes.length) continue;
    for (const change of changes) {
      result.items++;
      result.links += change.links;
      result.byType[change.type] = (result.byType[change.type] ?? 0) + 1;
    }
    if (options.dryRun) continue;
    const first = result.items - changes.length + 1;
    const cs = await catalog.createChangeset(RELINK_BOT.id, {
      title: `Drive links in place of the media proxy (${first}-${result.items})`,
      description:
        "Links older imports stored on Sichos-Kodesh's media proxy (sichos-kodesh-media-proxy.shmuky.workers.dev) become the file's own Google Drive link, as the mafteiach and Otzros HaRebbe give it. The site reads Drive files through RebbeHub's own API. A link's origin, label and everything else stay as they are.",
      kind: 'import',
    });
    for (const change of changes) await catalog.putRevision(cs.id, RELINK_BOT.id, { id: change.id, type: change.type, data: change.data });
    await catalog.submit(cs.id, RELINK_BOT.id);
    result.suggestions.push(cs.id);
    log(`suggestion ${cs.id}: ${changes.length} items, waiting for review`);
  }
  return result;
}
