import type { EntityId, EntityType } from '@rebbehub/model';

/**
 * Where each thing lives in the git mirror (the public `rebbehub/catalog`
 * repository). Sharded by the first two letters of the id, so no folder
 * grows past about a thousand files.
 *
 *   entities/<type>/<shard>/<id>.json   one item per file
 *   texts/<shard>/<id>.md               a text with its segments, anchored
 *   sync/<shard>/<id>.vtt               an alignment's spans as WebVTT
 *   shaars/<shard>/<id>.md              a sefer's shaar file (docs/shaar.md)
 *   COMMIT                              the last RebbeHub commit exported
 */

export const shardOf = (id: EntityId): string => id.slice(3, 5);

export const entityFile = (type: EntityType | string, id: EntityId): string => `entities/${type}/${shardOf(id)}/${id}.json`;

export const textFile = (id: EntityId): string => `texts/${shardOf(id)}/${id}.md`;

export const shaarFile = (id: EntityId): string => `shaars/${shardOf(id)}/${id}.md`;

export const syncFile = (id: EntityId): string => `sync/${shardOf(id)}/${id}.vtt`;

/** Types whose items are exported inside their parent's file (a text's Markdown, an alignment's WebVTT) rather than one by one. */
export const EMBEDDED_TYPES: ReadonlySet<string> = new Set(['segment', 'alignment-span']);
