import type { LocalName } from '@rebbehub/model';
import type { Track } from '../player/PlayerProvider.js';
import type { Entity } from './api.js';
import { dateLabel } from './dates.js';
import { nameOf, t, type Lang } from './i18n.js';
import { href, itemPath } from './links.js';

interface RecordingData {
  title: LocalName;
  url?: string;
  durationMs?: number;
  part?: number;
}

interface EventData {
  title: LocalName;
  date?: string;
}

/** An event's recordings as the player's queue, part by part; parts with nowhere to be heard are left out. */
export function tracksOf(event: Pick<Entity, 'id' | 'path' | 'data'>, recordings: Entity[], lang: Lang, sources: Record<string, string | null> = {}): Track[] {
  const e = event.data as unknown as EventData;
  const subtitle = [nameOf(e.title, lang), e.date ? dateLabel(e.date, lang, { civil: false }) : ''].filter(Boolean).join(' · ');
  return recordings
    .map((r) => ({ r, d: r.data as unknown as RecordingData }))
    .sort((a, b) => (a.d.part ?? 0) - (b.d.part ?? 0))
    .flatMap(({ r, d }) => {
      const url = sources[r.id] ?? d.url;
      if (!url) return [];
      return [{ id: r.id, title: nameOf(d.title, lang) || `${t(lang, 'part')} ${d.part ?? ''}`, subtitle, url, durationMs: d.durationMs, href: href(itemPath(event), lang) }];
    });
}

/** Total length of recordings, as `4 שע׳ 14 דק׳` or `45 min`. */
export function totalLength(recordings: Entity[], lang: Lang): string {
  const ms = recordings.reduce((sum, r) => sum + ((r.data as unknown as RecordingData).durationMs ?? 0), 0);
  if (!ms) return '';
  const minutes = Math.round(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = `${minutes % 60} ${t(lang, 'minutes')}`;
  return hours ? `${hours} ${t(lang, 'hours')}${minutes % 60 ? ` ${rest}` : ''}` : rest;
}
