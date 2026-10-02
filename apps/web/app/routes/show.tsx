import { useEffect, useMemo, useState } from 'react';
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
import { noteLabels, printPagesOf } from '../lib/printLines.js';
import { fontPath, mediaPath, transcriptPath } from '../lib/showcase.js';
import { tracksOf } from '../lib/tracks.js';
import type { Transcript } from '../lib/transcript.js';
import { Benchmarks } from '../components/Benchmarks.js';
import { HayomYomDay } from '../components/HayomYomDay.js';
import { PageWords } from '../components/PageWords.js';
import { frameOf, PrintPage } from '../components/PrintPage.js';
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
 * It is an information page about the agents that build RebbeHub
 * (Shmuly: "not a landing page, an information page"): plain text and a
 * table of what each agent does and how it scores, then examples of each
 * at work, the original beside what the agent made. It opens in English,
 * for the people he meets (`?lang=he` for Hebrew).
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
  const [items, recordingsOf, stats, day, mafteach, frank, miram] = await Promise.all([
    api.entities(ids),
    api.linkedOfEach(showcase.farbrengens, { field: 'event', type: 'recording', limit: 80 }),
    api.stats().catch(() => null),
    extras.daily ? api.daily(todayIn('America/New_York')).catch(() => null) : null,
    extras.mafteach ? api.mafteach({ index: INDEX, sefer: SEFER, q: q || undefined, letter: q ? undefined : 'א', limit: 6, places: 40 }).catch(() => null) : null,
    showcases!.store.hasFont('frank').catch(() => false),
    showcases!.store.hasFont('miram').catch(() => false),
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
    head: 'לקוטי שיחות',
    heTitle: r.title,
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
        head: (unit.path ?? '').startsWith(SEFER + '/') ? 'לקוטי שיחות' : work ? labelOf(work, 'he') : '',
        heTitle: labelOf(unit, 'he'),
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
    fonts: { frank, miram },
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
  lede: {
    he: 'RebbeHub הוא מפתח פתוח של תורת חב"ד ושל ההקלטות, שנבנה בידי סוכני AI ונבדק בידי אנשים. הסוכנים קוראים את הסריקות, שומעים את ההקלטות, מתזמנים כל מילה, מאחדים את המפתחות ומסדרים את הקטלוג. בדף הזה: מה כל סוכן עושה, איך הוא נבחן, ודוגמאות מעבודתו.',
    en: "RebbeHub is an open index of Chabad Torah and recordings, built by AI agents and checked by people. The agents read the scans, transcribe the recordings, time every word, join the indexes and file the catalog. This page lists what each agent does, how it scores, and examples of its work.",
  },
  preview: { he: 'תצוגה פרטית. RebbeHub עדיין סגור לציבור.', en: 'Private preview. RebbeHub is not yet open to the public.' },
  roster: { he: 'הסוכנים', en: 'The agents' },
  rosterSub: { he: 'הציונים נמדדו על חומר שהמודל לא ראה באימון.', en: 'Scores are measured on material the model never saw in training.' },
  agent: { he: 'סוכן', en: 'Agent' },
  does: { he: 'מה הוא עושה', en: 'What it does' },
  model: { he: 'מודל', en: 'Model' },
  score: { he: 'ציון', en: 'Score' },
  made: { he: 'עד כה', en: 'Done so far' },
  contents: { he: 'בדף', en: 'On this page' },
  bench: { he: 'מדדים', en: 'Benchmarks' },
  benchSub: { he: 'כל מספר נמדד על חומר שהמודל לא למד ממנו.', en: 'Every number is measured on material the model never learned from.' },
  listen: { he: 'תמלול ותזמון', en: 'Transcription and timing' },
  listenSub: {
    he: 'השומע כותב את ההקלטה, והמתזמן קובע את הרגע של כל מילה. נגנו, והמילה הנאמרת מוארת; לחיצה על שורה מנגנת משם.',
    en: 'The listener writes down the recording and the timer finds the moment each word is said. Press play and the word being said is highlighted; tap a line to play from there.',
  },
  scans: { he: 'קריאת סריקות (OCR)', en: 'Reading scans (OCR)' },
  scansSub: {
    he: 'הקורא הופך סריקה לטקסט, עם המירם, אותיות הסעיפים וההערות במקומן. הדף המקורי והטקסט שנקרא, זה לצד זה.',
    en: 'The reader turns a scan into text, with the Miram, the numbered pieces and the footnotes in place. The original page and the text it read, side by side.',
  },
  noText: { he: 'הסוכן עדיין קורא את השיחה הזו.', en: 'The reader is still on this sicha.' },
  text: { he: 'טקסט', en: 'Text' },
  beside: { he: 'זה לצד זה', en: 'Side by side' },
  original: { he: 'מקור', en: 'Original' },
  view: { he: 'תצוגה', en: 'View' },
  daily: { he: 'עימוד', en: 'Page layout' },
  dailySub: { he: 'השורות שנקראו מהסריקה של היום יום, מסודרות כפי שנדפסו. השיעור של היום.', en: "Lines read from the Hayom Yom scan, set as the book prints them. Today's entry." },
  mafteach: { he: 'מפתח מאוחד', en: 'One joined index' },
  mafteachSub: { he: 'כל מפתחות לקוטי שיחות, מכל החלקים, אוחדו לאחד: כל נושא פעם אחת, עם כל מקום שמדבר בו.', en: "Every Likkutei Sichos volume's index, joined into one: each topic once, with every page that speaks of it." },
  search: { he: 'חיפוש נושא', en: 'Search a topic' },
  find: { he: 'חיפוש', en: 'Search' },
  none: { he: 'לא נמצא נושא כזה.', en: 'No such topic.' },
  topics: { he: 'נושאים', en: 'topics' },
  places: { he: 'מראי מקומות', en: 'references' },
  loading: { he: 'הדיבור נטען…', en: 'Loading the words…' },
  checked: { he: 'נבדקו בידי אנשים', en: 'checked by people' },
  paragraphs: { he: 'פסקאות', en: 'paragraphs' },
  play: { he: 'לנגן', en: 'Play' },
  pause: { he: 'עצירה', en: 'Pause' },
  other: { he: 'English', en: 'עברית' },
  page: { he: 'עמוד', en: 'Page' },
  prevPage: { he: 'הקודם', en: 'Previous' },
  nextPage: { he: 'הבא', en: 'Next' },
  by: { he: 'סוכנים', en: 'Agents' },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

type Agent = { id: string; name: { he: string; en: string }; model: string; does: { he: string; en: string }; family?: 'ocr' | 'miram' | 'whisper'; scoreNote?: { he: string; en: string }; count?: { type: string; label: { he: string; en: string } } };

/** RebbeHub's agents: the models (lib/models.ts gives their scores) and the bots that file and join the catalog. */
const AGENTS: Agent[] = [
  { id: 'reader', name: { he: 'הקורא', en: 'Reader' }, model: 'rebbehub-kraken-ls-v1', does: { he: 'קורא סריקה והופך אותה לטקסט', en: 'Reads a scan into text' }, family: 'ocr' },
  { id: 'miram', name: { he: 'גלאי המירם', en: 'Miram detector' }, model: 'rebbehub-facenet-v2', does: { he: 'מוצא את המילים המודגשות בסריקה', en: 'Finds the stressed (Miram) words in a scan' }, family: 'miram' },
  { id: 'listener', name: { he: 'השומע', en: 'Listener' }, model: 'rebbehub-whisper-v3', does: { he: 'כותב את ההקלטה מילה במילה', en: 'Transcribes a recording word for word' }, family: 'whisper', scoreNote: { he: 'שגיאות במילים / באותיות', en: 'word / letter errors' }, count: { type: 'text', label: { he: 'תמלולים', en: 'transcripts' } } },
  { id: 'timer', name: { he: 'המתזמן', en: 'Timer' }, model: 'align', does: { he: 'קובע את הרגע של כל מילה בהקלטה', en: 'Times each word to the recording' }, count: { type: 'alignment', label: { he: 'הקלטות מתוזמנות', en: 'recordings timed' } } },
  { id: 'indexer', name: { he: 'המפתח', en: 'Indexer' }, model: 'mafteach', does: { he: 'מאחד את מפתחות החלקים למפתח אחד', en: "Joins each volume's index into one" } },
  { id: 'librarian', name: { he: 'הספרן', en: 'Librarian' }, model: 'rebbehub-mcp', does: { he: 'מוסיף ומסדר את הקטלוג', en: 'Adds and files the catalog' }, count: { type: 'unit', label: { he: 'שיחות, מאמרים ומכתבים', en: 'sichos, maamarim and letters' } } },
];

/** An agent's headline score: the first score of its model in use, as the /models page has it. */
function scoreOf({ family, scoreNote }: Agent, lang: Lang): string {
  const f = MODEL_FAMILIES.find((x) => x.id === family);
  const table = f?.tables.find((t) => t.rows.some((r) => r.state === 'inUse'));
  const row = table?.rows.find((r) => r.state === 'inUse');
  if (!table || !row) return '';
  const shown = row.cells
    .slice(0, scoreNote ? 1 : 2)
    .map((c, i) => `${table.columns[i + 1]?.[lang] ?? ''}: ${typeof c === 'string' ? c : c[lang]}`)
    .join(' · ');
  return scoreNote ? `${shown} (${scoreNote[lang]})` : shown;
}

type View = 'text' | 'beside' | 'original';

export default function Show({ loaderData }: Route.ComponentProps) {
  const { token, lang, title, note, extras, farbrengens, pages, counts, hayomYom, mafteach, fonts } = loaderData;
  const sections: Array<{ id: string; label: string }> = [];
  if (pages.length) sections.push({ id: 'scans', label: w(lang, 'scans') });
  if (farbrengens.length) sections.push({ id: 'listen', label: w(lang, 'listen') });
  if (mafteach) sections.push({ id: 'mafteach', label: w(lang, 'mafteach') });
  if (hayomYom.length) sections.push({ id: 'daily', label: w(lang, 'daily') });

  return (
    <div className="show" lang={lang} dir={dir(lang)}>
      {fonts.frank || fonts.miram ? <style>{printFaces(token, fonts)}</style> : null}
      <header className="show-wrap show-top">
        <Logo size={22} />
        <a className="show-lang" href={`/show/${token}${lang === 'en' ? '?lang=he' : ''}`} lang={lang === 'en' ? 'he' : 'en'}>
          {w(lang, 'other')}
        </a>
      </header>

      <main className="show-wrap">
        <h1 className="show-title">{title}</h1>
        {note ? <p className="show-note">{note}</p> : null}
        <p className="show-lede">{w(lang, 'lede')}</p>
        <p className="show-meta">{w(lang, 'preview')}</p>

        {sections.length > 1 ? (
          <nav className="show-toc" aria-label={w(lang, 'contents')}>
            <h2 className="show-toc-h">{w(lang, 'contents')}</h2>
            <ol>
              <li>
                <a href="#agents">{w(lang, 'roster')}</a>
              </li>
              {extras.models ? (
                <li>
                  <a href="#benchmarks">{w(lang, 'bench')}</a>
                </li>
              ) : null}
              {sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`}>{s.label}</a>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}

        <section id="agents" className="show-section">
          <h2 className="show-h">{w(lang, 'roster')}</h2>
          {extras.models ? <p className="show-sub">{w(lang, 'rosterSub')}</p> : null}
          <div className="show-table-wrap">
            <table className="show-table">
              <thead>
                <tr>
                  <th scope="col">{w(lang, 'agent')}</th>
                  <th scope="col">{w(lang, 'does')}</th>
                  <th scope="col">{w(lang, 'model')}</th>
                  {extras.models ? <th scope="col">{w(lang, 'score')}</th> : null}
                  <th scope="col">{w(lang, 'made')}</th>
                </tr>
              </thead>
              <tbody>
                {AGENTS.map((a) => {
                  const made = a.id === 'indexer' && mafteach ? mafteach.totals.topics : a.count && counts?.[a.count.type] ? counts[a.count.type]! : null;
                  const madeLabel = a.id === 'indexer' ? { he: 'נושאים', en: 'topics' } : a.count?.label;
                  return (
                    <tr key={a.id}>
                      <th scope="row">{a.name[lang]}</th>
                      <td data-label={w(lang, 'does')}>{a.does[lang]}</td>
                      <td data-label={w(lang, 'model')}>
                        <code>{a.model}</code>
                      </td>
                      {extras.models ? <td data-label={w(lang, 'score')}>{scoreOf(a, lang)}</td> : null}
                      <td data-label={w(lang, 'made')}>{made !== null ? `${num(made, lang)} ${madeLabel?.[lang] ?? ''}` : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {extras.models ? (
          <section id="benchmarks" className="show-section">
            <h2 className="show-h">{w(lang, 'bench')}</h2>
            <p className="show-sub">{w(lang, 'benchSub')}</p>
            <Benchmarks lang={lang} />
            <p className="show-meta">{MODELS_LICENCE[lang]}</p>
          </section>
        ) : null}

        {pages.length ? (
          <Section id="scans" title={w(lang, 'scans')} sub={w(lang, 'scansSub')} agent="rebbehub-kraken-ls-v1, rebbehub-facenet-v2" lang={lang}>
            {pages.map((p) => (
              <PageCard key={p.id} page={p} lang={lang} />
            ))}
          </Section>
        ) : null}

        {farbrengens.length ? (
          <Section id="listen" title={w(lang, 'listen')} sub={w(lang, 'listenSub')} agent="rebbehub-whisper-v3, align" lang={lang}>
            <Listen token={token} farbrengens={farbrengens} lang={lang} />
          </Section>
        ) : null}

        {mafteach ? (
          <Section id="mafteach" title={w(lang, 'mafteach')} sub={`${w(lang, 'mafteachSub')} ${num(mafteach.totals.topics, lang)} ${w(lang, 'topics')}, ${num(mafteach.totals.places, lang)} ${w(lang, 'places')}.`} agent="mafteach" lang={lang}>
            <Form method="get" className="show-search" preventScrollReset>
              {lang === 'he' ? <input type="hidden" name="lang" value="he" /> : null}
              <input type="search" name="q" defaultValue={mafteach.q} placeholder={w(lang, 'search')} aria-label={w(lang, 'search')} dir="auto" />
              <button type="submit" className="btn">
                {w(lang, 'find')}
              </button>
            </Form>
            {mafteach.topics.length ? <Topics topics={mafteach.topics} lang={lang} /> : <p className="show-sub">{w(lang, 'none')}</p>}
          </Section>
        ) : null}

        {hayomYom.length ? (
          <Section id="daily" title={w(lang, 'daily')} sub={w(lang, 'dailySub')} agent="rebbehub-kraken-v1, layout" lang={lang}>
            <div className="show-paper">
              {hayomYom.map((h, i) => (
                <HayomYomDay key={i} title={h.title} body={h.body} shiurim={h.shiurim} lang={lang} />
              ))}
            </div>
          </Section>
        ) : null}
      </main>

      <footer className="show-wrap show-foot">
        <p>{w(lang, 'preview')}</p>
      </footer>
    </div>
  );
}

/**
 * The print's own faces, as Shmuly uploaded them (kept apart from the
 * site's code): Frank for the body, Miram for the stressed words. Each is
 * declared over every weight, so the browser never thickens Miram again.
 */
function printFaces(token: string, fonts: { frank: boolean; miram: boolean }): string {
  const face = (family: string, url: string) => `@font-face{font-family:'${family}';src:url('${url}');font-weight:100 900;font-display:swap}`;
  return [fonts.frank ? face('Frank Lubavitch', fontPath(token, 'frank')) : '', fonts.miram ? face('Miram Lubavitch', fontPath(token, 'miram')) : ''].join('');
}

function Section({ id, title, sub, agent, lang, children }: { id: string; title: string; sub: string; agent: string; lang: Lang; children: React.ReactNode }) {
  return (
    <section id={id} className="show-section">
      <h2 className="show-h">{title}</h2>
      <p className="show-sub">{sub}</p>
      <p className="show-meta">
        {w(lang, 'by')}: <code>{agent}</code>
      </p>
      {children}
    </section>
  );
}

/** Text, the two side by side, or the original alone. */
function Views({ view, set, lang, label }: { view: View; set: (v: View) => void; lang: Lang; label: string }) {
  return (
    <div className="show-seg" role="radiogroup" aria-label={`${w(lang, 'view')}: ${label}`}>
      {(['original', 'beside', 'text'] as const).map((v) => (
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
    <div className="show-card show-player">
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
      <p className="show-meta show-player-meta">
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

type PageView = { id: string; title: string; sub: string; scan: string | null; body: PageText | null; machine: boolean; head: string; heTitle: string };

/** A sicha: its words, and its scan beside them or alone. Where the reader kept the print's lines, the words are set as the printed page, page for page with the scan. */
function PageCard({ page: p, lang }: { page: PageView; lang: Lang }) {
  const [view, setView] = useState<View>('beside');
  const [page, setPage] = useState(() => firstPrinted(p.body));
  const version = p.body?.versions[0];
  const print = useMemo(() => printPagesOf(version), [version]);
  const labels = useMemo(() => noteLabels(version), [version]);
  const frame = useMemo(() => (print ? frameOf(print) : null), [print]);
  const shown: View = !p.scan ? 'text' : !p.body ? 'original' : view;
  const printed = print ? (print.find((x) => x.page === page) ?? print[0]!) : null;
  const go = (n: number) => setPage(Math.max(1, n));
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
      <div className={`show-pair show-pair-${shown}${printed ? ' show-pair-print' : ''}`}>
        {shown !== 'original' ? (
          printed && print ? (
            <div className="show-print">
              <PrintPage page={printed} frame={frame!} head={p.head} title={p.heTitle.split(' / ')[0] ?? p.heTitle} labels={labels} />
              {shown === 'text' || !p.scan ? <Pager at={print.indexOf(printed)} count={print.length} lang={lang} onGo={(i) => go(print[i]!.page)} label={printed.printed} /> : null}
            </div>
          ) : p.body ? (
            <div className="show-words torah">
              <PageWords page={p.body} lang={lang} />
            </div>
          ) : (
            <p className="show-sub">{w(lang, 'noText')}</p>
          )
        ) : null}
        {p.scan && shown !== 'text' ? (
          <div className="show-scan">
            <ScanBeside file={p.scan} src="" title={p.title} page={page} lang={lang} onPage={go} />
          </div>
        ) : null}
      </div>
    </article>
  );
}

/** The set pages, one at a time, when the scan is not beside them to turn them. */
function Pager({ at, count, label, lang, onGo }: { at: number; count: number; label: string | null; lang: Lang; onGo: (i: number) => void }) {
  return (
    <div className="show-pager">
      <button type="button" className="btn" onClick={() => onGo(at - 1)} disabled={at <= 0}>
        {w(lang, 'prevPage')}
      </button>
      <span>
        {w(lang, 'page')} {label ?? num(at + 1, lang)} · {num(at + 1, lang)}/{num(count, lang)}
      </span>
      <button type="button" className="btn" onClick={() => onGo(at + 1)} disabled={at >= count - 1}>
        {w(lang, 'nextPage')}
      </button>
    </div>
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
