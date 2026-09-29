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
import { Icon } from '../ui/Icon.js';
import { Avatar, EmptyState } from '../ui/primitives.js';
import { Shaar } from '../ui/Shaar.js';
import { TokenSearch } from '../ui/TokenSearch.js';
import { SEARCH_KEYS } from './search.js';
import '../styles/pages/browse.css';

/**
 * The library: every shelf (a set) with what it holds, the sefarim people
 * look for first as their title pages, every sefer by its kind, and the
 * Rebbeim in their order with how many of their sefarim are here.
 * Everything is browsed by what it is, not by how the catalog stores it;
 * a search from here is the site's search.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const [sets, works, authors, units, stats] = await Promise.all([
    api.list({ type: 'set', limit: 500 }),
    api.list({ type: 'work', limit: 500 }),
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
    sets: sets.items.filter((s) => !(s.data as { parent?: string }).parent),
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
const GENRE_ORDER = Object.keys(GENRES);

const W = {
  lede: { he: 'ספרי רבותינו נשיאינו, השיחות, האגרות וההתוועדויות — כל מדף עם מה שיש בו.', en: 'The sefarim of the Rebbeim, the sichos, the letters and the farbrengens — each shelf with what it holds.' },
  addSefer: { he: 'הוספת ספר', en: 'Add a sefer' },
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
  const worksOf = (set: Entity) => works.filter((wk) => ((wk.data as { sets?: string[] }).sets ?? []).includes(set.id));
  const authorsOf = (wk: Entity) => ((wk.data as { authors?: string[] }).authors ?? []).map((id) => authors.get(id)).filter((a): a is Entity => Boolean(a));
  const known = WELL_KNOWN.flatMap((slug) => works.filter((wk) => slugOf(wk) === slug).slice(0, 1));
  const events = counts.event ?? 0;
  const isFarbrengens = (set: Entity) => set.path === '/sets/farbrengens';
  // Shelves with most first; the farbrengens, which are not sefarim, lead.
  const shelves = sets
    .map((set) => ({ set, works: worksOf(set) }))
    .filter(({ set, works: list }) => list.length || isFarbrengens(set))
    .sort((a, b) => Number(isFarbrengens(b.set)) - Number(isFarbrengens(a.set)) || b.works.length - a.works.length);
  // Every sefer, grouped by its kind, in the order the library keeps them.
  const byGenre = new Map<string, Entity[]>();
  for (const wk of works) {
    const g = (wk.data as { genre?: string }).genre ?? '';
    byGenre.set(GENRES[g] ? g : '', [...(byGenre.get(GENRES[g] ? g : '') ?? []), wk]);
  }
  const genres = [...byGenre.keys()].sort((a, b) => (a ? GENRE_ORDER.indexOf(a) : 99) - (b ? GENRE_ORDER.indexOf(b) : 99));
  const countOf = (rebbe: Entity) => works.filter((wk) => ((wk.data as { authors?: string[] }).authors ?? []).includes(rebbe.id)).length;

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
                <b>{num(works.length, lang)}</b> {t(lang, 'seforim')}
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
                {shelves.map(({ set, works: list }) => {
                  const farbrengens = isFarbrengens(set);
                  const sample = list
                    .slice(0, 3)
                    .map((wk) => titleOf(wk, lang))
                    .join(' · ');
                  return (
                    <Link key={set.id} className="row shelf-row" to={href(setPath(set), lang)}>
                      <Icon name={farbrengens ? 'cal' : 'book'} />
                      <span className="row-main">
                        <span className="row-title torah">{nameOf((set.data as { name?: LocalName }).name, lang)}</span>
                        {sample || (set.data as { description?: LocalName }).description ? <span className="row-sub">{sample || nameOf((set.data as { description?: LocalName }).description, lang)}</span> : null}
                      </span>
                      <span className="num">{farbrengens ? `${num(events, lang)} ${t(lang, 'farbrengensCount')}` : `${num(list.length, lang)} ${t(lang, 'seforim')}`}</span>
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
                {w(lang, 'allSeforim')} <span className="count">{num(works.length, lang)}</span>
              </h2>
              <div className="box">
                {genres.map((g) => (
                  <div key={g || 'other'} role="group" aria-label={g ? GENRES[g]![lang] : w(lang, 'other')}>
                    <div className="row group">
                      <span>{g ? GENRES[g]![lang] : w(lang, 'other')}</span>
                      <span className="num">{num(byGenre.get(g)!.length, lang)}</span>
                    </div>
                    {byGenre
                      .get(g)!
                      .sort((a, b) => titleOf(a, lang).localeCompare(titleOf(b, lang), lang === 'he' ? 'he' : 'en'))
                      .map((wk) => {
                        const by = authorsOf(wk)
                          .map((a) => nameOf((a.data as { name?: LocalName }).name, lang))
                          .join(', ');
                        return (
                          <Link key={wk.id} className="row sefer-row" to={href(itemPath(wk), lang)}>
                            <Icon name="book" />
                            <span className="row-main one-line">
                              <span className="row-title torah">{titleOf(wk, lang)}</span>
                              {by ? <span className="by">{by}</span> : null}
                            </span>
                            {units[wk.id] ? <span className="num">{`${num(units[wk.id]!, lang)} ${t(lang, 'unitsShort')}`}</span> : null}
                          </Link>
                        );
                      })}
                  </div>
                ))}
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
                {num(works.length, lang)} {t(lang, 'seforim')}
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
