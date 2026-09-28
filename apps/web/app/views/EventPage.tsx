import { ChevronLeft, ChevronRight, Clock, FileText, Pause, PenLine, Play, Video } from 'lucide-react';
import { Link } from 'react-router';
import { dateKeyToHDate } from '@rebbehub/hebrew';
import type { LocalName } from '@rebbehub/model';
import { EventRows, eventData, type EventItem } from '../components/EventRow.js';
import { ItemList } from '../components/ItemLink.js';
import type { Entity } from '../lib/api.js';
import { dateLabel, yearLabel } from '../lib/dates.js';
import { nameOf, t, type Lang } from '../lib/i18n.js';
import type { ItemView } from '../lib/itemData.server.js';
import { href, itemPath } from '../lib/links.js';
import { totalLength, tracksOf } from '../lib/tracks.js';
import { parshaOf } from '../lib/week.js';
import { clock, usePlayer } from '../player/PlayerProvider.js';

/**
 * A farbrengen's page, as Sichos-Kodesh's app shows one: its name and date,
 * what there is of it, its recordings as one playlist that plays in the
 * site's player, its texts (the hanachos first), the same date in other
 * years, and the farbrengens before and after it.
 */

const WEEKDAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Shabbos'];

interface EventLink {
  kind: string;
  label: LocalName;
  url: string;
}

function whenLine(date: string | undefined, lang: Lang): string {
  if (!date) return '';
  const parts: string[] = [];
  const h = dateKeyToHDate(date);
  if (h) parts.push(lang === 'he' ? `יום ${WEEKDAYS_HE[h.getDay()]}` : WEEKDAYS_EN[h.getDay()]!);
  parts.push(dateLabel(date, lang));
  const parsha = h ? parshaOf(date, lang) : null;
  if (parsha) parts.push(`${t(lang, 'parshas')} ${parsha}`);
  return parts.join(' · ');
}

const KIND_KEYS = {
  mugah: 'kind_mugah',
  'bilti-mugah': 'kind_bilti-mugah',
  maamar: 'kind_maamar',
  hagahos: 'kind_hagahos',
  hosofos: 'kind_hosofos',
  other: 'kind_other',
} as const;

function Texts({ links, lang }: { links: EventLink[]; lang: Lang }) {
  const groups = new Map<string, EventLink[]>();
  for (const l of links) groups.set(l.kind, [...(groups.get(l.kind) ?? []), l]);
  return (
    <section>
      <h2 className="section-header">{t(lang, 'texts')}</h2>
      {[...groups.entries()].map(([kind, list]) => (
        <div key={kind} className="contents-group">
          <h3>{t(lang, KIND_KEYS[kind as keyof typeof KIND_KEYS] ?? 'kind_other')}</h3>
          <ul className="card-list rows">
            {list.map((l) => (
              <li key={l.url}>
                <a className="row" href={l.url} target="_blank" rel="noopener">
                  <span className="row-icon" aria-hidden="true">
                    <FileText size={18} />
                  </span>
                  <span className="row-main">
                    <span className="row-title">{nameOf(l.label, lang)}</span>
                    <span className="row-sub">{t(lang, 'openPdf')}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Recordings({ entity, recordings, sources, lang }: { entity: Entity; recordings: Entity[]; sources: Record<string, string | null>; lang: Lang }) {
  const player = usePlayer();
  const tracks = tracksOf(entity, recordings, lang, sources);
  if (!tracks.length) return null;
  const mine = player.current !== null && tracks.some((tr) => tr.id === player.current!.id);
  const videos = recordings.flatMap((r) => (r.data as unknown as { videos?: Array<{ url: string; startMs?: number }> }).videos ?? []);
  return (
    <section id="listen">
      <div className="playlist-header">
        <button type="button" className="play-button" onClick={() => (mine ? player.toggle() : player.play(tracks))} aria-label={mine && player.playing ? t(lang, 'pause') : t(lang, 'playAll')}>
          {mine && player.playing ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <div>
          <h2>{t(lang, 'recordings')}</h2>
          <span className="row-sub">
            {tracks.length} {t(lang, 'parts')}
            {totalLength(recordings, lang) ? ` · ${totalLength(recordings, lang)}` : ''}
          </span>
        </div>
      </div>
      <ol className="part-list">
        {tracks.map((track, i) => {
          const active = player.current?.id === track.id;
          return (
            <li key={track.id}>
              <button type="button" className={active ? 'part active' : 'part'} onClick={() => (active ? player.toggle() : player.play(tracks, i))} aria-current={active ? 'true' : undefined}>
                <span className="part-no">{active && player.playing ? <Pause size={14} /> : i + 1}</span>
                <span className="part-title">{track.title}</span>
                {track.durationMs ? <span className="part-time">{clock(track.durationMs / 1000)}</span> : null}
              </button>
            </li>
          );
        })}
      </ol>
      {videos.length ? (
        <ul className="pills" style={{ marginTop: 12 }}>
          {videos.map((v, i) => (
            <li key={i}>
              <a className="pill" href={videoAt(v.url, v.startMs)} target="_blank" rel="noopener">
                <Video size={14} aria-hidden="true" />
                {t(lang, 'video')}
                {v.startMs ? ` ${clock(v.startMs / 1000)}` : ''}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** A video link that opens at the event's moment, where the provider allows it. */
function videoAt(url: string, startMs?: number): string {
  if (!startMs) return url;
  const seconds = Math.floor(startMs / 1000);
  if (/youtube\.com|youtu\.be/.test(url)) return `${url}${url.includes('?') ? '&' : '?'}t=${seconds}`;
  return `${url}#t=${seconds}`;
}

function Neighbor({ event, lang, which }: { event: EventItem | undefined; lang: Lang; which: 'previous' | 'next' }) {
  if (!event) return null;
  const rtl = lang === 'he';
  const Icon = which === 'previous' ? (rtl ? ChevronRight : ChevronLeft) : rtl ? ChevronLeft : ChevronRight;
  return (
    <Link to={href(itemPath(event), lang)} className={which}>
      <small>
        {which === 'previous' ? <Icon size={12} /> : null} {t(lang, which)} {which === 'next' ? <Icon size={12} /> : null}
      </small>
      <span>{nameOf(eventData(event).title, lang)}</span>
    </Link>
  );
}

export function EventPage({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const d = entity.data as unknown as { title: LocalName; date?: string; links?: EventLink[] };
  const recordings = view.lists.recordings ?? [];
  const sources = Object.fromEntries(recordings.map((r) => [r.id, view.files[r.id]?.url ?? null]));
  const year = d.date ? Number(d.date.slice(0, 4)) : null;
  const links = d.links ?? [];
  const length = totalLength(recordings, lang);
  const hasHanacha = links.some((l) => l.kind === 'bilti-mugah');
  const hasMugah = links.some((l) => l.kind === 'mugah');
  const previous = view.lists.previous?.[0] as EventItem | undefined;
  const following = view.lists.following?.[0] as EventItem | undefined;
  return (
    <>
      <ol className="breadcrumbs">
        <li>
          <Link to={href('/calendar', lang)}>{t(lang, 'tabFarbrengens')}</Link>
        </li>
        {year ? (
          <li>
            <Link to={href(`/calendar/${year}`, lang)}>{yearLabel(year, lang)}</Link>
          </li>
        ) : null}
      </ol>
      <h1>{nameOf(d.title, lang)}</h1>
      <p className="event-date">{whenLine(d.date, lang)}</p>
      {length || hasHanacha || hasMugah ? (
        <ul className="pills">
          {length ? (
            <li className="pill">
              <Clock size={14} aria-hidden="true" />
              {length}
            </li>
          ) : null}
          {hasHanacha ? (
            <li className="pill">
              <FileText size={14} aria-hidden="true" />
              {t(lang, 'hanacha')}
            </li>
          ) : null}
          {hasMugah ? (
            <li className="pill">
              <PenLine size={14} aria-hidden="true" />
              {t(lang, 'kind_mugah')}
            </li>
          ) : null}
        </ul>
      ) : null}

      <Recordings entity={entity} recordings={recordings} sources={sources} lang={lang} />
      {links.length ? <Texts links={links} lang={lang} /> : null}

      {view.lists.units?.length ? (
        <section>
          <h2 className="section-header">{t(lang, 'saidThere')}</h2>
          <ItemList items={view.lists.units} />
        </section>
      ) : null}

      {view.lists.otherYears?.length ? (
        <section>
          <h2 className="section-header">{t(lang, 'sameDateOtherYears')}</h2>
          <EventRows events={(view.lists.otherYears as EventItem[]).slice(0, 10)} sub={(e) => yearLabel(Number(String(eventData(e).date).slice(0, 4)), lang)} />
          {view.lists.otherYears.length > 10 ? (
            <details className="more">
              <summary className="more-link">
                {t(lang, 'moreResults')} ({view.lists.otherYears.length - 10})
              </summary>
              <EventRows events={(view.lists.otherYears as EventItem[]).slice(10)} sub={(e) => yearLabel(Number(String(eventData(e).date).slice(0, 4)), lang)} />
            </details>
          ) : null}
        </section>
      ) : null}

      {previous || following ? (
        <nav className="neighbors" aria-label={lang === 'he' ? 'התוועדויות סמוכות' : 'Nearby farbrengens'}>
          <Neighbor event={previous} lang={lang} which="previous" />
          <Neighbor event={following} lang={lang} which="next" />
        </nav>
      ) : null}
    </>
  );
}
