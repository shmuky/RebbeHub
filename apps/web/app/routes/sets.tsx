import { Link } from 'react-router';
import type { LocalName } from '@rebbehub/model';
import type { Route } from './+types/sets';
import { rebbeOrder } from '../components/Library.js';
import type { Cover, Entity } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, nameOf, t, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { href, itemPath, setPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { additionOf, everyAddition, everyWork, shelvesOf, type Shelf } from '../lib/shelves.js';
import { Icon } from '../ui/Icon.js';
import { Avatar, EmptyState } from '../ui/primitives.js';
import { Shaar } from '../ui/Shaar.js';
import { TokenSearch } from '../ui/TokenSearch.js';
import { SEARCH_KEYS } from './search.js';
import '../styles/pages/browse.css';

/**
 * The library: a shelf for each Rebbe and the other shelves, in the order
 * the catalog keeps them, each with the sets inside it; the sefarim people
 * look for first as their title pages; every sefer in its shelf's order;
 * and the Rebbeim with how many of their sefarim are here. The sources the
 * sefarim came from are not shelves (lib/shelves.ts); a search from here is
 * the site's search. The shelves and their counts are the official sefarim:
 * an addition to a sefer is on that sefer's page, and one that belongs to
 * none is kept apart at the end of its shelf.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const [sets, works, authors, units, stats] = await Promise.all([
    api.list({ type: 'set', limit: 500 }),
    // What the shelves list: the additions to a sefer are on its own page, not here.
    api.list({ type: 'work', limit: 500, shelf: true }),
    api.list({ type: 'author', limit: 100 }),
    api.refCounts('work', 'unit'),
    api.stats(),
  ]);
  // The well-known sefarim's title pages, where the jobs have drawn them.
  const shown = works.items.filter((w) => WELL_KNOWN.includes(String((w.data as { slug?: string }).slug)));
  const covers = await api.covers(shown.map((w) => w.id)).catch(() => ({}) as Record<string, Cover>);
  return {
    covers,
    lang,
    siteUrl,
    // Only what the shelves need of each set: the page lists every one.
    sets: sets.items.map((s) => {
      const d = s.data as { name?: LocalName; parent?: string; order?: string };
      return { ...s, data: { name: d.name, parent: d.parent, order: d.order } };
    }),
    works: works.items,
    rebbeim: authors.items.filter((a) => (a.data as { kind?: string }).kind === 'rebbe').sort((a, b) => rebbeOrder(a) - rebbeOrder(b)),
    authors: authors.items,
    units,
    counts: stats.counts,
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: t(loaderData.lang, 'tabLibrary'), path: '/sets', lang: loaderData.lang, siteUrl: loaderData.siteUrl });
}

/** Sefarim people look for first, when the catalog has them. */
const WELL_KNOWN = ['tanya', 'likkutei-sichos', 'hayom-yom', 'likkutei-torah', 'torah-or', 'igros-kodesh-rebbe', 'derech-mitzvosecha', 'shulchan-aruch-harav', 'siddur-weekday', 'kesser-shem-tov'];

const GENRES: Record<string, { he: string; en: string }> = {
  chassidus: { he: 'חסידות', en: 'Chassidus' },
  maamarim: { he: 'מאמרים', en: 'Maamarim' },
  sichos: { he: 'שיחות', en: 'Sichos' },
  igros: { he: 'אגרות', en: 'Letters' },
  halacha: { he: 'הלכה', en: 'Halacha' },
  siddur: { he: 'סידור', en: 'Siddur' },
  minhagim: { he: 'מנהגים', en: 'Minhagim' },
  history: { he: 'תולדות', en: 'History' },
  diaries: { he: 'יומנים', en: 'Diaries' },
  recordings: { he: 'הקלטות', en: 'Recordings' },
};

const W = {
  lede: { he: 'ספרי רבותינו נשיאינו, השיחות, האגרות וההתוועדויות — כל מדף עם מה שיש בו.', en: 'The sefarim of the Rebbeim, the sichos, the letters and the farbrengens — each shelf with what it holds.' },
  addSefer: { he: 'הוספת ספר', en: 'Add a sefer' },
  additions: { he: 'הוספות', en: 'Additions' },
  searchLabel: { he: 'חיפוש בספרייה', en: 'Search the library' },
  allSeforim: { he: 'כל הספרים', en: 'Every sefer' },
  other: { he: 'אחר', en: 'Other' },
  rebbeim: { he: 'רבותינו נשיאינו', en: 'The Rebbeim' },
  inCatalog: { he: 'בקטלוג', en: 'In the catalog' },
  units: { he: 'שיחות ופרקים', en: 'Sichos and chapters' },
  recordings: { he: 'הקלטות', en: 'Recordings' },
  missing: { he: 'חסר כאן ספר?', en: 'A sefer missing here?' },
  missingHint: { he: 'אפשר להציע אותו, עם הסריקה או בלעדיה. אחראי המדף בודק ומאשר.', en: 'Suggest it, with its scan or without. The shelf’s keeper checks and approves.' },
  empty: { he: 'אין עדיין ספרים בקטלוג.', en: 'No sefarim in the catalog yet.' },
  byThem: { he: 'ספרים', en: 'sefarim' },
  organize: { he: 'סידור הספרייה', en: 'Organize' },
} as const;

const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

const slugOf = (e: Entity) => (e.data as { slug?: string }).slug ?? '';
const titleOf = (e: Entity, lang: Lang) => nameOf((e.data as { title?: LocalName; name?: LocalName }).title ?? (e.data as { name?: LocalName }).name, lang);

export default function Library({ loaderData }: Route.ComponentProps) {
  const { lang, units, counts } = loaderData;
  // The loader's items, as the API's own type (serialising them loses it).
  const sets = loaderData.sets as unknown as Entity[];
  const works = loaderData.works as unknown as Entity[];
  const rebbeim = loaderData.rebbeim as unknown as Entity[];
  const authors = new Map((loaderData.authors as unknown as Entity[]).map((a) => [a.id, a]));
  const covers = loaderData.covers as Record<string, Cover>;
  const authorsOf = (wk: Entity) => ((wk.data as { authors?: string[] }).authors ?? []).map((id) => authors.get(id)).filter((a): a is Entity => Boolean(a));
  const known = WELL_KNOWN.flatMap((slug) => works.filter((wk) => slugOf(wk) === slug).slice(0, 1));
  const events = counts.event ?? 0;
  const isFarbrengens = (set: Entity) => set.path === '/sets/farbrengens';
  // A shelf for each Rebbe, then the others, as the catalog orders them.
  const shelves = shelvesOf(sets, works, (x) => titleOf(x, lang), isFarbrengens);
  // The official sefarim are what the library counts; additions are not sefarim of the tree.
  const official = works.filter((wk) => !additionOf(wk));
  // Every sefer under its shelf; those on no shelf last.
  const shelved = new Set(shelves.flatMap((sh) => [...everyWork(sh), ...everyAddition(sh)].map((wk) => wk.id)));
  const unshelved = works.filter((wk) => !shelved.has(wk.id) && !additionOf(wk)?.to).sort((a, b) => titleOf(a, lang).localeCompare(titleOf(b, lang), lang === 'he' ? 'he' : 'en'));
  const countOf = (rebbe: Entity) => official.filter((wk) => ((wk.data as { authors?: string[] }).authors ?? []).includes(rebbe.id)).length;

  return (
    <div className="lib-page">
      <div className="phead">
        <div className="wrap">
          <div className="phead-row">
            <div>
              <h1 className="page-title">{t(lang, 'tabLibrary')}</h1>
              <p className="lede">{w(lang, 'lede')}</p>
            </div>
            <div className="phead-acts">
              <Link className="btn" to={href('/organize', lang)}>
                <Icon name="layers" />
                {w(lang, 'organize')}
              </Link>
              <Link className="btn" to={href('/add', lang, { what: 'sefer' })}>
                <Icon name="plus" />
                {w(lang, 'addSefer')}
              </Link>
            </div>
          </div>
          <div className="facts-row">
            <span>
              <Icon name="book" className="subtle" />
              <span>
                <b>{num(official.length, lang)}</b> {t(lang, 'seforim')}
              </span>
            </span>
            {counts.unit ? (
              <span>
                <Icon name="file" className="subtle" />
                <span>
                  <b>{num(counts.unit, lang)}</b> {w(lang, 'units')}
                </span>
              </span>
            ) : null}
            {events ? (
              <span>
                <Icon name="cal" className="subtle" />
                <span>
                  <b>{num(events, lang)}</b> {t(lang, 'farbrengensCount')}
                </span>
              </span>
            ) : null}
            {counts.recording ? (
              <span>
                <Icon name="audio" className="subtle" />
                <span>
                  <b>{num(counts.recording, lang)}</b> {t(lang, 'recordingParts')}
                </span>
              </span>
            ) : null}
          </div>
          <div className="lib-search">
            <TokenSearch lang={lang} keys={SEARCH_KEYS} action="/search" label={w(lang, 'searchLabel')} placeholder={t(lang, 'librarySearch')} />
          </div>
        </div>
      </div>

      <div className="wrap cols">
        <div className="stack-lg">
          <section aria-labelledby="shelves">
            <h2 className="h-block first" id="shelves">
              {t(lang, 'shelves')} <span className="count">{num(shelves.length, lang)}</span>
            </h2>
            {shelves.length ? (
              <nav className="box" aria-labelledby="shelves">
                {shelves.map((shelf) => {
                  const { set } = shelf;
                  const farbrengens = isFarbrengens(set);
                  const sample = (shelf.sets.length ? shelf.sets.map((sh) => sh.set) : everyWork(shelf))
                    .slice(0, 4)
                    .map((x) => titleOf(x, lang))
                    .join(' · ');
                  return (
                    <Link key={set.id} className="row shelf-row" to={href(setPath(set), lang)}>
                      <Icon name={farbrengens ? 'cal' : 'book'} />
                      <span className="row-main">
                        <span className="row-title torah">{nameOf((set.data as { name?: LocalName }).name, lang)}</span>
                        {sample || (set.data as { description?: LocalName }).description ? <span className="row-sub">{sample || nameOf((set.data as { description?: LocalName }).description, lang)}</span> : null}
                      </span>
                      <span className="num">{farbrengens && !shelf.total ? `${num(events, lang)} ${t(lang, 'farbrengensCount')}` : `${num(shelf.total, lang)} ${t(lang, 'seforim')}`}</span>
                    </Link>
                  );
                })}
              </nav>
            ) : (
              <EmptyState icon="book" title={w(lang, 'empty')} compact />
            )}
          </section>

          {known.length ? (
            <section aria-labelledby="known">
              <h2 className="h-block" id="known">
                {t(lang, 'wellKnown')}
              </h2>
              <ul className="shaar-row">
                {known.map((wk) => {
                  const by = authorsOf(wk)[0];
                  const genre = GENRES[(wk.data as { genre?: string }).genre ?? ''];
                  return (
                    <li key={wk.id}>
                      <Shaar
                        title={titleOf(wk, lang)}
                        kind={genre?.[lang]}
                        by={by ? nameOf((by.data as { name?: LocalName }).name, lang) : undefined}
                        image={covers[wk.id]?.thumb.url ?? null}
                        to={href(itemPath(wk), lang)}
                        caption={
                          <>
                            <b className="torah">{titleOf(wk, lang)}</b>
                            {units[wk.id] ? <span>{`${num(units[wk.id]!, lang)} ${t(lang, 'unitsShort')}`}</span> : null}
                          </>
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {works.length ? (
            <section aria-labelledby="all-seforim">
              <h2 className="h-block" id="all-seforim">
                {w(lang, 'allSeforim')} <span className="count">{num(official.length, lang)}</span>
              </h2>
              <div className="box">
                {shelves
                  .filter((sh) => sh.total || everyAddition(sh).length)
                  .map((sh) => (
                    <ShelfGroup key={sh.set.id} shelf={sh} depth={0} lang={lang} units={units} authorsOf={authorsOf} />
                  ))}
                {unshelved.length ? (
                  <div role="group" aria-label={w(lang, 'other')}>
                    <div className="row group">
                      <span>{w(lang, 'other')}</span>
                      <span className="num">{num(unshelved.length, lang)}</span>
                    </div>
                    {unshelved.map((wk) => (
                      <SeferRow key={wk.id} work={wk} lang={lang} units={units} authorsOf={authorsOf} />
                    ))}
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="side">
          {rebbeim.length ? (
            <section>
              <h2>{w(lang, 'rebbeim')}</h2>
              <ul className="side-list rebbe-list">
                {rebbeim.map((r) => {
                  const name = nameOf((r.data as { name?: LocalName }).name, lang);
                  const n = countOf(r);
                  return (
                    <li key={r.id}>
                      <Avatar name={name} id={r.id} size="sm" />
                      <Link className="grow" to={href(itemPath(r), lang)}>
                        {name}
                      </Link>
                      {n ? <span className="subtle num">{`${num(n, lang)} ${w(lang, 'byThem')}`}</span> : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
          <section>
            <h2>{w(lang, 'inCatalog')}</h2>
            <dl>
              <dt>{t(lang, 'tabLibrary')}</dt>
              <dd>
                {num(official.length, lang)} {t(lang, 'seforim')}
              </dd>
              {counts.unit ? (
                <>
                  <dt>{w(lang, 'units')}</dt>
                  <dd>{num(counts.unit, lang)}</dd>
                </>
              ) : null}
              <dt>{t(lang, 'tabFarbrengens')}</dt>
              <dd>
                <Link to={href('/calendar', lang)}>{num(events, lang)}</Link>
              </dd>
              {counts.recording ? (
                <>
                  <dt>{w(lang, 'recordings')}</dt>
                  <dd>{num(counts.recording, lang)}</dd>
                </>
              ) : null}
            </dl>
          </section>
          <section>
            <h2>{w(lang, 'missing')}</h2>
            <p className="side-p">{w(lang, 'missingHint')}</p>
            <Link className="btn sm" to={href('/add', lang, { what: 'sefer' })}>
              <Icon name="plus" />
              {w(lang, 'addSefer')}
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}

type Units = Record<string, number>;

/** A sefer's row in the list of every sefer: its name, who wrote it, how many sichos or chapters. */
function SeferRow({ work, lang, units, authorsOf }: { work: Entity; lang: Lang; units: Units; authorsOf: (wk: Entity) => Entity[] }) {
  const by = authorsOf(work)
    .map((a) => nameOf((a.data as { name?: LocalName }).name, lang))
    .join(', ');
  return (
    <Link className="row sefer-row" to={href(itemPath(work), lang)}>
      <Icon name="book" />
      <span className="row-main one-line">
        <span className="row-title torah">{titleOf(work, lang)}</span>
        {by ? <span className="by">{by}</span> : null}
      </span>
      {units[work.id] ? <span className="num">{`${num(units[work.id]!, lang)} ${t(lang, 'unitsShort')}`}</span> : null}
    </Link>
  );
}

/** A shelf in the list of every sefer: its own sefarim, then each set inside it under its name, then its additions apart and closed. */
function ShelfGroup({ shelf, depth, lang, units, authorsOf }: { shelf: Shelf<Entity>; depth: number; lang: Lang; units: Units; authorsOf: (wk: Entity) => Entity[] }) {
  const name = nameOf((shelf.set.data as { name?: LocalName }).name, lang);
  return (
    <div role="group" aria-label={name}>
      <div className={depth ? 'row group sub' : 'row group'}>
        <Link to={href(setPath(shelf.set), lang)}>{name}</Link>
        <span className="num">{num(shelf.total, lang)}</span>
      </div>
      {shelf.works.map((wk) => (
        <SeferRow key={wk.id} work={wk} lang={lang} units={units} authorsOf={authorsOf} />
      ))}
      {shelf.sets.map((sh) => (
        <ShelfGroup key={sh.set.id} shelf={sh} depth={depth + 1} lang={lang} units={units} authorsOf={authorsOf} />
      ))}
      {shelf.additions.length ? (
        <details>
          <summary className="row group sub">{`${w(lang, 'additions')} (${num(shelf.additions.length, lang)})`}</summary>
          {shelf.additions.map((wk) => (
            <SeferRow key={wk.id} work={wk} lang={lang} units={units} authorsOf={authorsOf} />
          ))}
        </details>
      ) : null}
    </div>
  );
}
