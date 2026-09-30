import type { Catalog, Json } from '@rebbehub/core';
import { relinkDrive, relinkJem, SICHOS_KODESH_MEDIA_PROXY } from '@rebbehub/importers';
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
 *
 * `rebbehub relink-jem` does the same for links to JEM's player: the
 * older form (`ashreinu.app/player?…`) becomes the Ashreinu app's own
 * (`ashreinu.app/#/player/…`). The audio stays on the proxy.
 */

export const RELINK_BOT = { id: 'bot:relink-drive', displayName: 'Drive links (relink bot)' };
export const RELINK_JEM_BOT = { id: 'bot:relink-jem', displayName: 'JEM audio links (relink bot)' };

interface Relink {
  bot: { id: string; displayName: string };
  /** What an item's data holds while it still needs relinking (any of them). */
  prefixes: string[];
  relink: (data: Json) => { data: Json; links: number } | null;
  title: string;
  description: string;
}

const DRIVE: Relink = {
  bot: RELINK_BOT,
  prefixes: [`${SICHOS_KODESH_MEDIA_PROXY}/drive/`],
  relink: (data) => relinkDrive(data as never) as { data: Json; links: number } | null,
  title: 'Drive links in place of the media proxy',
  description:
    "Links older imports stored on Sichos-Kodesh's media proxy (sichos-kodesh-media-proxy.shmuky.workers.dev) become the file's own Google Drive link, as the mafteiach and Otzros HaRebbe give it. The site reads Drive files through RebbeHub's own API. A link's origin, label and everything else stay as they are.",
};

const JEM: Relink = {
  bot: RELINK_JEM_BOT,
  prefixes: ['https://ashreinu.app/player?'],
  relink: (data) => relinkJem(data as never) as { data: Json; links: number } | null,
  title: 'JEM links open the Ashreinu app',
  description:
    "Links to JEM's player in the form older imports stored (ashreinu.app/player?…) become the Ashreinu app's own link to the recording (ashreinu.app/#/player/…). The audio, heard through Sichos-Kodesh's media proxy, and everything else stay as they are.",
};

export interface RelinkResult {
  /** Items with a Drive file on the proxy, not already waiting in a relink Suggestion. */
  items: number;
  /** Links changed in them. */
  links: number;
  byType: Record<string, number>;
  /** The Suggestions sent (none on a dry run). */
  suggestions: number[];
}

type RelinkOptions = { batch?: number; dryRun?: boolean; log?: (line: string) => void };

export const relinkDriveLinks = (catalog: Catalog, options: RelinkOptions = {}) => relinkLinks(catalog, DRIVE, options);
export const relinkJemLinks = (catalog: Catalog, options: RelinkOptions = {}) => relinkLinks(catalog, JEM, options);

async function relinkLinks(catalog: Catalog, spec: Relink, options: RelinkOptions): Promise<RelinkResult> {
  const batch = Math.min(Math.max(options.batch ?? 500, 1), 5000);
  const log = options.log ?? (() => {});
  const result: RelinkResult = { items: 0, links: 0, byType: {}, suggestions: [] };
  if (!options.dryRun) await catalog.createAccount({ id: spec.bot.id, displayName: spec.bot.displayName, isBot: true });
  let after = '';
  for (;;) {
    const { rows } = await catalog.db.query<{ id: EntityId; type: EntityType; data: Json }>(
      // What main holds now, in id order; an item already in a relink Suggestion waiting for review is left to it.
      `SELECT e.id, e.type, r.data FROM entity e JOIN revision r ON r.id = e.main_rev
       WHERE NOT e.deleted AND e.id > $1 AND r.data::text LIKE ANY($2)
         AND NOT EXISTS (SELECT 1 FROM revision p JOIN changeset c ON c.id = p.changeset_id
                         WHERE p.entity_id = e.id AND c.author = $3 AND c.status IN ('draft', 'open', 'sent_back'))
       ORDER BY e.id LIMIT ${batch}`,
      [after, spec.prefixes.map((prefix) => `%${prefix.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`), spec.bot.id],
    );
    if (!rows.length) break;
    after = rows[rows.length - 1]!.id;
    const changes = rows.flatMap((row) => {
      const relinked = spec.relink(row.data);
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
    const cs = await catalog.createChangeset(spec.bot.id, { title: `${spec.title} (${first}-${result.items})`, description: spec.description, kind: 'import' });
    for (const change of changes) await catalog.putRevision(cs.id, spec.bot.id, { id: change.id, type: change.type, data: change.data });
    await catalog.submit(cs.id, spec.bot.id);
    result.suggestions.push(cs.id);
    log(`suggestion ${cs.id}: ${changes.length} items, waiting for review`);
  }
  return result;
}
