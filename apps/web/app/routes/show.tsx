import { useEffect, useState } from 'react';
import { data, Form } from 'react-router';
import { hayomYomShiurimOf } from '@rebbehub/hebrew';
import { allSegments, isPageText, type PageText } from '@rebbehub/model';
import { Pause, Play } from 'lucide-react';
import type { Route } from './+types/show';
import type { Entity, Mafteach } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { dateLabel } from '../lib/dates.js';
import { dir, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { labelOf } from '../lib/labels.js';
import { chipLabel, topicLines } from '../lib/mafteach.js';
import { MODEL_FAMILIES, MODELS_LICENCE } from '../lib/models.js';
import { mediaPath, transcriptPath } from '../lib/showcase.js';
import { tracksOf } from '../lib/tracks.js';
import type { Transcript } from '../lib/transcript.js';
import { HayomYomDay } from '../components/HayomYomDay.js';
import { PageWords } from '../components/PageWords.js';
import { ScanBeside } from '../components/ScanBeside.js';
import { Lyrics } from '../components/Transcripts.js';
import { clock, usePlayer, type Track } from '../player/PlayerProvider.js';
import { Logo } from '../ui/Logo.js';
import { MachineLabel } from '../ui/primitives.js';
import '../styles/pages/mafteach.css';
import '../styles/pages/show.css';

/**
 * A showcase, as its guest sees it (lib/showcase.ts): one page, made for
 * the people Shmuly meets, at an address only he gives out. The
 * farbrengens he picked play with their words lit as they are said; the
 * sichos he picked show their scan beside their words; then the rest of
 * what RebbeHub does, each as the site itself does it. Nothing on it leads
 * anywhere else: the rest of RebbeHub is private. What a machine heard or
 * read and nobody checked is marked so, here as everywhere.
 *
 * It opens in English, for the people he meets (`?lang=he` for Hebrew).
 * Each sicha, and each farbrengen he set its written original beside,
 * shows its words, the original, or the two side by side.
 */

const INDEX = '/likkutei-sichos-mafteach-inyanim';
const SEFER = '/likkutei-sichos';
/** A page with our reader's reading beside the typed text shows the reading first: it is what the showcase is for. */
function readerFirst(body: PageText): PageText {
  const read = body.versions.findIndex((v) => v.origin?.by.startsWith('ocr:'));
  return read > 0 ? { ...body, versions: [body.versions[read]!, ...body.versions.filter((_, i) => i !== read)] } : body;
}

/** The scan's page the words start on, where the reading says where it is printed. */
function firstPrinted(body: PageText | null): number {
  let first = Infinity;
  for (const segment of allSegments(body?.versions[0]?.segments)) for (const place of segment.printed ?? []) first = Math.min(first, place.page);
  return Number.isFinite(first) ? first : 1;
}

const todayIn = (timeZone: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { api, showcases } = siteOf(context);
  const showcase = showcases ? await showcases.store.get(params.token) : null;
  if (!showcase) throw data('not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  const { token, extras } = showcase;
  const url = new URL(request.url);
  // In English, for the people Shmuly meets; a Hebrew reader can switch.
  const lang: Lang = url.searchParams.get('lang') === 'he' ? 'he' : 'en';
  const q = url.searchParams.get('q')?.trim().slice(0, 100) ?? '';
  const ids = [...showcase.farbrengens, ...showcase.sichos];
  const [items, recordingsOf, stats, day, mafteach] = await Promise.all([
    api.entities(ids),
    api.linkedOfEach(showcase.farbrengens, { field: 'event', type: 'recording', limit: 80 }),
    extras.numbers ? api.stats().catch(() => null) : null,
    extras.daily ? api.daily(todayIn('America/New_York')).catch(() => null) : null,
    extras.mafteach ? api.mafteach({ index: INDEX, sefer: SEFER, q: q || undefined, letter: q ? undefined : 'א', limit: 6, places: 40 }).catch(() => null) : null,
  ]);
  const works = await api.entities(showcase.sichos.map((id) => String((items.get(id)?.data as { work?: string } | undefined)?.work ?? ''))).catch(() => new Map<string, Entity>());

  const farbrengens = showcase.farbrengens.flatMap((id) => {
    const event = items.get(id);
    if (!event) return [];
    // Only what the showcase lists plays: each part through the showcase's own address.
    const heard = (recordingsOf.get(id) ?? []).filter((r) => showcase.mediaOf[r.id] !== undefined);
    const sources = Object.fromEntries(heard.map((r) => [r.id, mediaPath(token, showcase.mediaOf[r.id]!)]));
    const tracks = tracksOf(event, heard, lang, sources).map((track) => ({ ...track, href: `/show/${token}` }));
    const date = (event.data as { date?: string }).date;
    const original = showcase.originals?.[id];
    return [
      {
        id,
        title: labelOf(event, lang),
        date: date ? dateLabel(date, lang, { civil: false }) : null,
        tracks,
        transcripts: tracks.filter((tr) => showcase.transcripts.includes(tr.id)).map((tr) => tr.id),
        original: original !== undefined ? mediaPath(token, original) : null,
      },
    ];
  });

  const read: PageView[] = (showcase.readings ?? []).map((r, i) => ({
    id: `reading-${i}`,
    title: r.title,
    sub: lang === 'he' ? 'נקרא בקורא שלנו' : 'Read by our model',
    scan: r.media !== null ? mediaPath(token, r.media) : null,
    body: isPageText(r.body) ? r.body : null,
    machine: true,
  }));
  const sichos: PageView[] = showcase.sichos.flatMap((id) => {
    const unit = items.get(id);
    if (!unit) return [];
    const d = unit.data as { work?: string; body?: unknown; machineOrigin?: { checked?: boolean } };
    const work = d.work ? works.get(d.work) : undefined;
    const media = showcase.mediaOf[id];
    const volume = (unit.path ?? '').split('/')[2] ?? null;
    return [
      {
        id,
        title: labelOf(unit, lang),
        sub: [work ? labelOf(work, lang) : null, volume ? (lang === 'he' ? `חלק ${volume}` : `Vol. ${volume}`) : null].filter(Boolean).join(' · '),
        scan: media !== undefined ? mediaPath(token, media) : null,
        body: unit.withheld || !isPageText(d.body) ? null : readerFirst(d.body),
        machine: Boolean(d.machineOrigin && !d.machineOrigin.checked),
      },
    ];
  });

  const hayomYom = (day?.hayomYom ?? []).filter((e) => !e.withheld).map((entry) => ({ title: labelOf(entry, 'he'), body: (entry.data as { body?: unknown }).body, shiurim: hayomYomShiurimOf(entry.data) }));
  return {
    token,
    lang,
    title: showcase.title,
    note: showcase.note,
    extras,
    farbrengens,
    pages: [...read, ...sichos],
    counts: stats?.counts ?? null,
    hayomYom,
    mafteach: mafteach ? { q, topics: mafteach.topics, totals: mafteach.totals } : null,
  };
}

export function headers() {
  // Its address is the key: never kept by a shared cache, never in a search engine, never framed.
  return { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': "frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer' };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: 'RebbeHub' }];
  return [{ title: `${loaderData.title} · RebbeHub` }, { name: 'robots', content: 'noindex, nofollow' }, { name: 'referrer', content: 'no-referrer' }];
}

const W = {
  kicker: { he: 'המפתח הפתוח לתורתו של הרבי', en: "The open index of the Rebbe's Torah" },
  lede: {
    he: 'כל התוועדות, שיחה ומכתב, עם ההקלטות, הסריקות והמילים עצמן. נשמע, נקרא ונבדק, במקום אחד.',
    en: 'Every farbrengen, sicha and letter, with the recordings, the scans and the words themselves: heard, read and checked, in one place.',
  },
  preview: { he: 'תצוגה פרטית', en: 'Private preview' },
  listen: { he: 'לשמוע ולקרוא יחד', en: 'Hear it, read along' },
  listenSub: {
    he: 'המודל שלנו כתב את הדיבור מההקלטה, ואנשים בודקים אותו. המילה הנאמרת מוארת; לחיצה על שורה מנגנת משם.',
    en: 'Our model wrote down every word from the recording, and people check it. The word being said lights up; tap a line to play from there.',
  },
  scans: { he: 'הדף המודפס, נקרא', en: 'The printed page, read' },
  scansSub: {
    he: 'הקורא שלנו קורא את לקוטי שיחות ב-99.9% דיוק באותיות: מירם, אותיות הסעיפים וההערות במקומן. אפשר לראות את הדף המקורי לצדו.',
    en: 'Our reader reads Likkutei Sichos 99.9% right, letter by letter, with the Miram, the numbered pieces and the footnotes in place. Put the original page beside it to compare.',
  },
  noText: { he: 'הטקסט של שיחה זו עדיין נקרא.', en: "This sicha's words are still being read." },
  text: { he: 'הטקסט', en: 'Text' },
  beside: { he: 'לצד המקור', en: 'Side by side' },
  original: { he: 'המקור', en: 'Original' },
  view: { he: 'תצוגה', en: 'View' },
  daily: { he: 'היום יום, כפי שנדפס', en: 'Hayom Yom, as it is printed' },
  dailySub: { he: 'השיעור של היום, מסודר כמו בספר.', en: "Today's entry, set as the book sets it." },
  mafteach: { he: 'מפתח ענינים ללקוטי שיחות', en: 'The Likkutei Sichos subject index' },
  mafteachSub: { he: 'כל המפתחות של כל החלקים יחד, נושא אחד במקום אחד.', en: "Every volume's index joined into one: each topic once, with every page that speaks of it." },
  search: { he: 'חיפוש נושא', en: 'Search a topic' },
  find: { he: 'חיפוש', en: 'Search' },
  none: { he: 'לא נמצא נושא כזה.', en: 'No such topic.' },
  topics: { he: 'נושאים', en: 'topics' },
  places: { he: 'מראי מקומות', en: 'references' },
  models: { he: 'המודלים שלנו', en: 'Our models' },
  modelsSub: { he: 'נבדקו על חומר שהמודלים לא ראו מעולם.', en: 'Each scored on material it never saw in training.' },
  numbers: { he: 'במספרים', en: 'In numbers' },
  errors: { he: 'שגיאות במילים / באותיות: פחות הוא טוב יותר.', en: 'Word / letter errors: lower is better.' },
  loading: { he: 'הדיבור נטען…', en: 'Loading the words…' },
  checked: { he: 'נבדקו בידי אנשים', en: 'checked by people' },
  paragraphs: { he: 'פסקאות', en: 'paragraphs' },
  play: { he: 'לנגן', en: 'Play' },
  pause: { he: 'עצירה', en: 'Pause' },
  other: { he: 'English', en: 'עברית' },
  private: { he: 'תצוגה פרטית. RebbeHub עדיין סגור לציבור.', en: 'A private preview. RebbeHub is not yet open to the public.' },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

const COUNTS: Array<{ type: string; label: { he: string; en: string } }> = [
  { type: 'event', label: { he: 'התוועדויות ואירועים', en: 'farbrengens and events' } },
  { type: 'recording', label: { he: 'הקלטות', en: 'recordings' } },
  { type: 'unit', label: { he: 'שיחות, מאמרים ומכתבים', en: 'sichos, maamarim and letters' } },
  { type: 'work', label: { he: 'ספרים', en: 'sefarim' } },
  { type: 'publication', label: { he: 'הוצאות ודפוסים', en: 'printings' } },
  { type: 'text', label: { he: 'תמלולים', en: 'transcripts' } },
];

type View = 'text' | 'beside' | 'original';

export default function Show({ loaderData }: Route.ComponentProps) {
  const { token, lang, title, note, extras, farbrengens, pages, counts, hayomYom, mafteach } = loaderData;
  const sections: Array<{ id: string; label: string }> = [];
  if (farbrengens.length) sections.push({ id: 'listen', label: w(lang, 'listen') });
  if (pages.length) sections.push({ id: 'scans', label: w(lang, 'scans') });
  if (hayomYom.length) sections.push({ id: 'daily', label: w(lang, 'daily') });
  if (mafteach) sections.push({ id: 'mafteach', label: w(lang, 'mafteach') });
  if (extras.models) sections.push({ id: 'models', label: w(lang, 'models') });
  const shownCounts = counts ? COUNTS.filter((c) => counts[c.type]) : [];
  let n = 0;
  const kicker = () => String(++n).padStart(2, '0');

  return (
    <div className="show" lang={lang} dir={dir(lang)}>
      <div className="show-bar">
        <div className="show-wrap show-bar-in">
          <Logo size={24} />
          <span className="show-pill">{w(lang, 'preview')}</span>
          <nav className="show-bar-nav" aria-label={title}>
            {sections.map((s) => (
              <a key={s.id} href={`#${s.id}`}>
                {s.label}
              </a>
            ))}
          </nav>
          <a className="show-lang" href={`/show/${token}${lang === 'en' ? '?lang=he' : ''}`} lang={lang === 'en' ? 'he' : 'en'}>
            {w(lang, 'other')}
          </a>
        </div>
      </div>

      <header className="show-hero">
        <div className="show-wrap show-hero-in">
          <div className="show-hero-text">
            <p className="show-kicker">{w(lang, 'kicker')}</p>
            <h1 className="show-title">{title}</h1>
            {note ? <p className="show-note">{note}</p> : null}
            <p className="show-lede">{w(lang, 'lede')}</p>
            {sections.length ? (
              <div className="show-cta">
                {sections.slice(0, 2).map((s, i) => (
                  <a key={s.id} href={`#${s.id}`} className={i === 0 ? 'show-btn primary' : 'show-btn'}>
                    {s.label}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
          {shownCounts.length ? (
            <dl className="show-stats" aria-label={w(lang, 'numbers')}>
              {shownCounts.map((c) => (
                <div key={c.type} className="show-stat">
                  <dd>{num(counts![c.type]!, lang)}</dd>
                  <dt>{c.label[lang]}</dt>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      </header>

      {farbrengens.length ? (
        <Section id="listen" n={kicker()} title={w(lang, 'listen')} sub={w(lang, 'listenSub')}>
          <Listen token={token} farbrengens={farbrengens} lang={lang} />
        </Section>
      ) : null}

      {pages.length ? (
        <Section id="scans" n={kicker()} title={w(lang, 'scans')} sub={w(lang, 'scansSub')}>
          {pages.map((p) => (
            <PageCard key={p.id} page={p} lang={lang} />
          ))}
        </Section>
      ) : null}

      {hayomYom.length ? (
        <Section id="daily" n={kicker()} title={w(lang, 'daily')} sub={w(lang, 'dailySub')} narrow>
          <div className="show-paper">
            {hayomYom.map((h, i) => (
              <HayomYomDay key={i} title={h.title} body={h.body} shiurim={h.shiurim} lang={lang} />
            ))}
          </div>
        </Section>
      ) : null}

      {mafteach ? (
        <Section id="mafteach" n={kicker()} title={w(lang, 'mafteach')} sub={`${w(lang, 'mafteachSub')} ${num(mafteach.totals.topics, lang)} ${w(lang, 'topics')} · ${num(mafteach.totals.places, lang)} ${w(lang, 'places')}`}>
          <Form method="get" className="show-search" preventScrollReset>
            {lang === 'he' ? <input type="hidden" name="lang" value="he" /> : null}
            <input type="search" name="q" defaultValue={mafteach.q} placeholder={w(lang, 'search')} aria-label={w(lang, 'search')} dir="auto" />
            <button type="submit" className="show-btn primary">
              {w(lang, 'find')}
            </button>
          </Form>
          {mafteach.topics.length ? <Topics topics={mafteach.topics} lang={lang} /> : <p className="show-sub">{w(lang, 'none')}</p>}
        </Section>
      ) : null}

      {extras.models ? (
        <Section id="models" n={kicker()} title={w(lang, 'models')} sub={w(lang, 'modelsSub')}>
          <Models lang={lang} />
        </Section>
      ) : null}

      <footer className="show-foot">
        <div className="show-wrap">
          <Logo size={20} />
          <p>{w(lang, 'private')}</p>
        </div>
      </footer>
    </div>
  );
}

function Section({ id, n, title, sub, narrow, children }: { id: string; n: string; title: string; sub: string; narrow?: boolean; children: React.ReactNode }) {
  return (
    <section id={id} className="show-section">
      <div className={narrow ? 'show-wrap show-narrow' : 'show-wrap'}>
        <p className="show-num">{n}</p>
        <h2 className="show-h">{title}</h2>
        <p className="show-sub">{sub}</p>
        {children}
      </div>
    </section>
  );
}

/** Text, the two side by side, or the original alone. */
function Views({ view, set, lang, label }: { view: View; set: (v: View) => void; lang: Lang; label: string }) {
  return (
    <div className="show-seg" role="radiogroup" aria-label={`${w(lang, 'view')}: ${label}`}>
      {(['text', 'beside', 'original'] as const).map((v) => (
        <button key={v} type="button" role="radio" aria-checked={view === v} className={view === v ? 'on' : undefined} onClick={() => set(v)}>
          {w(lang, v)}
        </button>
      ))}
    </div>
  );
}

type Farbrengen = { id: string; title: string; date: string | null; tracks: Track[]; transcripts: string[]; original: string | null };

/** The farbrengens, one open at a time: its words as lyrics where it has a transcript, else its parts to play. */
function Listen({ token, farbrengens, lang }: { token: string; farbrengens: Farbrengen[]; lang: Lang }) {
  const [open, setOpen] = useState(farbrengens[0]!.id);
  const shown = farbrengens.find((f) => f.id === open) ?? farbrengens[0]!;
  return (
    <div className="show-listen">
      {farbrengens.length > 1 ? (
        <div className="show-picks" role="tablist">
          {farbrengens.map((f) => (
            <button key={f.id} type="button" role="tab" aria-selected={f.id === shown.id} className={f.id === shown.id ? 'show-pick on' : 'show-pick'} onClick={() => setOpen(f.id)}>
              <span className="show-pick-t">{f.title}</span>
              {f.date ? <span className="show-pick-d">{f.date}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      <Heard key={shown.id} token={token} farbrengen={shown} lang={lang} />
    </div>
  );
}

function Heard({ token, farbrengen, lang }: { token: string; farbrengen: Farbrengen; lang: Lang }) {
  const [transcripts, setTranscripts] = useState<Transcript[] | null>(farbrengen.transcripts.length ? null : []);
  const [view, setView] = useState<View>('text');
  const [page, setPage] = useState(1);
  const nowMs = useNow(farbrengen.tracks);
  useEffect(() => {
    if (!farbrengen.transcripts.length) return;
    let live = true;
    void Promise.all(
      farbrengen.transcripts.map((id) =>
        fetch(transcriptPath(token, id), { headers: { accept: 'application/json' } })
          .then((r) => (r.ok ? (r.json() as Promise<Transcript>) : null))
          .catch(() => null),
      ),
    ).then((all) => live && setTranscripts(all.filter((x): x is Transcript => x !== null && x.paragraphs.length > 0)));
    return () => {
      live = false;
    };
  }, [token, farbrengen.transcripts]);

  const head = (
    <div className="show-card-head">
      <div>
        <h3 className="show-card-t">{farbrengen.title}</h3>
        {farbrengen.date ? <p className="show-card-d">{farbrengen.date}</p> : null}
      </div>
      {farbrengen.original && transcripts?.length ? <Views view={view} set={setView} lang={lang} label={farbrengen.title} /> : null}
    </div>
  );
  if (transcripts === null)
    return (
      <div className="show-card">
        {head}
        <p className="show-sub">{w(lang, 'loading')}</p>
      </div>
    );
  if (!transcripts.length)
    return (
      <div className="show-card">
        {head}
        <Parts tracks={farbrengen.tracks} lang={lang} />
      </div>
    );
  const paragraphs = transcripts.flatMap((tr) => tr.paragraphs);
  const checked = paragraphs.filter((p) => p.checked).length;
  const machine = checked < paragraphs.length || paragraphs.some((p) => p.syncChecked === false);
  // What plays is the parts with words, one after another.
  const tracks = farbrengen.tracks.filter((tr) => transcripts.some((x) => x.recording === tr.id));
  const shownView = farbrengen.original ? view : 'text';
  return (
    <div className="show-card show-card-flush">
      {head}
      <div className={`show-pair show-pair-${shownView}`}>
        {shownView !== 'original' ? (
          <div className="show-lyrics">
            <Lyrics transcripts={transcripts} tracks={tracks} lang={lang} nowMs={nowMs} found={null} machine={machine} signedIn={false} />
          </div>
        ) : null}
        {farbrengen.original && shownView !== 'text' ? (
          <div className="show-scan">
            <ScanBeside file={farbrengen.original} src="" title={farbrengen.title} page={page} lang={lang} onPage={(p) => setPage(Math.max(1, p))} />
          </div>
        ) : null}
      </div>
      <p className="show-meta">
        {machine ? <MachineLabel lang={lang} size="sm" /> : null}
        <span>
          {num(paragraphs.length, lang)} {w(lang, 'paragraphs')}
          {checked ? ` · ${num(checked, lang)} ${w(lang, 'checked')}` : ''}
        </span>
      </p>
    </div>
  );
}

/** Where the audio is, in milliseconds, many times a second while one of these parts plays (Transcripts.tsx does the same). */
function useNow(tracks: Track[]): number {
  const player = usePlayer();
  const playing = tracks.some((tr) => tr.id === player.current?.id) && player.playing;
  const [ms, setMs] = useState(player.time * 1000);
  useEffect(() => {
    if (!playing) {
      setMs(player.time * 1000);
      return;
    }
    let frame = 0;
    let last = 0;
    const tick = (at: number) => {
      if (at - last > 80) {
        last = at;
        setMs(player.now() * 1000);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, player.time, player]);
  return ms;
}

/** A farbrengen with no words yet: its parts, each to play. */
function Parts({ tracks, lang }: { tracks: Track[]; lang: Lang }) {
  const player = usePlayer();
  return (
    <ol className="show-parts">
      {tracks.map((track, i) => {
        const active = player.current?.id === track.id;
        return (
          <li key={track.id}>
            <button type="button" className="btn" onClick={() => (active ? player.toggle() : player.play(tracks, i))} aria-label={`${w(lang, active && player.playing ? 'pause' : 'play')}: ${track.title}`}>
              {active && player.playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
            </button>
            <span>{track.title}</span>
            {track.durationMs ? <span className="show-meta">{clock(track.durationMs / 1000)}</span> : null}
            {active ? <span className="show-meta">{clock(player.time)}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

type PageView = { id: string; title: string; sub: string; scan: string | null; body: PageText | null; machine: boolean };

/** A sicha: its words, and its scan beside them or alone. */
function PageCard({ page: p, lang }: { page: PageView; lang: Lang }) {
  const [view, setView] = useState<View>('text');
  const [page, setPage] = useState(() => firstPrinted(p.body));
  const shown: View = !p.scan ? 'text' : !p.body ? 'original' : view;
  return (
    <article className="show-card">
      <div className="show-card-head">
        <div>
          <h3 className="show-card-t" dir="auto">
            {p.title}
          </h3>
          <p className="show-card-d">
            {p.sub}
            {p.machine ? <MachineLabel lang={lang} size="sm" /> : null}
          </p>
        </div>
        {p.scan && p.body ? <Views view={view} set={setView} lang={lang} label={p.title} /> : null}
      </div>
      <div className={`show-pair show-pair-${shown}`}>
        {shown !== 'original' ? (
          p.body ? (
            <div className="show-words torah">
              <PageWords page={p.body} lang={lang} />
            </div>
          ) : (
            <p className="show-sub">{w(lang, 'noText')}</p>
          )
        ) : null}
        {p.scan && shown !== 'text' ? (
          <div className="show-scan">
            <ScanBeside file={p.scan} src="" title={p.title} page={page} lang={lang} onPage={(n) => setPage(Math.max(1, n))} />
          </div>
        ) : null}
      </div>
    </article>
  );
}

function Topics({ topics, lang }: { topics: Mafteach['topics']; lang: Lang }) {
  return (
    <div className="show-topics">
      {topics.map((topic) => (
        <article className="mf-topic" key={topic.topic}>
          <h3 className="mf-topic-name">{topic.topic}</h3>
          {topicLines(topic).map((line) => (
            <div className="mf-line" key={line.context || '-'}>
              {line.context ? <span className="mf-context">{line.context}</span> : null}
              {line.refs.map((r) => (
                <span key={r.key} className={r.machine ? 'mf-chip mach' : 'mf-chip'} title={r.place.sicha}>
                  {chipLabel(r.volume, r.place, lang)}
                </span>
              ))}
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}

/** Each model in use, with its headline scores (lib/models.ts, the /models page's own numbers). */
function Models({ lang }: { lang: Lang }) {
  return (
    <div className="show-models">
      {MODEL_FAMILIES.map((family) => {
        const table = family.tables.find((t) => t.rows.some((r) => r.state === 'inUse'));
        const row = table?.rows.find((r) => r.state === 'inUse');
        if (!table || !row) return null;
        const cell = (c: string | { he: string; en: string }) => (typeof c === 'string' ? c : c[lang]);
        return (
          <div key={family.id} className="show-model">
            <h3 className="show-model-t">{family.title[lang]}</h3>
            <p className="show-model-n">{typeof row.name === 'string' ? row.name : row.name[lang]}</p>
            <dl className="show-model-s">
              {row.cells.map((c, i) => (
                <div key={i}>
                  <dt>{table.columns[i + 1]?.[lang]}</dt>
                  <dd>{cell(c)}</dd>
                </div>
              ))}
            </dl>
            {family.id === 'whisper' ? <p className="show-model-test">{w(lang, 'errors')}</p> : null}
            <p className="show-model-test">{table.test[lang]}</p>
          </div>
        );
      })}
      <p className="show-meta">{MODELS_LICENCE[lang]}</p>
    </div>
  );
}
