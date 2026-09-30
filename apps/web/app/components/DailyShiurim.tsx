import { useEffect, useState } from 'react';
import type { DailyLearning } from '../lib/api.js';
import type { Lang } from '../lib/i18n.js';
import { joinRefs, sefariaUrl } from '../lib/sefaria.js';
import { labelOf } from '../lib/labels.js';

/**
 * The day's shiurim at a glance, Chitas and the Rambam, each a link to its
 * words: Chumash with Rashi, Tehillim, Tanya, then the Rambam's three
 * tracks (three chapters, one chapter, Sefer HaMitzvos). Each has a box to
 * tick once it is learned; the ticks stay in this browser only, and the
 * card counts the days in a row on which everything ticked was learned.
 * Tanya goes to its words on this page; the others to Sefaria until
 * RebbeHub has their words.
 */

const W = {
  title: { he: 'השיעורים של היום', en: 'Today’s shiurim' },
  chumash: { he: 'חומש', en: 'Chumash' },
  tehillim: { he: 'תהלים', en: 'Tehillim' },
  tanya: { he: 'תניא', en: 'Tanya' },
  three: { he: 'רמב״ם, ג׳ פרקים', en: 'Rambam, three chapters' },
  one: { he: 'רמב״ם, פרק אחד', en: 'Rambam, one chapter' },
  mitzvos: { he: 'ספר המצוות', en: 'Sefer HaMitzvos' },
  learned: { he: 'למדתי', en: 'Learned' },
  done: { he: 'מתוך', en: 'of' },
  streak: { he: 'ימים ברציפות', en: 'days in a row' },
  kept: { he: 'נשמר בדפדפן זה בלבד', en: 'Kept in this browser only' },
} as const;

interface Row {
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
function streak(store: Store, date: string, total: number): number {
  const full = (d: string) => (store[d]?.length ?? 0) >= total;
  let day = full(date) ? date : dayBefore(date);
  let n = 0;
  while (full(day)) {
    n++;
    day = dayBefore(day);
  }
  return n;
}

export function DailyShiurim({ day, lang }: { day: DailyLearning; lang: Lang }) {
  const t = (key: keyof typeof W) => W[key][lang];
  const rows: Row[] = [];
  if (day.chumash) rows.push({ key: 'chumash', name: t('chumash'), pieces: [{ text: day.chumash.label, to: sefariaUrl(day.chumash.ref, { rashi: true }), external: true }] });
  if (day.tehillim?.length) rows.push({ key: 'tehillim', name: t('tehillim'), pieces: day.tehillim.map((p) => ({ text: p.text.replace(/\.$/, ''), to: p.ref ? sefariaUrl(p.ref) : null, external: true })) });
  if (day.tanya.length) rows.push({ key: 'tanya', name: t('tanya'), pieces: [{ text: day.tanya.map((p) => labelOf(p, 'he')).join(' – '), to: '#daily-tanya', external: false }] });
  const rambam = day.rambam;
  if (rambam) {
    const shiur = (key: 'three' | 'one' | 'mitzvos') => {
      const s = rambam[key];
      if (!s) return;
      const ref = key === 'mitzvos' ? (s.refs[0] ?? null) : joinRefs(s.refs);
      rows.push({ key, name: t(key), pieces: [{ text: s.label, to: ref ? sefariaUrl(ref) : null, external: true }] });
    };
    shiur('three');
    shiur('one');
    shiur('mitzvos');
  }

  const [store, setStore] = useState<Store>({});
  useEffect(() => setStore(read()), []);
  const ticked = new Set(store[day.date] ?? []);
  const toggle = (key: string) => {
    const next = read();
    const set = new Set(next[day.date] ?? []);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    next[day.date] = [...set].filter((k) => rows.some((r) => r.key === k));
    write(next);
    setStore(next);
  };
  if (!rows.length) return null;
  const count = rows.filter((r) => ticked.has(r.key)).length;
  const inARow = streak(store, day.date, rows.length);

  return (
    <section className="daily-shiurim" aria-labelledby="daily-shiurim">
      <header className="daily-shiurim-head">
        <h2 className="h-sec" id="daily-shiurim">
          {t('title')}
        </h2>
        <span className="daily-shiurim-count" title={t('kept')}>
          {count} {t('done')} {rows.length}
          {inARow > 1 ? ` · ${inARow} ${t('streak')}` : null}
        </span>
      </header>
      <ul className="daily-shiurim-list">
        {rows.map((row) => (
          <li key={row.key} className={ticked.has(row.key) ? 'done' : undefined}>
            <label className="daily-shiur-tick">
              <input type="checkbox" checked={ticked.has(row.key)} onChange={() => toggle(row.key)} aria-label={`${t('learned')}: ${row.name}`} />
            </label>
            <span className="daily-shiur-name">{row.name}</span>
            <span className="daily-shiur-what torah" lang="he" dir="rtl">
              {row.pieces.map((piece, i) => (
                <span key={i}>
                  {i ? ' · ' : null}
                  {piece.to === null ? (
                    piece.text
                  ) : piece.external ? (
                    <a href={piece.to} target="_blank" rel="noopener">
                      {piece.text}
                    </a>
                  ) : (
                    <a href={piece.to}>{piece.text}</a>
                  )}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
