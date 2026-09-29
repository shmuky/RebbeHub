import { Form, Link } from 'react-router';
import type { LocalName } from '@rebbehub/model';
import { Search as SearchIcon } from 'lucide-react';
import type { Route } from './+types/sets';
import { Books, RebbePortrait, colourOf, rebbeOrder } from '../components/Library.js';
import type { Entity } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, nameOf, t, type Lang } from '../lib/i18n.js';
import { href, itemPath, setPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';

/**
 * The library: search, the Rebbeim in order, the shelves (a set per kind of
 * sefer) with what each holds, and well-known sefarim as covers. Everything
 * here is browsed by what it is, not by how the catalog stores it.
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
  // The well-known sefarim's covers, from their title pages where the jobs have drawn them.
  const shown = works.items.filter((w) => WELL_KNOWN.includes(String((w.data as { slug?: string }).slug)));
  const covers = await api.covers(shown.map((w) => w.id)).catch(() => ({}));
  return {
    covers,
    lang,
    siteUrl,
    sets: sets.items.filter((s) => !(s.data as { parent?: string }).parent),
    works: works.items,
    rebbeim: authors.items.filter((a) => (a.data as { kind?: string }).kind === 'rebbe').sort((a, b) => rebbeOrder(a) - rebbeOrder(b)),
    units,
    events: stats.counts.event ?? 0,
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return pageMeta({ title: t(loaderData.lang, 'tabLibrary'), path: '/sets', lang: loaderData.lang, siteUrl: loaderData.siteUrl });
}

/** Sefarim people look for first, when the catalog has them. */
const WELL_KNOWN = ['tanya', 'likkutei-sichos', 'hayom-yom', 'likkutei-torah', 'torah-or', 'igros-kodesh-rebbe', 'derech-mitzvosecha', 'shulchan-aruch-harav', 'siddur-weekday', 'kesser-shem-tov'];

const slugOf = (e: Entity) => (e.data as { slug?: string }).slug ?? '';

function unitsLabel(n: number | undefined, lang: Lang): string | undefined {
  if (!n) return undefined;
  return `${n.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US')} ${t(lang, 'unitsShort')}`;
}

export default function Library({ loaderData }: Route.ComponentProps) {
  const { lang, units, events } = loaderData;
  // The loader's items, as the API's own type (serialising them loses it).
  const sets = loaderData.sets as unknown as Entity[];
  const works = loaderData.works as unknown as Entity[];
  const rebbeim = loaderData.rebbeim as unknown as Entity[];
  const worksOf = (set: Entity) => works.filter((w) => ((w.data as { sets?: string[] }).sets ?? []).includes(set.id));
  const known = WELL_KNOWN.flatMap((slug) => works.filter((w) => slugOf(w) === slug).slice(0, 1));
  // Shelves with most first; the farbrengens, which are not sefarim, lead.
  const shelves = sets
    .map((set) => ({ set, works: worksOf(set) }))
    .filter(({ set, works: list }) => list.length || set.path === '/sets/farbrengens')
    .sort((a, b) => Number(b.set.path === '/sets/farbrengens') - Number(a.set.path === '/sets/farbrengens') || b.works.length - a.works.length);
  return (
    <>
      <h1>{t(lang, 'tabLibrary')}</h1>
      <Form method="get" action="/search" className="search-box library-search" role="search">
        <input name="q" type="search" dir="auto" placeholder={t(lang, 'librarySearch')} aria-label={t(lang, 'search')} enterKeyHint="search" />
        {lang === 'en' ? <input type="hidden" name="lang" value="en" /> : null}
        <button type="submit" aria-label={t(lang, 'search')}>
          <SearchIcon size={18} />
        </button>
      </Form>

      {rebbeim.length ? (
        <section>
          <h2 className="section-header">{t(lang, 'byRebbe')}</h2>
          <ul className="rebbeim">
            {rebbeim.map((r, i) => (
              <li key={r.id}>
                <Link className="rebbe" to={href(itemPath(r), lang)}>
                  <RebbePortrait author={r} index={i} lang={lang} />
                  {nameOf((r.data as { name?: LocalName }).name, lang)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h2 className="section-header">{t(lang, 'shelves')}</h2>
        <ul className="shelves">
          {shelves.map(({ set, works: list }) => {
            const genre = set.path === '/sets/farbrengens' ? 'farbrengens' : (list[0]?.data as { genre?: string } | undefined)?.genre;
            const sample = list
              .slice(0, 2)
              .map((w) => nameOf((w.data as { title?: LocalName }).title, lang))
              .join(' · ');
            const count = set.path === '/sets/farbrengens' ? `${events.toLocaleString(lang === 'he' ? 'he-IL' : 'en-US')} ${t(lang, 'farbrengensCount')}` : `${list.length} ${t(lang, 'seforim')}`;
            return (
              <li key={set.id}>
                <Link className="shelf" to={href(setPath(set), lang)} style={{ ['--shelf' as string]: colourOf(genre) }}>
                  <b>{nameOf((set.data as { name?: LocalName }).name, lang)}</b>
                  <small>
                    {count}
                    {sample ? ` · ${sample}` : ''}
                  </small>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {known.length ? (
        <section>
          <h2 className="section-header">{t(lang, 'wellKnown')}</h2>
          <Books works={known} lang={lang} covers={loaderData.covers} meta={(w) => unitsLabel(units[w.id], lang)} />
        </section>
      ) : null}
    </>
  );
}
