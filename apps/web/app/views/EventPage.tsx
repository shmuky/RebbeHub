import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { dateKeyToGregorian, dateKeyToHDate, monthByToken } from '@rebbehub/hebrew';
import type { LocalName } from '@rebbehub/model';
import { eventData, type EventItem } from '../components/EventRow.js';
import { SeeAll } from '../components/Linked.js';
import { Transcripts } from '../components/Transcripts.js';
import { readHref } from '../routes/read.js';
import type { Entity } from '../lib/api.js';
import { dateLabel, yearLabel } from '../lib/dates.js';
import type { EventText, SaidRow } from '../lib/eventView.server.js';
import { nameOf, t, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import type { ItemView } from '../lib/itemData.server.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { eventKindName } from '../lib/pageStrings.js';
import { totalLength, tracksOf } from '../lib/tracks.js';
import { parshaOf } from '../lib/week.js';
import { clock, usePlayer, type Track } from '../player/PlayerProvider.js';
import { Icon } from '../ui/Icon.js';
import { ItemShell, type ItemHead } from '../ui/ItemShell.js';
import { PageThumb } from '../ui/Shaar.js';
import { EmptyState, Label, MachineLabel, Segmented, cx } from '../ui/primitives.js';
import { commonTabs, SideActivity, SideDetails, SideSection } from './itemParts.js';

/**
 * A farbrengen's page, as Sichos-Kodesh's app shows one, made for a phone
 * first: its name, day and place; its recordings in one player, part by
 * part, with the part that is missing a recording asking who knows where
 * it is; what was said there, each with where it is printed and the moment
 * it is heard; its hanachos and printings as pages; and its words, the
 * original, the English or both side by side, the paragraph being heard
 * marked as it plays. A sync the machine made says so until a person
 * checks it. The same date in other years and the farbrengens around it
 * are in the side column.
 */

const W = {
  farbrengens: { he: 'התוועדויות', en: 'Farbrengens' },
  playing: { he: 'מתנגן', en: 'Playing' },
  paused: { he: 'מושהה', en: 'Paused' },
  ready: { he: 'הקלטה', en: 'Recording' },
  partOf: { he: 'חלק {n} מתוך {of}', en: 'part {n} of {of}' },
  back15: { he: 'חזרה 15 שניות', en: 'Back 15 seconds' },
  fwd15: { he: 'קדימה 15 שניות', en: 'Forward 15 seconds' },
  play: { he: 'ניגון', en: 'Play' },
  pause: { he: 'השהיה', en: 'Pause' },
  seek: { he: 'מיקום בהקלטה', en: 'Position in the recording' },
  noRecording: { he: 'אין הקלטה', en: 'No recording' },
  knowWhere: { he: 'יודעים איפה?', en: 'Know where it is?' },
  said: { he: 'מה שנאמר בה', en: 'What was said' },
  playFrom: { he: 'לשמוע מכאן', en: 'Play from here' },
  page: { he: 'עמ׳', en: 'p.' },
  mugah: { he: 'מוגה', en: 'Edited (mugah)' },
  bilti: { he: 'בלתי מוגה', en: 'Unedited' },
  docs: { he: 'הנחות וסריקות', en: 'Hanachos and scans' },
  all: { he: 'הכול', en: 'All' },
  fewer: { he: 'פחות', en: 'Fewer' },
  text: { he: 'טקסט', en: 'Text' },
  original: { he: 'המקור', en: 'Original' },
  english: { he: 'English', en: 'English' },
  both: { he: 'זה מול זה', en: 'Side by side' },
  whichText: { he: 'איזה טקסט', en: 'Which text' },
  textView: { he: 'תצוגת הטקסט', en: 'Text view' },
  syncMachine: { he: 'סנכרון להקלטה · אוטומטי', en: 'Synced to the recording · automatic' },
  syncChecked: { he: 'מסונכרן להקלטה', en: 'Synced to the recording' },
  playingNow: { he: 'מתנגן כעת', en: 'Playing now' },
  noEnglish: { he: 'לטקסט הזה אין עדיין תרגום לאנגלית.', en: 'This text has no English translation yet.' },
  addTranslation: { he: 'הוספת תרגום', en: 'Add a translation' },
  noText: { he: 'אין עדיין טקסט של ההתוועדות', en: 'No text of this farbrengen yet' },
  noTextHint: { he: 'יש לכם הנחה, או יודעים איפה נדפסה? הוסיפו אותה, והיא תסונכרן להקלטה.', en: 'Have a hanacha, or know where one was printed? Add it and it will be synced to the recording.' },
  addHanacha: { he: 'הוספת הנחה', en: 'Add a hanacha' },
  addRecording: { he: 'הוספת הקלטה', en: 'Add a recording' },
  report: { he: 'דיווח על בעיה', en: 'Report a problem' },
  suggest: { he: 'הצעת תיקון', en: 'Suggest a fix' },
  maamar: { he: 'מאמר', en: 'Maamar' },
  sichos: { he: 'שיחות', en: 'sichos' },
  sicha: { he: 'שיחה', en: 'sicha' },
  recFull: { he: 'הקלטה', en: 'Recorded' },
  recPartial: { he: 'הקלטה חלקית', en: 'Partly recorded' },
  recNone: { he: 'אין הקלטה', en: 'No recording' },
  date: { he: 'תאריך', en: 'Date' },
  civil: { he: 'לועזי', en: 'Civil date' },
  parsha: { he: 'פרשה', en: 'Parsha' },
  place: { he: 'מקום', en: 'Place' },
  length: { he: 'אורך', en: 'Length' },
  id: { he: 'מזהה', en: 'Id' },
  otherYears: { he: 'באותו תאריך בשנים אחרות', en: 'The same date in other years' },
  around: { he: 'לפני ואחרי', en: 'Before and after' },
  previous: { he: 'הקודמת', en: 'Previous' },
  next: { he: 'הבאה', en: 'Next' },
  elsewhere: { he: 'במקומות אחרים', en: 'Elsewhere' },
  videos: { he: 'וידאו', en: 'Video' },
  video: { he: 'וידאו', en: 'Video' },
  atSource: { he: 'במקור', en: 'At the source' },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

const WEEKDAYS_HE = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Shabbos'];

interface EventLink {
  kind: string;
  label: LocalName;
  url: string;
  origin?: string;
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
const kindName = (kind: string, lang: Lang) => t(lang, KIND_KEYS[kind as keyof typeof KIND_KEYS] ?? 'kind_other');

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

/** A video link that opens at the event's moment, where the provider allows it. */
function videoAt(url: string, startMs?: number): string {
  if (!startMs) return url;
  const seconds = Math.floor(startMs / 1000);
  if (/youtube\.com|youtu\.be/.test(url)) return `${url}${url.includes('?') ? '&' : '?'}t=${seconds}`;
  return `${url}#t=${seconds}`;
}

/** `יום רביעי, 17.1.1951`: the day of the week and the civil date. */
function whenLine(date: string | undefined, lang: Lang): string | null {
  if (!date) return null;
  const h = dateKeyToHDate(date);
  const civil = dateKeyToGregorian(date);
  const day = h ? (lang === 'he' ? `יום ${WEEKDAYS_HE[h.getDay()]}` : WEEKDAYS_EN[h.getDay()]!) : null;
  const numeric = civil ? civil.split('-').map(Number).reverse().join('.') : null;
  return [day, numeric].filter(Boolean).join(', ') || null;
}

/** Bar heights for the waveform, the same for a recording every time (the catalog has no peaks for it yet). */
function bars(seed: string, n = 64): number[] {
  let s = [...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 233280, 7);
  return Array.from({ length: n }, (_, i) => {
    s = (s * 9301 + 49297) % 233280;
    const h = 18 + (s / 233280) * 82 * (0.55 + 0.45 * Math.sin(i / 5));
    return Math.max(10, Math.min(100, Math.round(h)));
  });
}

/* ------------------------------------------------------------ the player card */

function ListenCard({ entity, recordings, tracks, lang }: { entity: Entity; recordings: Entity[]; tracks: Track[]; lang: Lang }) {
  const player = usePlayer();
  const at = player.current ? tracks.findIndex((tr) => tr.id === player.current!.id) : -1;
  const mine = at >= 0;
  const index = mine ? at : 0;
  const track = tracks[index]!;
  const durationS = mine && player.duration ? player.duration : (track.durationMs ?? 0) / 1000;
  const timeS = mine ? player.time : 0;
  const progress = durationS ? Math.min(1, timeS / durationS) : 0;
  const heights = useMemo(() => bars(track.id), [track.id]);
  const playing = mine && player.playing;

  const playAt = (i: number, seconds?: number) => (at === i && seconds === undefined ? player.toggle() : player.play(tracks, i, seconds));
  const seekTo = (seconds: number) => {
    const clamped = Math.max(0, durationS ? Math.min(durationS, seconds) : seconds);
    if (mine) player.seek(clamped);
    else player.play(tracks, index, clamped);
  };
  const onWave = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    if (durationS) seekTo(((e.clientX - box.left) / box.width) * durationS);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 5 : e.key === 'ArrowLeft' ? -5 : e.key === 'Home' ? -Infinity : e.key === 'End' ? Infinity : 0;
    if (!step) return;
    e.preventDefault();
    seekTo(step === -Infinity ? 0 : step === Infinity ? durationS : timeS + step);
  };

  // Parts the catalog knows of but has nowhere to be heard: a person who knows where one is says so.
  const missing = recordings.filter((r) => !tracks.some((tr) => tr.id === r.id));
  const videos = recordings.flatMap((r) => (r.data as unknown as { videos?: Array<{ url: string; startMs?: number }> }).videos ?? []);
  const nowLine = `${mine ? w(lang, playing ? 'playing' : 'paused') : w(lang, 'ready')} · ${w(lang, 'partOf').replace('{n}', num(index + 1, lang)).replace('{of}', num(tracks.length + missing.length, lang))}`;

  return (
    <section id="listen" className="listen" aria-label={t(lang, 'recordings')}>
      <div className="listen-top">
        <p className="listen-now">{nowLine}</p>
        <p className="listen-title">{track.title}</p>
        <div
          className="wave"
          role="slider"
          tabIndex={0}
          aria-label={w(lang, 'seek')}
          aria-valuemin={0}
          aria-valuemax={Math.round(durationS)}
          aria-valuenow={Math.round(timeS)}
          aria-valuetext={clock(timeS)}
          onClick={onWave}
          onKeyDown={onKey}
        >
          {heights.map((h, i) => (
            <i key={i} className={i / heights.length < progress ? 'p' : undefined} style={{ height: `${h}%` }} />
          ))}
        </div>
        <div className="listen-times num">
          <span>{clock(timeS)}</span>
          <span>{durationS ? clock(durationS) : '—'}</span>
        </div>
      </div>
      <div className="listen-ctrl">
        <button type="button" className="sk" onClick={() => seekTo(timeS - 15)} aria-label={w(lang, 'back15')}>
          <Icon name="skipb" />
          <span>15</span>
        </button>
        <button type="button" className="pp" onClick={() => playAt(index)} aria-label={playing ? w(lang, 'pause') : w(lang, 'play')}>
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        <button type="button" className="sk" onClick={() => seekTo(timeS + 15)} aria-label={w(lang, 'fwd15')}>
          <Icon name="skipf" />
          <span>15</span>
        </button>
      </div>
      <ol className="part-list">
        {tracks.map((tr, i) => {
          const on = at === i;
          return (
            <li key={tr.id}>
              <button type="button" className={cx('part', on && 'on')} onClick={() => playAt(i)} aria-current={on ? 'true' : undefined}>
                <span className="n num">{on ? <Icon name={player.playing ? 'audio' : 'pause'} size={14} /> : num(i + 1, lang)}</span>
                <span className="part-title">{tr.title}</span>
                <span className="d num">{tr.durationMs ? clock(tr.durationMs / 1000) : ''}</span>
              </button>
            </li>
          );
        })}
        {missing.map((r, i) => (
          <li key={r.id}>
            <span className="part missing">
              <span className="n num">{num(tracks.length + i + 1, lang)}</span>
              <span className="part-title subtle">{labelOf(r, lang)}</span>
              <span className="miss">
                {w(lang, 'noRecording')} · <Link to={href('/add', lang, { what: 'recording', for: entity.id })}>{w(lang, 'knowWhere')}</Link>
              </span>
            </span>
          </li>
        ))}
      </ol>
      {videos.length ? (
        <div className="listen-videos">
          {videos.map((v, i) => (
            <a key={i} className="btn sm" href={videoAt(v.url, v.startMs)} target="_blank" rel="noopener">
              <Icon name="video" />
              {w(lang, 'video')}
              {v.startMs ? ` ${clock(v.startMs / 1000)}` : ''}
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------ what was said */

function Said({ rows, tracks, lang }: { rows: SaidRow[]; tracks: Track[]; lang: Lang }) {
  const player = usePlayer();
  return (
    <section className="ev-sec" aria-labelledby="said-h">
      <h2 id="said-h" className="ev-h">
        {w(lang, 'said')}
      </h2>
      <ul className="box said">
        {rows.map((r) => {
          const i = r.at ? tracks.findIndex((tr) => tr.id === r.at!.recording) : -1;
          return (
            <li key={r.id} className="said-row">
              <Link className="t" to={href(r.path, lang)}>
                {r.label}
              </Link>
              {i >= 0 ? (
                <button type="button" className="tm num" onClick={() => player.play(tracks, i, r.at!.startMs / 1000)} title={w(lang, 'playFrom')} aria-label={`${w(lang, 'playFrom')}: ${r.label}`}>
                  {clock(r.at!.startMs / 1000)}
                </button>
              ) : (
                <span className="tm num subtle">—</span>
              )}
              <span className="s">
                {r.source ? (
                  <span>
                    {r.source}
                    {r.page ? `, ${w(lang, 'page')} ${num(r.page, lang)}` : ''}
                  </span>
                ) : null}
                {r.source && r.status ? <span aria-hidden="true">·</span> : null}
                {r.status ? <span>{w(lang, r.status === 'mugah' ? 'mugah' : 'bilti')}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------ hanachos and printings, as pages */

function Documents({ links, lang, subtitle }: { links: EventLink[]; lang: Lang; subtitle: string }) {
  const [all, setAll] = useState(false);
  const FEW = 4;
  return (
    <section className="ev-sec" aria-labelledby="docs-h">
      <h2 id="docs-h" className="ev-h">
        {w(lang, 'docs')}
        {links.length > FEW ? (
          <button type="button" className="link-btn end" onClick={() => setAll((x) => !x)} aria-expanded={all}>
            {all ? w(lang, 'fewer') : `${w(lang, 'all')} · ${num(links.length, lang)}`}
          </button>
        ) : null}
      </h2>
      <ul className={cx('thumbs', all && 'all')}>
        {links.map((l, i) => (
          <li key={l.url} className="th">
            <Link to={readHref({ url: l.url, title: nameOf(l.label, lang), sub: subtitle }, lang)}>
              <PageThumb seed={i + 1} />
              <span className="c">
                <span className="torah-sm">{nameOf(l.label, lang)}</span>
                <span className="subtle">{kindName(l.kind, lang)}</span>
              </span>
            </Link>
            {l.origin ? (
              <a className="th-origin" href={l.origin} target="_blank" rel="noopener nofollow">
                {w(lang, 'atSource')}
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------ its words */

const within = (nowMs: number, p: { startMs: number | null; endMs: number | null }) => p.startMs !== null && p.endMs !== null && nowMs >= p.startMs && nowMs < p.endMs;

/** Where the audio is, in milliseconds, a few times a second while this farbrengen plays. */
function useNowMs(active: boolean): number {
  const player = usePlayer();
  const [ms, setMs] = useState(player.time * 1000);
  useEffect(() => {
    if (!active || !player.playing) {
      setMs(player.time * 1000);
      return;
    }
    const id = window.setInterval(() => setMs(player.now() * 1000), 250);
    return () => window.clearInterval(id);
  }, [active, player.playing, player.time, player]);
  return ms;
}

type TextMode = 'original' | 'english' | 'both';

function Words({ texts, tracks, entity, lang }: { texts: EventText[]; tracks: Track[]; entity: Entity; lang: Lang }) {
  const player = usePlayer();
  const [params] = useSearchParams();
  const mode: TextMode = params.get('tv') === 'en' ? 'english' : params.get('tv') === 'both' ? 'both' : 'original';
  const chosen = Math.min(Math.max(0, Number(params.get('ti') ?? 0) || 0), texts.length - 1);
  const text = texts[chosen]!;
  const recording = text.sync?.recording ?? null;
  const index = recording ? tracks.findIndex((tr) => tr.id === recording) : -1;
  const hearing = index >= 0 && player.current?.id === recording;
  const nowMs = useNowMs(hearing);
  const here = (extra: Record<string, string | undefined>) => href(itemPath(entity), lang, { tv: params.get('tv') ?? undefined, ti: params.get('ti') ?? undefined, ...extra });
  const english = text.english;
  const shownMode: TextMode = english ? mode : 'original';

  return (
    <section className="ev-sec" id="text" aria-labelledby="text-h">
      <h2 id="text-h" className="ev-h">
        {w(lang, 'text')}
      </h2>
      {texts.length > 1 ? (
        <nav className="chips-row" aria-label={w(lang, 'whichText')}>
          {texts.map((x, i) => (
            <Link key={i} className={cx('chip', i === chosen && 'on')} to={here({ ti: i ? String(i) : undefined })} aria-current={i === chosen ? 'true' : undefined} preventScrollReset replace>
              {x.label}
            </Link>
          ))}
        </nav>
      ) : null}
      <Segmented
        className="text-modes"
        label={w(lang, 'textView')}
        current={shownMode}
        items={[
          { key: 'original', label: w(lang, 'original'), to: here({ tv: undefined }) },
          { key: 'english', label: w(lang, 'english'), to: here({ tv: 'en' }) },
          { key: 'both', label: w(lang, 'both'), to: here({ tv: 'both' }) },
        ]}
      />
      <div className="ev-text">
        <p className="src">
          {text.source ? (
            <span>
              {text.source}
              {text.page ? `, ${w(lang, 'page')} ${num(text.page, lang)}` : ''}
            </span>
          ) : (
            <span>{text.label}</span>
          )}
          {text.sync ? text.sync.checked ? <Label tone="sync">{w(lang, 'syncChecked')}</Label> : <MachineLabel lang={lang}>{w(lang, 'syncMachine')}</MachineLabel> : null}
        </p>
        {mode !== 'original' && !english ? (
          <p className="note subtle">
            {w(lang, 'noEnglish')} <Link to={href(text.unit ? `/${text.unit}` : itemPath(entity), lang, {})}>{w(lang, 'addTranslation')}</Link>
          </p>
        ) : null}
        <ol className={cx('segs', shownMode === 'both' && 'both')}>
          {text.original.map((p, i) => {
            const active = hearing && within(nowMs, p);
            const en = english?.[i];
            const play = p.startMs !== null && index >= 0 ? () => (hearing ? player.seek(p.startMs! / 1000) : player.play(tracks, index, p.startMs! / 1000)) : undefined;
            const he = (
              <p className={cx('he', !p.checked && 'unchecked')} lang="he" dir="rtl">
                {p.content}
              </p>
            );
            const tr = en ? (
              <p className="en" lang="en" dir="ltr">
                {en.content}
              </p>
            ) : null;
            return (
              <li key={p.id} id={`p-${p.id}`} className={cx('seg', active && 'play')}>
                <span className="n num">{num(i + 1, lang)}</span>
                <div className="seg-body" onClick={play} role={play ? 'button' : undefined} tabIndex={play ? 0 : undefined} onKeyDown={play ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), play()) : undefined} title={play ? w(lang, 'playFrom') : undefined}>
                  {shownMode === 'english' ? (tr ?? he) : shownMode === 'both' ? (
                    <>
                      {he}
                      {tr}
                    </>
                  ) : (
                    he
                  )}
                  {active ? (
                    <span className="ts num">
                      {w(lang, 'playingNow')} · {clock(nowMs / 1000)}
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ the page */

export function EventPage({ entity, view, lang }: { entity: Entity; view: ItemView; lang: Lang }) {
  const d = entity.data as unknown as { title: LocalName; date?: string; kind?: string; place?: string; links?: EventLink[] };
  const recordings = view.lists.recordings ?? [];
  const sources = Object.fromEntries(recordings.map((r) => [r.id, view.files[r.id]?.url ?? null]));
  const tracks = tracksOf(entity, recordings, lang, sources);
  const year = d.date ? Number(d.date.slice(0, 4)) : null;
  const monthToken = d.date ? d.date.split('-')[1] : undefined;
  const month = monthToken ? (monthByToken(monthToken) ?? monthByToken(monthToken.toUpperCase())) : undefined;
  const links = d.links ?? [];
  const length = totalLength(recordings, lang);
  const parsha = d.date ? parshaOf(d.date, lang) : null;
  const place = d.place ? view.refs[d.place] : undefined;
  const said = view.event?.said ?? [];
  const texts = view.event?.texts ?? [];
  const previous = view.lists.previous?.[0] as EventItem | undefined;
  const following = view.lists.following?.[0] as EventItem | undefined;
  const name = nameOf(d.title, lang);
  const yearName = year ? yearLabel(year, lang) : '';
  const title = yearName && !name.includes(yearName) ? `${name} ${yearName}` : name;
  const subtitle = [name, d.date ? dateLabel(d.date, lang, { civil: false }) : ''].filter(Boolean).join(' · ');
  const docs = links.filter((l) => readable(l.url));
  const elsewhere = links.filter((l) => !readable(l.url) && !youtubeId(l.url));
  const videos = [...new Set(links.map((l) => youtubeId(l.url)).filter((id): id is string => Boolean(id && /^[\w-]{6,20}$/.test(id))))];

  // What there is of it, as labels: a maamar, how many sichos, and whether it is all recorded.
  const maamarim = said.filter((s) => /מאמר|maamar/i.test(s.label)).length || (links.some((l) => l.kind === 'maamar') ? 1 : 0);
  const sichos = said.length - said.filter((s) => /מאמר|maamar/i.test(s.label)).length;
  const missing = recordings.length - tracks.length;
  const recState = !tracks.length ? 'recNone' : missing > 0 || said.some((s) => !s.at) && texts.some((x) => x.sync) ? 'recPartial' : 'recFull';

  const head: ItemHead = {
    crumbs: [
      { label: w(lang, 'farbrengens'), to: href('/calendar', lang) },
      ...(year ? [{ label: yearName, to: href(`/calendar/${year}`, lang) }] : []),
      ...(year && month ? [{ label: month[lang], to: href(`/calendar/${year}/${month.token}`, lang) }] : []),
      { label: name },
    ],
    kicker: d.kind && d.kind !== 'farbrengen' ? eventKindName(d.kind, lang) : undefined,
    title,
    torah: true,
    sub: [whenLine(d.date, lang), place ? labelOf(place, lang) : null].filter(Boolean).join(' · ') || undefined,
    extra: (
      <div className="labels-row">
        {maamarim ? <Label color="var(--text)">{w(lang, 'maamar')}</Label> : null}
        {sichos > 0 ? (
          <Label color="var(--muted)">
            {num(sichos, lang)} {w(lang, sichos === 1 ? 'sicha' : 'sichos')}
          </Label>
        ) : null}
        <Label tone={recState === 'recNone' ? undefined : 'audio'} color={recState === 'recNone' ? 'var(--faint)' : undefined}>
          {w(lang, recState as 'recFull')}
          {recState !== 'recNone' && length ? ` · ${length}` : ''}
        </Label>
        {parsha ? <Label color="var(--l-date)">{`${t(lang, 'parshas')} ${parsha}`}</Label> : null}
      </div>
    ),
    tabs: [{ key: 'farbrengen', label: t(lang, 'farbrengen'), icon: 'audio', to: href(itemPath(entity), lang) }, ...commonTabs(entity, view, lang)],
    tab: 'farbrengen',
  };

  const side = (
    <>
      <SideDetails
        lang={lang}
        rows={[
          d.date ? [w(lang, 'date'), dateLabel(d.date, lang, { civil: false })] : null,
          d.date && whenLine(d.date, lang) ? [w(lang, 'civil'), whenLine(d.date, lang)] : null,
          parsha ? [w(lang, 'parsha'), parsha] : null,
          place ? [w(lang, 'place'), <Link to={href(itemPath(place), lang)}>{labelOf(place, lang)}</Link>] : null,
          length ? [w(lang, 'length'), length] : null,
          [w(lang, 'id'), <span className="num">{entity.id}</span>],
        ]}
      />
      <SideActivity about={view.about} lang={lang} />
      {previous || following ? (
        <SideSection title={w(lang, 'around')}>
          <div className="side-list neighbors">
            {previous ? (
              <Link to={href(itemPath(previous), lang)}>
                <span className="subtle">{w(lang, 'previous')}</span>
                <span className="grow">{nameOf(eventData(previous).title, lang)}</span>
              </Link>
            ) : null}
            {following ? (
              <Link to={href(itemPath(following), lang)}>
                <span className="subtle">{w(lang, 'next')}</span>
                <span className="grow">{nameOf(eventData(following).title, lang)}</span>
              </Link>
            ) : null}
          </div>
        </SideSection>
      ) : null}
      {view.lists.otherYears?.length ? (
        <SideSection title={w(lang, 'otherYears')}>
          <ul className="year-chips">
            {(view.lists.otherYears as EventItem[]).map((e) => (
              <li key={e.id}>
                <Link className="chip" to={href(itemPath(e), lang)} title={nameOf(eventData(e).title, lang)}>
                  {yearLabel(Number(String(eventData(e).date).slice(0, 4)), lang)}
                  {e.recordings ? <Icon name="audio" size={12} label={t(lang, 'recordings')} /> : null}
                </Link>
              </li>
            ))}
          </ul>
        </SideSection>
      ) : null}
      {elsewhere.length ? (
        <SideSection title={w(lang, 'elsewhere')}>
          <div className="side-list elsewhere">
            {elsewhere.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noopener nofollow">
                <span className="grow">{nameOf(l.label, lang)}</span>
                <span className="subtle">
                  {kindName(l.kind, lang)} · {host(l.url)}
                </span>
              </a>
            ))}
          </div>
        </SideSection>
      ) : null}
    </>
  );

  return (
    <ItemShell head={head} lang={lang} side={side}>
      <div className="event-page">
        {tracks.length ? (
          <ListenCard entity={entity} recordings={recordings} tracks={tracks} lang={lang} />
        ) : (
          <div className="box">
            <EmptyState icon="audio" title={w(lang, 'recNone')} compact actions={<Link className="btn sm" to={href('/add', lang, { what: 'recording', for: entity.id })}>{w(lang, 'addRecording')}</Link>} />
          </div>
        )}
        <SeeAll id={entity.id} group={view.linked.find((g) => g.field === 'event' && g.type === 'recording')} shown={recordings.length} lang={lang} />
        {said.length ? <Said rows={said} tracks={tracks} lang={lang} /> : null}
        <SeeAll id={entity.id} group={view.linked.find((g) => g.field === 'events' && g.type === 'unit')} shown={said.length} lang={lang} />
        {docs.length ? <Documents links={docs} lang={lang} subtitle={subtitle} /> : null}
        {texts.length ? (
          <Words texts={texts} tracks={tracks} entity={entity} lang={lang} />
        ) : (
          <section className="ev-sec">
            <h2 className="ev-h">{w(lang, 'text')}</h2>
            <div className="box">
              <EmptyState
                icon="file"
                title={w(lang, 'noText')}
                compact
                actions={
                  <Link className="btn sm" to={href('/add', lang, { what: 'hanacha', for: entity.id })}>
                    <Icon name="plus" />
                    {w(lang, 'addHanacha')}
                  </Link>
                }
              >
                {w(lang, 'noTextHint')}
              </EmptyState>
            </div>
          </section>
        )}
        <Transcripts tracks={tracks} lang={lang} />
        {videos.length ? (
          <section className="ev-sec">
            <h2 className="ev-h">{w(lang, 'videos')}</h2>
            {videos.map((id) => (
              <div key={id} className="video-embed">
                <iframe src={`https://www.youtube-nocookie.com/embed/${id}`} title="YouTube" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" referrerPolicy="strict-origin-when-cross-origin" />
              </div>
            ))}
          </section>
        ) : null}
        <div className="ev-foot">
          <a className="btn" href="#report">
            <Icon name="report" />
            {w(lang, 'report')}
          </a>
          <a className="btn" href="#suggest">
            <Icon name="suggest" />
            {w(lang, 'suggest')}
          </a>
          <Link className="btn" to={href('/add', lang, { what: 'hanacha', for: entity.id })}>
            <Icon name="plus" />
            {w(lang, 'addHanacha')}
          </Link>
        </div>
      </div>
    </ItemShell>
  );
}
