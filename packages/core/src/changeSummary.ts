import type { EntityId, EntityType } from '@rebbehub/model';
import type { ChangeEntry } from './catalog.js';
import type { Json } from './merge.js';

/**
 * A summary of a Suggestion's changes for the reviewer, so that a bot's
 * 500 items that all change the same way read as one change: "500
 * works: links on the media proxy became links on Drive". Items whose
 * change touches the same fields in the same way are grouped, with a few
 * of them to look at as examples. What a field was and became is said by
 * its kind (text, a list), or, for links, by the sites they point to; the
 * words themselves are in the items. Worked out from the items, not
 * guessed: it is not machine output.
 */
export interface ChangeGroup {
  type: EntityType;
  /** A new item, a deleted one, or a changed one. */
  kind: 'new' | 'deleted' | 'changed';
  /** How many items change this way. */
  count: number;
  /** The fields changed ("/links"; a list's place as "*"), and what they were and became. */
  fields: Array<{ path: string; before: string; after: string }>;
  /** A few of the items, to look at first. */
  examples: EntityId[];
}

/** At most this many groups; a Suggestion changing more ways than this is read item by item. */
const MAX_GROUPS = 20;
const EXAMPLES = 3;

/** Every http(s) address in a value, however deep. */
function urlsIn(value: Json | undefined, out = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    if (/^https?:\/\//i.test(value)) out.add(value);
  } else if (Array.isArray(value)) for (const v of value) urlsIn(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) urlsIn(v, out);
  return out;
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const hosts = (urls: Iterable<string>) => [...new Set([...urls].map(hostOf))].sort().join(', ');

/** What a value is, in one word. */
function kindOf(value: Json | undefined): string {
  if (value === undefined || value === null) return 'none';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'object') return 'object';
  if (typeof value === 'boolean') return String(value);
  return typeof value === 'number' ? 'number' : 'text';
}

/** A field's change as the group knows it: where, and what it was and became (the links' sites, when links are what changed). */
function fieldOf(path: string, before: Json | undefined, after: Json | undefined) {
  const place = path.replace(/\/\d+(?=\/|$)/g, '/*');
  const was = urlsIn(before);
  const now = urlsIn(after);
  const gone = [...was].filter((u) => !now.has(u));
  const came = [...now].filter((u) => !was.has(u));
  if (gone.length || came.length) return { path: place, before: gone.length ? `link:${hosts(gone)}` : kindOf(before), after: came.length ? `link:${hosts(came)}` : kindOf(after) };
  return { path: place, before: kindOf(before), after: kindOf(after) };
}

export function summarizeChanges(entries: ChangeEntry[]): ChangeGroup[] {
  const groups = new Map<string, ChangeGroup>();
  for (const entry of entries) {
    const kind = entry.before === null ? 'new' : entry.after === null ? 'deleted' : 'changed';
    const fields =
      kind === 'changed'
        ? [...new Map(entry.changes.map((c) => fieldOf(c.path, c.before, c.after)).map((f) => [JSON.stringify(f), f])).values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        : [];
    const key = JSON.stringify([entry.type, kind, fields]);
    const group = groups.get(key);
    if (group) {
      group.count++;
      if (group.examples.length < EXAMPLES) group.examples.push(entry.entityId);
    } else groups.set(key, { type: entry.type, kind, count: 1, fields, examples: [entry.entityId] });
  }
  return [...groups.values()].sort((a, b) => b.count - a.count).slice(0, MAX_GROUPS);
}
