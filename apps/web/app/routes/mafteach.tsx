import { useState } from 'react';
import { Form, Link } from 'react-router';
import type { Route } from './+types/mafteach';
import type { Mafteach, MafteachPlace } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { href } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { Icon } from '../ui/Icon.js';
import { EmptyState, MachineLabel, MachineNote } from '../ui/primitives.js';
import '../styles/pages/mafteach.css';

/**
 * Likkutei Sichos' whole subject index on one page: every topic once, and
 * under it each volume's places, each with the index's own words for it
 * and its links, the sicha's PDF open at that page and the sicha's page
 * here. Nothing of it is stored: it is gathered from the volumes' index
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
  go: { he: 'חיפוש', en: 'Search' },
  topics: { he: 'נושאים', en: 'topics' },
  places: { he: 'מראי מקומות', en: 'references' },
  volumes: { he: 'חלקים', en: 'volumes' },
  found: { he: 'נמצאו {n} נושאים עבור "{q}"', en: '{n} topics found for "{q}"' },
  none: { he: 'לא נמצא נושא כזה', en: 'No such topic' },
  noneSay: { he: 'נסו מילה אחרת, או עיינו לפי האות.', en: 'Try another word, or browse by letter.' },
  clear: { he: 'ניקוי החיפוש', en: 'Clear the search' },
  letters: { he: 'לפי אות', en: 'By letter' },
  page: { he: "עמ'", en: 'p.' },
  pdf: { he: 'PDF', en: 'PDF' },
  text: { he: 'טקסט', en: 'Text' },
  fix: { he: 'לתיקון במפתח של החלק', en: "Fix it in the volume's index" },
  machine: {
    he: 'חלקים א-כה ולז נקראו במכונה מתוך ספרי המפתחות, וטרם נבדקו כולם. טעות? מתקנים בעמוד המפתח של אותו חלק, והתיקון מופיע כאן.',
    en: "Volumes 1-25 and 37 were read by machine from the printed index books and are not all checked yet. A mistake? Fix it on that volume's index page and the fix shows here.",
  },
  books: { he: 'המפתחות כפי שנדפסו', en: 'The indexes as printed' },
  pages: { he: 'עמודי התוצאות', en: 'Pages of results' },
  notYet: { he: 'המפתחות עדיין לא נמצאים באתר', en: 'The indexes are not on the site yet' },
  prev: { he: 'הקודמים', en: 'Previous' },
  next: { he: 'הבאים', en: 'Next' },
  of: { he: 'מתוך', en: 'of' },
  noVolumes: { he: 'למפתחות חלקים כו-כט עדיין לא נמצא מקור.', en: 'No source has been found yet for the indexes of volumes 26-29.' },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

function pages(place: MafteachPlace): string {
  return place.to && place.to !== place.page ? `${place.page}-${place.to}` : String(place.page);
}

function Place({ place, lang }: { place: MafteachPlace; lang: Lang }) {
  const number = `${w(lang, 'page')} ${pages(place)}`;
  const reader = readerLink(place);
  return (
    <li className="mf-place">
      {reader ? (
        <a className="mf-page" href={reader} title={place.sicha}>
          {number}
        </a>
      ) : (
        <span className="mf-page mf-page-plain">{number}</span>
      )}
      <span className="mf-body">
        {place.context ? <span className="mf-context">{place.context}</span> : null}
        {place.sicha || reader || place.text ? (
          <span className="mf-links">
            {place.sicha ? <span className="mf-sicha">{place.sicha}</span> : null}
            {reader ? (
              <a className="mf-link" href={reader}>
                {w(lang, 'pdf')}
              </a>
            ) : null}
            {place.text ? (
              <Link className="mf-link" to={href(place.text, lang)}>
                {w(lang, 'text')}
              </Link>
            ) : null}
          </span>
        ) : null}
      </span>
    </li>
  );
}

function Topic({ topic, lang }: { topic: Mafteach['topics'][number]; lang: Lang }) {
  return (
    <article className="mf-topic">
      <h2 className="mf-topic-name">{topic.topic}</h2>
      {topic.volumes.map((v) => (
        <section className="mf-volume" key={v.volume} aria-label={v.label}>
          <h3 className="mf-volume-name">
            {v.path ? (
              <Link to={href(v.path, lang)} title={w(lang, 'fix')}>
                {v.label}
              </Link>
            ) : (
              v.label
            )}
            {v.machine ? <MachineLabel lang={lang} size="sm" /> : null}
          </h3>
          <ul className="mf-places">
            {v.places.map((p, i) => (
              <Place key={i} place={p} lang={lang} />
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}

export default function MafteachPage({ loaderData }: Route.ComponentProps) {
  const { lang, q, back, index } = loaderData;
  const [query, setQuery] = useState(q);
  if (!index)
    return (
      <div className="wrap mf-wrap">
        <h1 className="page-title">{w(lang, 'title')}</h1>
        <EmptyState icon="book" title={w(lang, 'notYet')} />
      </div>
    );
  const letter = q ? null : (index.topics[0]?.letter ?? index.letters[0]?.letter ?? null);
  // Pages end where their places run out, so the way back is the offsets walked so far.
  const here = (from: number, trail: number[]) => href('/mafteach', lang, { q: q || undefined, letter: q ? undefined : (letter ?? undefined), from: from ? String(from) : undefined, back: trail.length ? trail.join(',') : undefined });
  const prev = index.offset > 0 ? here(back[back.length - 1] ?? 0, back.slice(0, -1)) : null;
  const next = index.next !== null ? here(index.next, [...back, index.offset]) : null;
  const shown = index.topics.length ? `${num(index.offset + 1, lang)}-${num(index.offset + index.topics.length, lang)} ${w(lang, 'of')} ${num(index.found, lang)}` : '';

  return (
    <>
      <div className="phead flat">
        <div className="wrap">
          <div className="phead-row">
            <div>
              <h1 className="page-title">{w(lang, 'title')}</h1>
              <p className="lede">{w(lang, 'intro')}</p>
              <p className="mf-totals subtle">
                {num(index.totals.topics, lang)} {w(lang, 'topics')} · {num(index.totals.places, lang)} {w(lang, 'places')} · {num(index.totals.volumes, lang)} {w(lang, 'volumes')}
              </p>
            </div>
            <div className="phead-acts">
              <Link className="btn" to={href('/likkutei-sichos-mafteach-sfarim', lang)}>
                <Icon name="scan" />
                {w(lang, 'books')}
              </Link>
            </div>
          </div>
          <Form className="mf-search" method="get" role="search">
            {lang === 'en' ? <input type="hidden" name="lang" value="en" /> : null}
            <Icon name="search" className="subtle" />
            <input name="q" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={w(lang, 'search')} aria-label={w(lang, 'search')} dir="auto" />
            <button className="btn primary" type="submit">
              {w(lang, 'go')}
            </button>
          </Form>
          <nav className="mf-letters" aria-label={w(lang, 'letters')}>
            {index.letters.map((l) => (
              <Link key={l.letter} className={l.letter === letter ? 'mf-letter current' : 'mf-letter'} to={href('/mafteach', lang, { letter: l.letter })} aria-current={l.letter === letter ? 'page' : undefined} title={`${num(l.topics, lang)} ${w(lang, 'topics')}`}>
                {l.letter}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      <div className="wrap mf-wrap">
        {index.topics.some((t) => t.volumes.some((v) => v.machine)) ? <MachineNote>{w(lang, 'machine')}</MachineNote> : null}
        {q ? (
          <p className="mf-found">
            {w(lang, 'found').replace('{n}', num(index.found, lang)).replace('{q}', q)}{' '}
            <Link to={href('/mafteach', lang)}>{w(lang, 'clear')}</Link>
          </p>
        ) : null}
        {index.topics.length ? (
          index.topics.map((t) => <Topic key={`${t.letter}-${t.topic}`} topic={t} lang={lang} />)
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
        <p className="subtle tiny">{w(lang, 'noVolumes')}</p>
      </div>
    </>
  );
}
