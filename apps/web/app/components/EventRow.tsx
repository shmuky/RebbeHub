import { useState } from 'react';
import { Link } from 'react-router';
import type { LocalName } from '@rebbehub/model';
import type { Entity } from '../lib/api.js';
import { dateLabel } from '../lib/dates.js';
import { nameOf, t, type Lang } from '../lib/i18n.js';
import { href, itemPath } from '../lib/links.js';
import { useLang } from '../lib/useLang.js';
import { usePlayer, type Track } from '../player/PlayerProvider.js';
import { Icon } from '../ui/Icon.js';

export type EventItem = Pick<Entity, 'id' | 'path' | 'type' | 'data'> & { recordings?: number };

interface EventData {
  title?: LocalName;
  date?: string;
  links?: Array<{ kind: string; url: string }>;
}

export const eventData = (e: EventItem) => e.data as unknown as EventData;
export const hanachaOf = (e: EventItem) => eventData(e).links?.find((l) => l.kind === 'bilti-mugah' || l.kind === 'mugah') ?? eventData(e).links?.[0];

/**
 * Play a farbrengen from a list without opening it: its parts are fetched
 * from the site (/_/tracks/:id) and handed to the player. While it plays,
 * the button pauses it.
 */
export function PlayEventButton({ event, size = 'small' }: { event: EventItem; size?: 'small' | 'large' }) {
  const lang = useLang();
  const player = usePlayer();
  const [loading, setLoading] = useState(false);
  const mine = player.current?.href === href(itemPath(event), lang);
  const label = `${mine && player.playing ? t(lang, 'pause') : t(lang, 'play')}: ${nameOf(eventData(event).title, lang)}`;
  async function start() {
    if (mine) return player.toggle();
    setLoading(true);
    try {
      const res = await fetch(href(`/_/tracks/${event.id}`, lang));
      const { tracks } = (await res.json()) as { tracks: Track[] };
      if (tracks.length) player.play(tracks);
    } finally {
      setLoading(false);
    }
  }
  return (
    <button type="button" className={size === 'small' ? 'pp sm' : 'pp'} onClick={start} aria-label={label} title={label}>
      {loading ? <Icon name="loader" className="spin" /> : <Icon name={mine && player.playing ? 'pause' : 'play'} />}
    </button>
  );
}

/** One farbrengen as a row: its name, its date, and whether it can be heard and read. */
export function EventRow({ event, sub, lang }: { event: EventItem; sub?: string; lang: Lang }) {
  const d = eventData(event);
  return (
    <Link className="row hover" to={href(itemPath(event), lang)}>
      <span className="row-main">
        <span className="row-title">{nameOf(d.title, lang)}</span>
        <span className="row-sub">{sub ?? (d.date ? dateLabel(d.date, lang, { civil: false }) : '')}</span>
      </span>
      <span className="end has" aria-hidden="true">
        {d.links?.length ? <Icon name="scan" /> : null}
        {event.recordings ? <Icon name="audio" /> : null}
      </span>
    </Link>
  );
}

/** Farbrengens as rows, in a box. */
export function EventRows({ events, sub }: { events: EventItem[]; sub?: (e: EventItem) => string }) {
  const lang = useLang();
  return (
    <ul className="box rows">
      {events.map((e) => (
        <li key={e.id}>
          <EventRow event={e} sub={sub?.(e)} lang={lang} />
        </li>
      ))}
    </ul>
  );
}
