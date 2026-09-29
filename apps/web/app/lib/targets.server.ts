import type { LocalName } from '@rebbehub/model';
import type { Entity, RebbeHubApi } from './api.js';
import { nameOf, typeName, type Lang } from './i18n.js';
import { labelOf } from './labels.js';
import { itemPath } from './links.js';

/**
 * What a change is to, as people say it: a paragraph is "Noach · section
 * 3" in its sefer, not a segment id; a new printing is its sefer's. Asked
 * of the API in two batches (the items, then the items they belong to).
 */

export interface Target {
  id: string;
  /** Where the item's own page is (the unit's, for a paragraph). */
  path: string;
  /** "נח · סעיף ג" */
  label: string;
  /** "ליקוטי שיחות, חלק א" */
  within: string | null;
  /** The sefer or farbrengen the item belongs to, for filters and follows. */
  rootId: string | null;
  type: string;
}

const LETTERS = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח', 'ט', 'י', 'יא', 'יב', 'יג', 'יד', 'טו', 'טז', 'יז', 'יח', 'יט', 'כ'];
export const sectionLetter = (i: number, lang: Lang) => (lang === 'he' ? (LETTERS[i] ?? String(i + 1)) : String(i + 1));

export async function describeTargets(api: RebbeHubApi, entries: Array<{ entityId: string; type: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }>, lang: Lang): Promise<Map<string, Target>> {
  const data = (e: (typeof entries)[number]) => (e.after ?? e.before ?? {}) as Record<string, unknown>;
  // First the items each points at: a paragraph's text, a unit's work, a printing's work, a recording's farbrengen.
  const up = new Set<string>();
  for (const e of entries) for (const f of ['text', 'work', 'event', 'publication', 'unit']) if (typeof data(e)[f] === 'string') up.add(data(e)[f] as string);
  const first = await api.entities([...up]).catch(() => new Map<string, Entity>());
  // Then a text's unit, and a unit's work.
  const more = new Set<string>();
  for (const item of first.values()) for (const f of ['unit', 'work', 'event']) if (typeof (item.data as Record<string, unknown>)[f] === 'string') more.add((item.data as Record<string, unknown>)[f] as string);
  const second = await api.entities([...more].filter((id) => !first.has(id))).catch(() => new Map<string, Entity>());
  const get = (id: unknown) => (typeof id === 'string' ? (first.get(id) ?? second.get(id)) : undefined);
  const workLine = (unit: Entity | undefined) => {
    if (!unit) return null;
    const d = unit.data as { work?: string; position?: Array<{ level: string; label?: LocalName; value: string }> };
    const work = get(d.work);
    const volume = d.position?.find((p) => p.level === 'volume');
    const title = work ? labelOf(work, lang) : null;
    return [title, volume ? (nameOf(volume.label, lang) || volume.value) : null].filter(Boolean).join(', ') || null;
  };

  const out = new Map<string, Target>();
  for (const e of entries) {
    const d = data(e);
    const item = { id: e.entityId, type: e.type, path: null, rev: 0, data: d } as Entity;
    if (e.type === 'segment') {
      const text = get(d.text);
      const unit = get((text?.data as { unit?: string } | undefined)?.unit);
      out.set(e.entityId, {
        id: e.entityId,
        path: unit ? `${itemPath(unit)}#${e.entityId}` : `/${e.entityId}`,
        label: unit ? labelOf(unit, lang) : typeName('segment', lang),
        within: workLine(unit),
        rootId: (unit?.data as { work?: string } | undefined)?.work ?? unit?.id ?? null,
        type: e.type,
      });
      continue;
    }
    if (e.type === 'unit') {
      out.set(e.entityId, { id: e.entityId, path: `/${e.entityId}`, label: labelOf(item, lang), within: workLine(item), rootId: (d.work as string | undefined) ?? null, type: e.type });
      continue;
    }
    const parent = get(d.work) ?? get(d.event) ?? get(d.publication) ?? get(d.unit);
    out.set(e.entityId, { id: e.entityId, path: `/${e.entityId}`, label: labelOf(item, lang), within: parent ? labelOf(parent, lang) : null, rootId: parent?.id ?? null, type: e.type });
  }
  return out;
}
