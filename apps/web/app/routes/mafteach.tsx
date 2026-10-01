import { useState, type MouseEvent } from 'react';
import { Form, Link } from 'react-router';
import type { Route } from './+types/mafteach';
import type { Mafteach, MafteachPlace } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { href } from '../lib/links.js';
import { chipLabel, pages, topicLines, type Ref } from '../lib/mafteach.js';
import { pageMeta } from '../lib/seo.js';
import { Icon } from '../ui/Icon.js';
import { Breadcrumbs, EmptyState, MachineLabel, MachineNote } from '../ui/primitives.js';
import '../styles/pages/mafteach.css';

/**
 * Likkutei Sichos' whole subject index on one page: every topic once, and
 * under it each thing the index says of it, with a chip for every volume's
 * page that says it (ח״ב 412), a link to the sicha's PDF open at that page.
 * On a wide screen a chip first shows its place in a pane beside the list,
 * with the PDF and the sicha's page here one tap away. Nothing of it is stored: it is gathered from the volumes' index
 * pages (GET /v1/mafteach), so a fix made there shows here. A letter at a
 * time, or what a search finds; one API call a page, kept at the edge.
 */
const INDEX = '/likkutei-sichos-mafteach-inyanim';
const SEFER = '/likkutei-sichos';
const PER_PAGE = 40;
/** About this many places a page: a page of results stays under about 150 kB. */
const PLACES = 150;

/**
 * The reader open at the place: the sicha's PDF at its page, named by the
 * sicha. Written short, as the index pages write it (the title in readable
 * Hebrew, spaces as +), since a page holds hundreds: URLSearchParams would
 * spell out every Hebrew letter as three escapes.
 */
export function readerLink(place: MafteachPlace): string | null {
  if (!place.pdf) return null;
  const title = place.sicha ? `title=${place.sicha.replace(/[&#%+?]/g, (c) => encodeURIComponent(c)).replace(/ /g, '+')}&` : '';
  return `/read?${place.at ? `page=${place.at}&` : ''}${title}src=${place.pdf.replace(/[&#]/g, (c) => encodeURIComponent(c))}`;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim().slice(0, 200) ?? '';
  const letter = url.searchParams.get('letter') ?? undefined;
  const from = Math.max(0, Math.floor(Number(url.searchParams.get('from')) || 0));
  const back = url.searchParams.get('back')?.split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 0).slice(-50) ?? [];
  // Before the index's pages are in the catalog (a fresh copy of the site), the page says so rather than failing.
  const index = await api.mafteach({ index: INDEX, sefer: SEFER, q: q || undefined, letter: q ? undefined : letter, limit: PER_PAGE, places: PLACES, offset: from }).catch((error: { status?: number }) => {
    if (error.status === 404) return null;
    throw error;
  });
  return { lang, siteUrl, q, back, index };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: w(loaderData.lang, 'title'), description: w(loaderData.lang, 'intro'), path: '/mafteach', lang: loaderData.lang, siteUrl: loaderData.siteUrl });
}

const W = {
  title: { he: 'מפתח ענינים כללי ללקוטי שיחות', en: 'Likkutei Sichos: the full subject index' },
  intro: {
    he: 'כל הנושאים שבמפתחות כל החלקים יחד. לכל נושא, בכל חלק, העמודים, מה נאמר שם, וקישור לשיחה: ה-PDF פתוח בעמוד, והטקסט.',
    en: "Every topic in all the volumes' indexes together. Under each topic, each volume's pages, what is said there, and links to the sicha: its PDF open at the page, and its text.",
  },
  search: { he: 'חיפוש נושא, או מילה מתוך ההקשר', en: 'Search a topic, or words from its context' },
  topics: { he: 'נושאים', en: 'topics' },
  places: { he: 'מראי מקומות', en: 'references' },
  volumes: { he: 'חלקים', en: 'volumes' },
  found: { he: 'נמצאו {n} נושאים עבור "{q}"', en: '{n} topics found for "{q}"' },
  none: { he: 'לא נמצא נושא כזה', en: 'No such topic' },
  noneSay: { he: 'נסו מילה אחרת, או עיינו לפי האות.', en: 'Try another word, or browse by letter.' },
  clear: { he: 'ניקוי החיפוש', en: 'Clear the search' },
  letters: { he: 'לפי אות', en: 'By letter' },
  page: { he: "עמ'", en: 'p.' },
  text: { he: 'טקסט', en: 'Text' },
  fix: { he: 'לתיקון במפתח של החלק', en: "Fix it in the volume's index" },
  machine: {
    he: 'חלקים א-כה ולז נקראו במכונה מתוך ספרי המפתחות, וטרם נבדקו כולם. טעות? מתקנים בעמוד המפתח של אותו חלק, והתיקון מופיע כאן.',
    en: "Volumes 1-25 and 37 were read by machine from the printed index books and are not all checked yet. A mistake? Fix it on that volume's index page and the fix shows here.",
  },
  books: { he: 'כפי שנדפסו', en: 'As printed' },
  pages: { he: 'עמודי התוצאות', en: 'Pages of results' },
  notYet: { he: 'המפתחות עדיין לא נמצאים באתר', en: 'The indexes are not on the site yet' },
  prev: { he: 'הקודמים', en: 'Previous' },
  next: { he: 'הבאים', en: 'Next' },
  of: { he: 'מתוך', en: 'of' },
  short: { he: 'מפתח ענינים', en: 'Subject index' },
  sefer: { he: 'לקוטי שיחות', en: 'Likkutei Sichos' },
  kinds: { he: 'איזה מפתח', en: 'Which index' },
  entries: { he: 'ערכים', en: 'entries' },
  picked: { he: 'ההפניה שנבחרה', en: 'The reference picked' },
  open: { he: 'לפתוח בעמוד', en: 'Open at the page' },
  more: { he: 'עוד תחת ״{t}״', en: 'More under "{t}"' },
  noVolumes: { he: 'למפתחות חלקים כו-כט עדיין לא נמצא מקור.', en: 'No source has been found yet for the indexes of volumes 26-29.' },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang];


/** Wide enough for the pane beside the list: a chip then shows its place there instead of opening it. */
const PANE = '(min-width: 1100px)';

function Chip({ r, lang, current, onPick }: { r: Ref; lang: Lang; current: boolean; onPick: (r: Ref) => void }) {
  const reader = readerLink(r.place);
  const to = reader ?? (r.place.text ? href(r.place.text, lang) : null);
  const cls = `mf-chip${current ? ' current' : ''}${r.machine ? ' mach' : ''}`;
  const label = chipLabel(r.volume, r.place, lang);
  const pick = (e: MouseEvent<HTMLElement>) => {
    if (typeof window !== 'undefined' && window.matchMedia(PANE).matches) {
      e.preventDefault();
      onPick(r);
    }
  };
  if (!to)
    return (
      <button type="button" className={cls} title={r.place.sicha} aria-pressed={current} onClick={() => onPick(r)}>
        {label}
      </button>
    );
  return (
    <a className={cls} href={to} title={r.place.sicha} aria-current={current ? 'true' : undefined} onClick={pick}>
      {label}
    </a>
  );
}

function Topic({ topic, lang, picked, onPick }: { topic: Mafteach['topics'][number]; lang: Lang; picked: string | null; onPick: (topic: string, r: Ref) => void }) {
  return (
    <article className="mf-topic">
      <h2 className="mf-topic-name">{topic.topic}</h2>
      {topicLines(topic).map((line) => (
        <div className="mf-line" key={line.context || '-'}>
          {line.context ? <span className="mf-context">{line.context}</span> : null}
          {line.refs.map((r) => (
            <Chip key={r.key} r={r} lang={lang} current={picked === `${topic.topic}|${r.key}`} onPick={(x) => onPick(topic.topic, x)} />
          ))}
        </div>
      ))}
    </article>
  );
}

/** The reference picked, beside the list: where it is, the index's words for it, and the ways to open it. */
function Pane({ topic, r, lang, onPick }: { topic: Mafteach['topics'][number]; r: Ref; lang: Lang; onPick: (r: Ref) => void }) {
  const reader = readerLink(r.place);
  const all = topicLines(topic).flatMap((l) => l.refs);
  return (
    <aside className="mf-pane" aria-label={w(lang, 'picked')}>
      <div className="mf-pane-kicker">{w(lang, 'picked')}</div>
      <h2 className="mf-pane-title">
        {r.label}
        {r.machine ? <MachineLabel lang={lang} size="sm" /> : null}
      </h2>
      <p className="mf-pane-where">
        {w(lang, 'page')} {pages(r.place)}
        {r.place.sicha ? ` · ${r.place.sicha}` : ''}
      </p>
      <p className="mf-pane-words">
        <mark>{topic.topic}</mark>
        {r.place.context ? ` · ${r.place.context}` : ''}
      </p>
      <div className="btn-row">
        {reader ? (
          <a className="btn primary" href={reader}>
            {w(lang, 'open')}
            <Icon name={lang === 'he' ? 'chev' : 'chevr'} />
          </a>
        ) : null}
        {r.place.text ? (
          <Link className="btn" to={href(r.place.text, lang)}>
            <Icon name="book" />
            {w(lang, 'text')}
          </Link>
        ) : null}
      </div>
      {r.path ? (
        <Link className="mf-pane-fix" to={href(r.path, lang)}>
          {w(lang, 'fix')}
        </Link>
      ) : null}
      {all.length > 1 ? (
        <div className="mf-pane-more">
          <div className="mf-pane-kicker">{w(lang, 'more').replace('{t}', topic.topic)}</div>
          <div className="mf-pane-chips">
            {all.map((x) => (
              <button key={x.key} type="button" className={`mf-chip${x.key === r.key ? ' current' : ''}${x.machine ? ' mach' : ''}`} aria-pressed={x.key === r.key} title={x.place.sicha} onClick={() => onPick(x)}>
                {chipLabel(x.volume, x.place, lang)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

export default function MafteachPage({ loaderData }: Route.ComponentProps) {
  const { lang, q, back, index } = loaderData;
  const [query, setQuery] = useState(q);
  // The first reference is shown beside the list until another is picked, so the pane is never empty.
  const first = index?.topics[0];
  const firstRef = first ? topicLines(first)[0]?.refs[0] : undefined;
  const [picked, setPicked] = useState<{ topic: string; key: string } | null>(first && firstRef ? { topic: first.topic, key: firstRef.key } : null);
  const crumbs = <Breadcrumbs className="mf-crumbs" lang={lang} items={[{ label: w(lang, 'sefer'), to: href(SEFER, lang) }, { label: w(lang, 'short') }]} />;
  if (!index)
    return (
      <div className="wrap mf-wrap">
        {crumbs}
        <h1 className="page-title">{w(lang, 'title')}</h1>
        <EmptyState icon="book" title={w(lang, 'notYet')} />
      </div>
    );
  const letter = q ? null : (index.topics[0]?.letter ?? index.letters[0]?.letter ?? null);
  const inLetter = letter ? index.letters.find((l) => l.letter === letter)?.topics : undefined;
  // Pages end where their places run out, so the way back is the offsets walked so far.
  const here = (from: number, trail: number[]) => href('/mafteach', lang, { q: q || undefined, letter: q ? undefined : (letter ?? undefined), from: from ? String(from) : undefined, back: trail.length ? trail.join(',') : undefined });
  const prev = index.offset > 0 ? here(back[back.length - 1] ?? 0, back.slice(0, -1)) : null;
  const next = index.next !== null ? here(index.next, [...back, index.offset]) : null;
  const shown = index.topics.length ? `${num(index.offset + 1, lang)}-${num(index.offset + index.topics.length, lang)} ${w(lang, 'of')} ${num(index.found, lang)}` : '';
  const pickedTopic = picked ? index.topics.find((t) => t.topic === picked.topic) : undefined;
  const pickedRef = pickedTopic ? topicLines(pickedTopic).flatMap((l) => l.refs).find((r) => r.key === picked?.key) : undefined;

  return (
    <div className="mf2 wrap">
      <div className="mf-head">
        {crumbs}
        <div className="mf-title-row">
          <h1 className="page-title" title={w(lang, 'title')}>
            {w(lang, 'short')}
          </h1>
          <Form className="mf-search" method="get" role="search">
            {lang === 'en' ? <input type="hidden" name="lang" value="en" /> : null}
            <Icon name="search" className="subtle" />
            <input name="q" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={w(lang, 'search')} aria-label={w(lang, 'search')} dir="auto" />
          </Form>
        </div>
      </div>

      <nav className="mf-kinds segmented" aria-label={w(lang, 'kinds')}>
        <Link to={href('/mafteach', lang)} aria-current="page">
          {w(lang, 'short')}
        </Link>
        <Link to={href('/likkutei-sichos-mafteach-sfarim', lang)}>{w(lang, 'books')}</Link>
      </nav>

      <nav className="mf-letters" aria-label={w(lang, 'letters')}>
        <div className="mf-kicker">{w(lang, 'letters')}</div>
        <div className="mf-letter-grid">
          {index.letters.map((l) => (
            <Link key={l.letter} className={l.letter === letter ? 'mf-letter current' : 'mf-letter'} to={href('/mafteach', lang, { letter: l.letter })} aria-current={l.letter === letter ? 'page' : undefined} title={`${num(l.topics, lang)} ${w(lang, 'topics')}`}>
              {l.letter}
            </Link>
          ))}
        </div>
      </nav>

      <div className="mf-list">
        {index.topics.some((t) => t.volumes.some((v) => v.machine)) ? <MachineNote>{w(lang, 'machine')}</MachineNote> : null}
        {q ? (
          <p className="mf-found">
            {w(lang, 'found').replace('{n}', num(index.found, lang)).replace('{q}', q)}{' '}
            <Link to={href('/mafteach', lang)}>{w(lang, 'clear')}</Link>
          </p>
        ) : letter ? (
          <div className="mf-letter-head">
            <span className="mf-big">{letter}</span>
            {inLetter !== undefined ? (
              <span className="subtle">
                {num(inLetter, lang)} {w(lang, 'entries')}
              </span>
            ) : null}
          </div>
        ) : null}
        {index.topics.length ? (
          <div className="mf-topics">
            {index.topics.map((t) => (
              <Topic key={`${t.letter}-${t.topic}`} topic={t} lang={lang} picked={picked ? `${picked.topic}|${picked.key}` : null} onPick={(topic, r) => setPicked({ topic, key: r.key })} />
            ))}
          </div>
        ) : (
          <EmptyState icon="search" title={w(lang, 'none')}>
            {w(lang, 'noneSay')}
          </EmptyState>
        )}
        {prev || next ? (
          <nav className="mf-pager" aria-label={w(lang, 'pages')}>
            {prev ? (
              <Link className="btn" to={prev}>
                <Icon name={lang === 'he' ? 'chevr' : 'chev'} />
                {w(lang, 'prev')}
              </Link>
            ) : (
              <span />
            )}
            <span className="subtle">{shown}</span>
            {next ? (
              <Link className="btn" to={next}>
                {w(lang, 'next')}
                <Icon name={lang === 'he' ? 'chev' : 'chevr'} />
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </div>

      <p className="mf-about subtle">
        {w(lang, 'intro')} {num(index.totals.topics, lang)} {w(lang, 'topics')} · {num(index.totals.places, lang)} {w(lang, 'places')} · {num(index.totals.volumes, lang)} {w(lang, 'volumes')}. {w(lang, 'noVolumes')}
      </p>

      {pickedTopic && pickedRef ? <Pane topic={pickedTopic} r={pickedRef} lang={lang} onPick={(r) => setPicked({ topic: pickedTopic.topic, key: r.key })} /> : null}
    </div>
  );
}
