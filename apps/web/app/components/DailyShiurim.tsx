import { useEffect, useState } from 'react';
import type { DailyLearning } from '../lib/api.js';
import type { Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';
import { joinRefs, sefariaUrl } from '../lib/sefaria.js';
import { labelOf } from '../lib/labels.js';
import { Icon } from '../ui/Icon.js';

/**
 * The day's shiurim at a glance, as design/ draws the daily page (3e):
 * Chumash with Rashi, Tehillim, Tanya, the Rambam on the track the reader
 * follows (three chapters, one chapter or Sefer HaMitzvos, chosen under it
 * and kept in this browser) and Hayom Yom, each a row going to its words,
 * with a circle to tick once it is learned and the first not yet learned
 * marked as next. The ticks stay in this browser only; a bar counts them,
 * and the days in a row on which everything was learned. Tanya and Hayom
 * Yom go to their words on this page; the others to their pages on
 * RebbeHub once the catalog has them (the Sefaria import's Chitas and
 * Rambam), to Sefaria until then.
 */

const W = {
  title: { he: 'השיעורים של היום', en: 'Today’s shiurim' },
  chumash: { he: 'חומש', en: 'Chumash' },
  tehillim: { he: 'תהלים', en: 'Tehillim' },
  tanya: { he: 'תניא', en: 'Tanya' },
  three: { he: 'רמב״ם, ג׳ פרקים', en: 'Rambam, three chapters' },
  one: { he: 'רמב״ם, פרק אחד', en: 'Rambam, one chapter' },
  mitzvos: { he: 'ספר המצוות', en: 'Sefer HaMitzvos' },
  rambam: { he: 'רמב״ם', en: 'Rambam' },
  hayomYom: { he: 'היום יום', en: 'Hayom Yom' },
  next: { he: 'הבא בתור', en: 'Next' },
  track: { he: 'מסלול הרמב״ם', en: 'Rambam track' },
  trackThree: { he: 'ג׳ פרקים', en: '3 chapters' },
  trackOne: { he: 'פרק אחד', en: '1 chapter' },
  learned: { he: 'למדתי', en: 'Learned' },
  done: { he: 'מתוך', en: 'of' },
  streak: { he: 'ימים ברציפות', en: 'days in a row' },
  kept: { he: 'נשמר בדפדפן זה בלבד', en: 'Kept in this browser only' },
} as const;

export interface ShiurRow {
  key: string;
  name: string;
  /** Each piece of the shiur: its words, and where it is learned. */
  pieces: Array<{ text: string; to: string | null; external: boolean }>;
}

const STORE = 'rebbehub:daily-learned';
type Store = Record<string, string[]>;
const read = (): Store => {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? '{}') as Store;
  } catch {
    return {};
  }
};
const write = (store: Store) => {
  try {
    localStorage.setItem(STORE, JSON.stringify(store));
  } catch {
    // Private windows and full storage: the ticks just do not stay.
  }
};
const dayBefore = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! - 1)).toISOString().slice(0, 10);
};

/** Days in a row, ending at `date` (or the day before, while today is not done), on which every shiur of the day was ticked. */
function streak(store: Store, date: string, keys: string[]): number {
  if (!keys.length) return 0;
  const full = (d: string) => keys.every((k) => store[d]?.includes(k));
  let day = full(date) ? date : dayBefore(date);
  let n = 0;
  while (full(day)) {
    n++;
    day = dayBefore(day);
  }
  return n;
}

/**
 * The day's shiurim as rows, each with where it is learned. Tanya is
 * learned on the daily page (`tanya`, its words' place there); `rambam`
 * says which of the Rambam's tracks to list.
 */
export function shiurRows(day: DailyLearning, lang: Lang, { tanya = '#daily-tanya', rambam: tracks = ['three', 'one', 'mitzvos'], hayomYom }: { tanya?: string; rambam?: Array<'three' | 'one' | 'mitzvos'>; hayomYom?: string } = {}): ShiurRow[] {
  const t = (key: keyof typeof W) => W[key][lang];
  const rows: ShiurRow[] = [];
  // On RebbeHub once the catalog has the words, else on Sefaria.
  const place = (path: string | null | undefined, ref: string | null, rashi = false) => (path ? { to: href(path, lang), external: false } : { to: ref ? sefariaUrl(ref, { rashi }) : null, external: true });
  if (day.chumash) {
    const rashi = day.chumash.rashi ? [{ text: 'רש״י', to: href(day.chumash.rashi, lang), external: false }] : [];
    rows.push({ key: 'chumash', name: t('chumash'), pieces: [{ text: day.chumash.label, ...place(day.chumash.path, day.chumash.ref, true) }, ...rashi] });
  }
  if (day.tehillim?.length) rows.push({ key: 'tehillim', name: t('tehillim'), pieces: day.tehillim.map((p) => ({ text: p.text.replace(/\.$/, ''), ...place(p.path, p.ref) })) });
  if (day.tanya.length) rows.push({ key: 'tanya', name: t('tanya'), pieces: [{ text: day.tanya.map((p) => labelOf(p, 'he')).join(' – '), to: tanya, external: false }] });
  const rambam = day.rambam;
  if (rambam) {
    const shiur = (key: 'three' | 'one' | 'mitzvos') => {
      const s = rambam[key];
      if (!s) return;
      const ref = key === 'mitzvos' ? (s.refs[0] ?? null) : joinRefs(s.refs);
      rows.push({ key, name: t(key), pieces: [{ text: s.label, ...place(s.paths?.[0], ref) }] });
    };
    for (const track of tracks) shiur(track);
  }
  if (hayomYom && day.hayomYom.length) rows.push({ key: 'hayom-yom', name: t('hayomYom'), pieces: [{ text: day.hayomYom.map((e) => labelOf(e, 'he')).join(' – '), to: hayomYom, external: false }] });
  return rows;
}

/**
 * Which of a day's shiurim are ticked as learned, kept in this browser
 * (the daily page and the home page share them), and how many days in a
 * row everything in `rows` was.
 */
export function useLearned(date: string, rows: ShiurRow[]) {
  const [store, setStore] = useState<Store>({});
  useEffect(() => setStore(read()), []);
  const ticked = new Set(store[date] ?? []);
  const toggle = (key: string) => {
    const next = read();
    const set = new Set(next[date] ?? []);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    next[date] = [...set];
    write(next);
    setStore(next);
  };
  return { ticked, toggle, inARow: streak(store, date, rows.map((r) => r.key)) };
}

type Track = 'three' | 'one' | 'mitzvos';
const TRACKS: Track[] = ['three', 'one', 'mitzvos'];
const TRACK_STORE = 'rebbehub:rambam-track';

/** The Rambam track this reader follows, kept in this browser (three chapters until they choose). */
function useTrack(): [Track, (t: Track) => void] {
  const [track, setTrack] = useState<Track>('three');
  useEffect(() => {
    try {
      const kept = localStorage.getItem(TRACK_STORE) as Track | null;
      if (kept && TRACKS.includes(kept)) setTrack(kept);
    } catch {
      // No storage: three chapters.
    }
  }, []);
  const choose = (t: Track) => {
    setTrack(t);
    try {
      localStorage.setItem(TRACK_STORE, t);
    } catch {
      // Private windows: the choice holds for this visit.
    }
  };
  return [track, choose];
}

export function DailyShiurim({ day, lang }: { day: DailyLearning; lang: Lang }) {
  const t = (key: keyof typeof W) => W[key][lang];
  const [track, setTrack] = useTrack();
  const rows = shiurRows(day, lang, { rambam: [track], hayomYom: '#daily-hayom-yom' });
  const { ticked, toggle, inARow } = useLearned(day.date, rows);
  if (!rows.length) return null;
  const count = rows.filter((r) => ticked.has(r.key)).length;
  const next = rows.find((r) => !ticked.has(r.key))?.key;
  const trackName: Record<Track, string> = { three: t('trackThree'), one: t('trackOne'), mitzvos: t('mitzvos') };

  return (
    <section className="dl-shiurim" aria-label={t('title')}>
      <div className="dl-progress" title={t('kept')}>
        <span className="dl-bar" aria-hidden="true">
          <span style={{ width: `${(count / rows.length) * 100}%` }} />
        </span>
        <span className="dl-count">
          {count} {t('done')} {rows.length}
          {inARow > 1 ? ` · ${inARow} ${t('streak')}` : null}
        </span>
      </div>
      <ul className="dl-list">
        {rows.map((row) => {
          const done = ticked.has(row.key);
          const [first, ...rest] = row.pieces;
          const rambam = TRACKS.includes(row.key as Track);
          return (
            <li key={rambam ? 'rambam' : row.key} className={`dl-row${done ? ' done' : ''}${row.key === next ? ' next' : ''}`}>
              <button type="button" className="dl-tick" aria-pressed={done} aria-label={`${t('learned')}: ${row.name}`} onClick={() => toggle(row.key)}>
                {done ? <Icon name="check" size={15} /> : null}
              </button>
              <span className="dl-what">
                <span className="dl-name">
                  {rambam ? `${t('rambam')} · ${trackName[row.key as Track]}` : row.name}
                  {row.key === next ? ` · ${t('next')}` : null}
                </span>
                <span className="dl-text torah" lang="he" dir="rtl">
                  {first?.to ? (
                    <a className="dl-main" href={first.to} target={first.external ? '_blank' : undefined} rel={first.external ? 'noopener' : undefined}>
                      {first.text}
                    </a>
                  ) : (
                    first?.text
                  )}
                  {rest.map((piece, i) => (
                    <span key={i}>
                      {' · '}
                      {piece.to ? (
                        <a className="dl-more" href={piece.to} target={piece.external ? '_blank' : undefined} rel={piece.external ? 'noopener' : undefined}>
                          {piece.text}
                        </a>
                      ) : (
                        piece.text
                      )}
                    </span>
                  ))}
                </span>
                {rambam ? (
                  <span className="dl-tracks" role="group" aria-label={t('track')}>
                    {TRACKS.filter((k) => day.rambam?.[k]).map((k) => (
                      <button key={k} type="button" aria-pressed={k === track} onClick={() => setTrack(k)}>
                        {trackName[k]}
                      </button>
                    ))}
                  </span>
                ) : null}
              </span>
              <Icon name="chev" className="dl-chev flip-ltr" size={16} />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
