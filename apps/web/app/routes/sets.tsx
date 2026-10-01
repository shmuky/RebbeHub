import { Link } from 'react-router';
import type { LocalName } from '@rebbehub/model';
import type { Route } from './+types/sets';
import type { Entity } from '../lib/api.js';
import { siteOf } from '../lib/context.server.js';
import { langFrom, nameOf, t, type Lang } from '../lib/i18n.js';
import { num } from '../lib/i18nUi.js';
import { href, itemPath, setPath } from '../lib/links.js';
import { pageMeta } from '../lib/seo.js';
import { additionOf, byOrder, everyAddition, everyWork, shelvesOf, type Shelf } from '../lib/shelves.js';
import { Icon } from '../ui/Icon.js';
import '../styles/pages/library.css';

/**
 * The library, as the redesign draws it (design/, screens 3a, 3j and 3k):
 * the shelves along the top on a phone and down the side on a wide screen,
 * the Rebbeim first, the Rebbe's own first of all; then the chosen shelf,
 * a card for each of its sefarim. One card is open: its volumes as a grid
 * of their numbers, and its other printings, collections and additions
 * beside it. The rest are rows that open in their place. Which shelf and
 * which card are in the address (`/sets?shelf=the-rebbe&open=rh-…`), so
 * the page works without script and is the same for everyone. The shelves
 * hold the official sefarim only; an addition to a sefer is under that
 * sefer's card (lib/shelves.ts).
 */

/** The Rebbeim's shelves, the Rebbe's first, as people say their names; the other shelves follow in the catalog's order. */
const REBBEIM: Array<{ slug: string; he: string; en: string; full: { he: string; en: string } | null }> = [
  { slug: 'the-rebbe', he: 'הרבי', en: 'The Rebbe', full: { he: 'רבי מנחם מענדל שניאורסאהן · ה׳תרס״ב–ה׳תשנ״ד', en: 'Rabbi Menachem Mendel Schneerson · 1902–1994' } },
  { slug: 'frierdiker-rebbe', he: 'הריי״צ', en: 'Frierdiker Rebbe', full: { he: 'רבי יוסף יצחק שניאורסאהן · ה׳תר״ם–ה׳תש״י', en: 'Rabbi Yosef Yitzchak Schneersohn · 1880–1950' } },
  { slug: 'rebbe-rashab', he: 'הרש״ב', en: 'Rebbe Rashab', full: { he: 'רבי שלום דובער שניאורסאהן · ה׳תרכ״א–ה׳תר״פ', en: 'Rabbi Shalom DovBer Schneersohn · 1860–1920' } },
  { slug: 'rebbe-maharash', he: 'מהר״ש', en: 'Rebbe Maharash', full: { he: 'רבי שמואל שניאורסאהן · ה׳תקצ״ד–ה׳תרמ״ג', en: 'Rabbi Shmuel Schneersohn · 1834–1882' } },
  { slug: 'tzemach-tzedek', he: 'הצמח צדק', en: 'Tzemach Tzedek', full: { he: 'רבי מנחם מענדל שניאורסאהן · ה׳תקמ״ט–ה׳תרכ״ו', en: 'Rabbi Menachem Mendel Schneersohn · 1789–1866' } },
  { slug: 'mitteler-rebbe', he: 'אדמו״ר האמצעי', en: 'Mitteler Rebbe', full: { he: 'רבי דובער שניאורי · ה׳תקל״ד–ה׳תקפ״ח', en: 'Rabbi DovBer Schneuri · 1773–1827' } },
  { slug: 'alter-rebbe', he: 'אדמו״ר הזקן', en: 'Alter Rebbe', full: { he: 'רבי שניאור זלמן מליאדי · ה׳תק״ה–ה׳תקע״ג', en: 'Rabbi Schneur Zalman of Liadi · 1745–1812' } },
  { slug: 'maggid', he: 'המגיד', en: 'The Maggid', full: { he: 'רבי דובער ממעזריטש · נסתלק ה׳תקל״ג', en: 'Rabbi DovBer of Mezritch · d. 1772' } },
  { slug: 'baal-shem-tov', he: 'הבעש״ט', en: 'Baal Shem Tov', full: { he: 'רבי ישראל בעל שם טוב · ה׳תנ״ח–ה׳תק״כ', en: 'Rabbi Yisroel Baal Shem Tov · 1698–1760' } },
];

const slugOfShelf = (set: { path?: string | null }) => (set.path ?? '').replace(/^\/sets\//, '');

const W = {
  rebbeim: { he: 'רבותינו נשיאינו', en: 'The Rebbeim' },
  more: { he: 'מדפים נוספים', en: 'More shelves' },
  parts: { he: 'חלקים', en: 'volumes' },
  continue: { he: 'לספר', en: 'Open the sefer' },
  others: { he: 'מהדורות ואוספים נוספים', en: 'Other editions and collections' },
  loose: { he: 'הוספות', en: 'Additions' },
  missing: { he: 'חסר כאן ספר?', en: 'A sefer missing here?' },
  addSefer: { he: 'הוספת ספר', en: 'Add a sefer' },
  organize: { he: 'סידור הספרייה', en: 'Organize the library' },
  empty: { he: 'אין עדיין ספרים במדף הזה.', en: 'No sefarim on this shelf yet.' },
  farbrengens: { he: 'לוח ההתוועדויות', en: 'The farbrengens calendar' },
} as const;
const w = (lang: Lang, key: keyof typeof W) => W[key][lang];

/** How a sefer is divided, as its row says it: by volume, year, month, day. */
const BY: Record<string, { he: string; en: string }> = {
  volume: { he: 'לפי חלקים', en: 'By volume' },
  part: { he: 'לפי חלקים', en: 'By part' },
  year: { he: 'לפי שנה', en: 'By year' },
  month: { he: 'לפי חודש', en: 'By month' },
  day: { he: 'לפי יום', en: 'By day' },
  chapter: { he: 'לפי פרקים', en: 'By chapter' },
  parsha: { he: 'לפי פרשה', en: 'By parsha' },
};

/** What an addition is, in a word under its name. */
const KINDS: Record<string, { he: string; en: string }> = {
  commentary: { he: 'ביאור', en: 'Commentary' },
  index: { he: 'מפתח', en: 'Index' },
  about: { he: 'על הספר', en: 'About it' },
  collection: { he: 'אוסף', en: 'Collection' },
  translation: { he: 'תרגום', en: 'Translation' },
};

const titleOf = (e: Entity, lang: Lang) => nameOf((e.data as { title?: LocalName; name?: LocalName }).title ?? (e.data as { name?: LocalName }).name, lang);

/** A card on the shelf: a sefer, or a set of sefarim under one name (Likkutei Sichos and the books gathered with it). */
interface Card {
  id: string;
  title: string;
  /** The sefer the card opens and whose volumes it shows. */
  main: { id: string; path: string; hint: string | null };
  /** The other sefarim kept with it on its set. */
  with: Array<{ id: string; path: string; title: string; sub: string | null }>;
}

const hintOf = (work: Entity, lang: Lang) => {
  const level = (work.data as { levels?: string[] }).levels?.[0];
  return level && BY[level] ? BY[level][lang] : null;
};

function cardsOf(shelf: Shelf<Entity>, lang: Lang): Card[] {
  const name = (x: Entity) => titleOf(x, lang);
  const items = byOrder([...shelf.sets.map((s) => s.set), ...shelf.works], name);
  return items.flatMap((x): Card[] => {
    const inner = shelf.sets.find((s) => s.set.id === x.id);
    if (!inner) return [{ id: x.id, title: name(x), main: { id: x.id, path: itemPath(x), hint: hintOf(x, lang) }, with: [] }];
    const setName = nameOf((x.data as { name?: LocalName }).name, lang);
    const inSet = [...everyWork(inner), ...everyAddition(inner)];
    // The sefer the set is named for opens it (the shortest address among those of its name: /likkutei-sichos), else the first.
    const named = inSet.filter((wk) => !additionOf(wk) && name(wk) === setName).sort((a, b) => itemPath(a).length - itemPath(b).length)[0];
    const main = named ?? inSet[0];
    if (!main) return [];
    const rest = inSet.filter((wk) => wk !== main);
    return [
      {
        id: x.id,
        title: setName,
        main: { id: main.id, path: itemPath(main), hint: hintOf(main, lang) },
        with: rest.map((r) => ({ id: r.id, path: itemPath(r), title: name(r), sub: KINDS[additionOf(r)?.kind ?? '']?.[lang] ?? null })),
      },
    ];
  });
}

/** Every sefer the shelves list, page after page (the API gives five hundred at a time). */
async function shelfWorks(api: ReturnType<typeof siteOf>['api']): Promise<Entity[]> {
  const out: Entity[] = [];
  let after: string | undefined;
  for (let page = 0; page < 4; page++) {
    const { items, next } = await api.list({ type: 'work', limit: 500, shelf: true, after });
    out.push(...items);
    if (!next) break;
    after = next;
  }
  return out;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const lang = langFrom(request);
  const params = new URL(request.url).searchParams;
  const [sets, works] = await Promise.all([api.list({ type: 'set', limit: 500 }), shelfWorks(api)]);
  const name = (x: Entity) => titleOf(x, lang);
  const isFarbrengens = (set: Entity) => set.path === '/sets/farbrengens';
  const all = shelvesOf(sets.items, works, name, isFarbrengens);
  // The Rebbeim's shelves first, the Rebbe's first of all; then the others as the catalog orders them.
  const rank = (sh: Shelf<Entity>) => {
    const i = REBBEIM.findIndex((r) => r.slug === slugOfShelf(sh.set));
    return i < 0 ? REBBEIM.length : i;
  };
  const shelves = [...all].sort((a, b) => rank(a) - rank(b));
  const asked = params.get('shelf');
  const shelf = shelves.find((sh) => slugOfShelf(sh.set) === asked) ?? shelves[0] ?? null;
  const cards = shelf && !isFarbrengens(shelf.set) ? cardsOf(shelf, lang) : [];
  const open = cards.find((c) => c.id === params.get('open')) ?? cards[0] ?? null;
  // The open card's volumes, and the additions to its sefer: two reads, for that card only.
  const [outline, additions] = open
    ? await Promise.all([api.workOutline(open.main.id).catch(() => []), api.linked(open.main.id, { field: 'addition.to', type: 'work', limit: 100 }).then((r) => r.items).catch(() => [] as Entity[])])
    : [[], [] as Entity[]];
  const loose = shelf ? everyAddition(shelf).filter((x) => !cards.some((c) => c.with.some((o) => o.id === x.id))) : [];
  return {
    lang,
    siteUrl,
    asked: Boolean(asked),
    shelves: shelves.map((sh) => ({ id: sh.set.id, slug: slugOfShelf(sh.set), path: setPath(sh.set), name: nameOf((sh.set.data as { name?: LocalName }).name, lang), rebbe: rank(sh) < REBBEIM.length, total: sh.total, farbrengens: isFarbrengens(sh.set) })),
    shelf: shelf ? { id: shelf.set.id, slug: slugOfShelf(shelf.set), path: setPath(shelf.set), name: nameOf((shelf.set.data as { name?: LocalName }).name, lang), total: shelf.total, farbrengens: isFarbrengens(shelf.set) } : null,
    cards,
    open: open
      ? {
          id: open.id,
          volumes: outline.length > 1 ? outline.map((x) => ({ value: x.value, label: x.label ? nameOf(x.label, lang) : x.value })) : [],
          units: outline.reduce((sum, x) => sum + x.units, 0),
          additions: additions.map((x) => ({ id: x.id, path: itemPath(x), title: titleOf(x, lang), sub: KINDS[additionOf(x)?.kind ?? '']?.[lang] ?? null })),
        }
      : null,
    loose: loose.map((x) => ({ id: x.id, path: itemPath(x), title: titleOf(x, lang) })),
  };
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const { lang, siteUrl, asked, shelf } = loaderData;
  const title = asked && shelf ? `${shelf.name} · ${t(lang, 'tabLibrary')}` : t(lang, 'tabLibrary');
  return pageMeta({ title, path: asked && shelf ? `/sets?shelf=${shelf.slug}` : '/sets', lang, siteUrl });
}

/** A volume's number on its square: חלק ט״ו is טו, a numbered one its number. */
const square = (label: string) => label.replace(/^(חלק|כרך|Vol\.?|Volume|Part)\s+/i, '').replace(/[׳״'"]/g, '');

export default function Library({ loaderData }: Route.ComponentProps) {
  const { lang, shelves, shelf, cards, open, loose } = loaderData;
  const rebbe = shelf ? REBBEIM.find((r) => r.slug === shelf.slug) : undefined;
  const shelfTo = (slug: string) => href('/sets', lang, { shelf: slug });
  const cardTo = (id: string) => href('/sets', lang, { shelf: shelf?.slug, open: id });
  const shortName = (s: { slug: string; name: string }) => REBBEIM.find((r) => r.slug === s.slug)?.[lang] ?? s.name;
  const rebbeim = shelves.filter((s) => s.rebbe);
  const others = shelves.filter((s) => !s.rebbe);
  // Numbered volumes are squares; named parts (Tanya's) are a list.
  const squares = !!open?.volumes.every((v) => square(v.label).length <= 3);
  return (
    <div className="wrap lb">
      <nav className="lb-shelves" aria-label={t(lang, 'shelves')}>
        <h2 className="lb-side-h">{w(lang, 'rebbeim')}</h2>
        <ul>
          {rebbeim.map((s) => (
            <li key={s.id}>
              <Link to={shelfTo(s.slug)} aria-current={s.id === shelf?.id ? 'page' : undefined} preventScrollReset>
                {shortName(s)}
              </Link>
            </li>
          ))}
        </ul>
        {others.length ? (
          <>
            <h2 className="lb-side-h">{w(lang, 'more')}</h2>
            <ul>
              {others.map((s) => (
                <li key={s.id}>
                  <Link to={s.farbrengens ? href('/calendar', lang) : shelfTo(s.slug)} aria-current={s.id === shelf?.id ? 'page' : undefined} preventScrollReset>
                    {s.name}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </nav>

      <div className="lb-main">
        {shelf ? (
          <header className="lb-head">
            <h1>
              <Link to={href(shelf.path, lang)}>{shelf.name}</Link>
            </h1>
            {rebbe?.full ? <p>{rebbe.full[lang]}</p> : null}
          </header>
        ) : null}

        {shelf?.farbrengens ? (
          <p>
            <Link className="btn" to={href('/calendar', lang)}>
              <Icon name="cal" />
              {w(lang, 'farbrengens')}
            </Link>
          </p>
        ) : cards.length ? (
          <div className="lb-cards">
            {cards.map((card) =>
              card.id === open?.id ? (
                <section key={card.id} className="lb-card open" aria-labelledby={`c-${card.id}`}>
                  <header className="lb-card-h">
                    <h2 id={`c-${card.id}`}>
                      <Link to={href(card.main.path, lang)}>{card.title}</Link>
                    </h2>
                    <Link className="lb-card-go" to={href(card.main.path, lang)}>
                      {w(lang, 'continue')}
                      <Icon name="chev" size={14} className="flip-ltr" />
                    </Link>
                  </header>
                  {open.volumes.length ? (
                    <>
                      <h3 className="lb-sub">
                        {num(open.volumes.length, lang)} {w(lang, 'parts')}
                      </h3>
                      <ol className={squares ? 'lb-grid' : 'lb-parts'}>
                        {open.volumes.map((v) => (
                          <li key={v.value}>
                            <Link to={href(card.main.path, lang, { part: v.value })} title={v.label}>
                              {squares ? square(v.label) : v.label}
                            </Link>
                          </li>
                        ))}
                      </ol>
                    </>
                  ) : open.units ? (
                    <p className="lb-sub">
                      {num(open.units, lang)} {t(lang, 'unitsShort')}
                    </p>
                  ) : null}
                  {card.with.length || open.additions.length ? (
                    <>
                      <h3 className="lb-sub">{w(lang, 'others')}</h3>
                      <ul className="lb-with">
                        {[...card.with, ...open.additions.filter((a) => !card.with.some((x) => x.id === a.id))].map((x) => (
                          <li key={x.id}>
                            <Link to={href(x.path, lang)}>
                              <b className="torah">{x.title}</b>
                              {x.sub ? <span>{x.sub}</span> : null}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </section>
              ) : (
                <Link key={card.id} className="lb-card lb-row" to={cardTo(card.id)} preventScrollReset>
                  <b>{card.title}</b>
                  {card.main.hint ? <span>{card.main.hint}</span> : null}
                  <Icon name="chev" size={16} className="subtle flip-ltr" />
                </Link>
              ),
            )}
            {loose.length ? (
              <details className="lb-card lb-loose">
                <summary>
                  <b>{w(lang, 'loose')}</b>
                  <span>{num(loose.length, lang)}</span>
                </summary>
                <ul>
                  {loose.map((x) => (
                    <li key={x.id}>
                      <Link to={href(x.path, lang)}>{x.title}</Link>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        ) : (
          <p className="muted">{w(lang, 'empty')}</p>
        )}

        <footer className="lb-foot">
          <span>{w(lang, 'missing')}</span>
          <Link to={href('/add', lang, { what: 'sefer' })}>{w(lang, 'addSefer')}</Link>
          <span aria-hidden="true">·</span>
          <Link to={href('/organize', lang)}>{w(lang, 'organize')}</Link>
        </footer>
      </div>
    </div>
  );
}
