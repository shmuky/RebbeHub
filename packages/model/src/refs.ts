import type { EntityType } from './entities.js';
import { isEntityId, type EntityId } from './ids.js';

/**
 * Which fields of which types point at which other types. The store checks
 * these when a suggestion is sent (a unit's `work` must be a work that
 * exists), and they are the edges behind "Printed in…", "Cited by…" and
 * every other backlink.
 */
export const REFERENCE_FIELDS: Partial<Record<EntityType, Record<string, readonly EntityType[]>>> = {
  set: { parent: ['set'] },
  work: { authors: ['author'], 'addition.to': ['work'] },
  unit: { work: ['work'], events: ['event'] },
  event: { place: ['place'], people: ['person'] },
  publication: { work: ['work'], reprintOf: ['publication'] },
  scan: { publication: ['publication'] },
  'contents-map': { publication: ['publication'], unit: ['unit'] },
  'text-layer': { scan: ['scan'], seededFrom: ['text-layer'] },
  'text-page': { layer: ['text-layer'] },
  text: { unit: ['unit'], publication: ['publication'], recording: ['recording'], translationOf: ['text'] },
  segment: { text: ['text'] },
  recording: { event: ['event'] },
  alignment: { recording: ['recording'], text: ['text'] },
  'alignment-span': { alignment: ['alignment'], segment: ['segment'] },
  relation: { at: ['segment'] },
  person: { author: ['author'] },
  place: { within: ['place'] },
  topic: { broader: ['topic'] },
};

/** Fields every catalog item may carry, and what they point at. */
const COMMON_REFERENCES: Record<string, readonly EntityType[]> = { sets: ['set'], topics: ['topic'] };

export interface Reference {
  /** The field it is in, dotted for nested ones: `page.scan`. */
  field: string;
  id: EntityId;
  /** The types it may point at; empty when any type will do (a relation's ends). */
  expected: readonly EntityType[];
}

/** Every entity id an item's data points at, with the types each may be. */
export function referencesOf(type: EntityType, data: unknown): Reference[] {
  const fields = { ...COMMON_REFERENCES, ...(REFERENCE_FIELDS[type] ?? {}) };
  const out: Reference[] = [];
  const walk = (value: unknown, path: string[]): void => {
    if (typeof value === 'string') {
      if (!isEntityId(value)) return;
      // In a page's words only a link is one: an item named in a run of text is just words.
      if (path[0] === 'body') {
        if (path[path.length - 1] === 'href') out.push({ field: 'body.href', id: value, expected: [] });
        return;
      }
      const field = path.filter((p) => !/^\d+$/.test(p)).join('.');
      out.push({ field, id: value, expected: fields[field] ?? fields[path[0] ?? ''] ?? (field === 'page.scan' ? ['scan'] : []) });
      return;
    }
    if (Array.isArray(value)) value.forEach((item, i) => walk(item, [...path, String(i)]));
    else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) walk(item, [...path, key]);
  };
  // A schema's own JSON Schema is data about types, not links.
  if (type === 'schema') return out;
  walk(data, []);
  return out;
}
