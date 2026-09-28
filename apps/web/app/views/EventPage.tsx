import { ChevronLeft, ChevronRight, Clock, ExternalLink, FileText, Music, Pause, PenLine, Play, Video } from 'lucide-react';
import { Link } from 'react-router';
import { dateKeyToHDate } from '@rebbehub/hebrew';
import type { LocalName } from '@rebbehub/model';
import { eventData, type EventItem } from '../components/EventRow.js';
import { ItemList } from '../components/ItemLink.js';
import { Transcripts } from '../components/Transcripts.js';
import { readHref } from '../routes/read.js';
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
  origin?: string;
}

/** `התוועדות · יום חמישי` */
function kicker(date: string | undefined, lang: Lang): string {
  const h = date ? dateKeyToHDate(date) : null;
  const day = h ? (lang === 'he' ? `יום ${WEEKDAYS_HE[h.getDay()]}` : WEEKDAYS_EN[h.getDay()]!) : '';
  return [t(lang, 'farbrengen'), day].filter(Boolean).join(' · ');
}

const KIND_KEYS = {
  mugah: 'kind_mugah',
  'bilti-mugah': 'kind_bilti-mugah',
  maamar: 'kind_maamar',
  hagahos: 'kind_hagahos',
  hosofos: 'kind_hosofos',
  english: 'kind_english',
  audio: 'kind_audio',
  video: 'kind_video',
  other: 'kind_other',
} as const;

/** PDFs the site's own reader opens (read.tsx lets only these hosts in). */
export const readable = (url: string) => /^https:\/\/(sichos-kodesh-media-proxy\.shmuky\.workers\.dev|api\.rebbehub\.org|files\.rebbehub\.org)\//.test(url);

/** A YouTube video's id, when the link is one. */
function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') return u.pathname.slice(1) || null;
    if (/(^|\.)youtube\.com$/.test(u.hostname)) return u.searchParams.get('v') ?? /\/embed\/([\w-]+)/.exec(u.pathname)?.[1] ?? null;
  } catch {
    // not a link
  }
  return null;
}

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

/** YouTube videos of the farbrengen, played on the page (without YouTube's cookies). */
function Videos({ links, lang }: { links: EventLink[]; lang: Lang }) {
  const ids = [...new Set(links.map((l) => youtubeId(l.url)).filter((id): id is string => Boolean(id && /^[\w-]{6,20}$/.test(id))))];
  if (!ids.length) return null;
  return (
    <section>
      <h2 className="section-header">{t(lang, 'videos')}</h2>
      {ids.map((id) => (
        <div key={id} className="video-embed">
          <iframe src={`https://www.youtube-nocookie.com/embed/${id}`} title="YouTube" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin" />
        </div>
      ))}
    </section>
  );
}

/** Everything else the index points to, where it is: HebrewBooks, chabad.org, JEM, sie.org, the English translations. */
function Elsewhere({ links, lang }: { links: EventLink[]; lang: Lang }) {
  if (!links.length) return null;
  return (
    <section>
      <h2 className="section-header">{t(lang, 'elsewhere')}</h2>
      <ul className="elsewhere">
        {links.map((l) => (
          <li key={l.url}>
            <a href={l.url} target="_blank" rel="noopener nofollow">
              {l.kind === 'video' ? <Video size={15} aria-hidden="true" /> : l.kind === 'audio' ? <Music size={15} aria-hidden="true" /> : <ExternalLink size={15} aria-hidden="true" />}
              <b>{nameOf(l.label, lang)}</b>
              <small>
                {t(lang, KIND_KEYS[l.kind as keyof typeof KIND_KEYS] ?? 'kind_other')} · {host(l.url)}
              </small>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Opens in the site's own reader (/read); the player keeps playing. */
function Texts({ links, lang, subtitle }: { links: EventLink[]; lang: Lang; subtitle: string }) {
  return (
    <section>
      <h2 className="section-header">{t(lang, 'texts')}</h2>
      <ul className="docs">
        {links.map((l) => (
          <li key={l.url}>
            <Link className="doc" to={readHref({ url: l.url, title: nameOf(l.label, lang), sub: subtitle }, lang)}>
              <span className="doc-page" aria-hidden="true">
                <FileText size={22} />
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
              <b>{nameOf(l.label, lang)}</b>
              <small>{t(lang, KIND_KEYS[l.kind as keyof typeof KIND_KEYS] ?? 'kind_other')}</small>
            </Link>
            {l.origin ? (
              <a className="doc-origin" href={l.origin} target="_blank" rel="noopener nofollow">
                {t(lang, 'atTheSource')}
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Parts shown before "all parts". */
const SHOWN = 6;

function Recordings({ entity, recordings, sources, lang }: { entity: Entity; recordings: Entity[]; sources: Record<string, string | null>; lang: Lang }) {
  const player = usePlayer();
  const tracks = tracksOf(entity, recordings, lang, sources);
  if (!tracks.length) return null;
  const mine = player.current !== null && tracks.some((tr) => tr.id === player.current!.id);
  // One part of the playlist; the first few show, the rest open with "all parts".
  const part = (track: (typeof tracks)[number], i: number) => {
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
  };
  const videos = recordings.flatMap((r) => (r.data as unknown as { videos?: Array<{ url: string; startMs?: number }> }).videos ?? []);
  return (
    <section id="listen" className="listen-card">
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
      <ol className="part-list">{tracks.slice(0, SHOWN).map(part)}</ol>
      {tracks.length > SHOWN ? (
        <details className="more">
          <summary className="more-link">
            {t(lang, 'allParts')} ({tracks.length})
          </summary>
          <ol className="part-list" start={SHOWN + 1}>
            {tracks.slice(SHOWN).map((track, i) => part(track, i + SHOWN))}
          </ol>
        </details>
      ) : null}
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
  const parsha = d.date ? parshaOf(d.date, lang) : null;
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
      <header className="event-hero">
        <p className="event-hero-kicker">{kicker(d.date, lang)}</p>
        <h1>{nameOf(d.title, lang)}</h1>
        {d.date ? <p className="event-hero-date">{dateLabel(d.date, lang)}</p> : null}
        <ul className="event-hero-chips">
          {parsha ? (
            <li>
              {t(lang, 'parshas')} {parsha}
            </li>
          ) : null}
          {length ? (
            <li>
              <Clock size={13} aria-hidden="true" /> {length}
            </li>
          ) : null}
          {hasHanacha ? (
            <li>
              <FileText size={13} aria-hidden="true" /> {t(lang, 'hanacha')}
            </li>
          ) : null}
          {hasMugah ? (
            <li>
              <PenLine size={13} aria-hidden="true" /> {t(lang, 'kind_mugah')}
            </li>
          ) : null}
        </ul>
      </header>

      <Recordings entity={entity} recordings={recordings} sources={sources} lang={lang} />
      <Transcripts tracks={tracksOf(entity, recordings, lang, sources)} lang={lang} />
      {links.some((l) => readable(l.url)) ? <Texts links={links.filter((l) => readable(l.url))} lang={lang} subtitle={[nameOf(d.title, lang), d.date ? dateLabel(d.date, lang, { civil: false }) : ''].filter(Boolean).join(' · ')} /> : null}
      <Videos links={links.filter((l) => youtubeId(l.url))} lang={lang} />
      <Elsewhere links={links.filter((l) => !readable(l.url) && !youtubeId(l.url))} lang={lang} />

      {view.lists.units?.length ? (
        <section>
          <h2 className="section-header">{t(lang, 'saidThere')}</h2>
          <ItemList items={view.lists.units} />
        </section>
      ) : null}

      {view.lists.otherYears?.length ? (
        <section>
          <h2 className="section-header">{t(lang, 'sameDateOtherYears')}</h2>
          <ul className="pills year-pills">
            {(view.lists.otherYears as EventItem[]).map((e) => (
              <li key={e.id}>
                <Link className="pill" to={href(itemPath(e), lang)} title={nameOf(eventData(e).title, lang)}>
                  {yearLabel(Number(String(eventData(e).date).slice(0, 4)), lang)}
                  {e.recordings ? <Music size={12} aria-hidden="true" /> : null}
                </Link>
              </li>
            ))}
          </ul>
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
