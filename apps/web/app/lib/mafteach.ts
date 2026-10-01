import type { Lang } from './i18n.js';
import type { Mafteach, MafteachPlace } from './api.js';
import { hebrewNumber } from './volumes.js';

/** A place's pages: one page, or from one to another. */
export function pages(place: MafteachPlace): string {
  return place.to && place.to !== place.page ? `${place.page}-${place.to}` : String(place.page);
}

/** One reference as a chip says it: the volume as the printed indexes write it (ח״ב, חט״ו) and the page. */
export function chipLabel(volume: number, place: MafteachPlace, lang: Lang): string {
  if (lang === 'en') return `${volume}:${pages(place)}`;
  const n = hebrewNumber(volume);
  return `ח${n.slice(0, -1)}״${n.slice(-1)} ${pages(place)}`;
}

/** A reference with the volume it is in, so the pane beside the list can say where it is. */
export interface Ref {
  key: string;
  volume: number;
  label: string;
  path: string | null;
  machine: boolean;
  place: MafteachPlace;
}

/**
 * A topic's references as the design lists them: one line for each thing
 * the index says about the topic, and on it every volume's pages that say
 * it, so the same words in two volumes are one line with two chips. Lines
 * keep the order the volumes first give them; the pages with no words of
 * their own come first, as the topic's own line.
 */
export function topicLines(topic: Mafteach['topics'][number]): Array<{ context: string; refs: Ref[] }> {
  const lines = new Map<string, Ref[]>();
  for (const v of topic.volumes)
    v.places.forEach((place, i) => {
      const context = place.context?.trim() ?? '';
      const refs = lines.get(context) ?? [];
      refs.push({ key: `${v.volume}-${i}`, volume: v.volume, label: v.label, path: v.path, machine: v.machine, place });
      lines.set(context, refs);
    });
  const out = [...lines].map(([context, refs]) => ({ context, refs }));
  return out.sort((a, b) => Number(Boolean(a.context)) - Number(Boolean(b.context)));
}

