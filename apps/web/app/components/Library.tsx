import { Link } from 'react-router';
import type { LocalName } from '@rebbehub/model';
import type { Cover, Entity } from '../lib/api.js';
import { nameOf, type Lang } from '../lib/i18n.js';
import { href, itemPath } from '../lib/links.js';

/**
 * The library's pieces: a book as a cover coloured by its shelf, a Rebbe as
 * a portrait circle, a shelf as a line on the page. Covers are dark cloth,
 * one colour per kind of sefer, lettered in gold as seforim are.
 */

export const GENRE_COLOURS: Record<string, string> = {
  chassidus: '#1d3d2e',
  maamarim: '#1f2f4a',
  sichos: '#4a3322',
  igros: '#5e1f26',
  halacha: '#1e3f41',
  siddur: '#3a2a4d',
  minhagim: '#50391f',
  history: '#33352f',
  diaries: '#2b3444',
  recordings: '#1e3f41',
  farbrengens: '#1d3d2e',
};

export const colourOf = (genre: string | undefined) => GENRE_COLOURS[genre ?? ''] ?? '#4d5a52';

/** The Rebbeim in their order: the Baal Shem Tov and the Maggid, then the seven Rebbeim of Chabad. */
export function rebbeOrder(author: Entity): number {
  const d = author.data as { slug?: string; rebbe?: number };
  if (d.rebbe) return d.rebbe;
  if (d.slug === 'baal-shem-tov') return -2;
  if (d.slug === 'maggid') return -1;
  return 99;
}

const PORTRAIT_COLOURS = ['#23466e', '#5b3f99', '#8c2a3c', '#0f6e6e', '#7e5800', '#16744a', '#45536b', '#6b4f2a', '#16744a'];

/** What each is called for short, as chassidim say it, for his portrait. */
const SHORT_NAMES: Record<string, { he: string; en: string }> = {
  'baal-shem-tov': { he: 'בעש״ט', en: 'BeShT' },
  maggid: { he: 'המגיד', en: 'Maggid' },
  'alter-rebbe': { he: 'אדה״ז', en: 'AR' },
  'mitteler-rebbe': { he: 'אדה״א', en: 'MR' },
  'tzemach-tzedek': { he: 'צ״צ', en: 'TzTz' },
  'rebbe-maharash': { he: 'מהר״ש', en: 'Maharash' },
  'rebbe-rashab': { he: 'רש״ב', en: 'Rashab' },
  'frierdiker-rebbe': { he: 'ריי״צ', en: 'Rayatz' },
  'the-rebbe': { he: 'הרבי', en: 'Rebbe' },
};

export function RebbePortrait({ author, index, lang = 'he', size = 62 }: { author: Entity; index: number; lang?: Lang; size?: number }) {
  const d = author.data as { name?: LocalName; slug?: string };
  const short = SHORT_NAMES[d.slug ?? '']?.[lang] ?? nameOf(d.name, lang).charAt(0);
  return (
    <span className="portrait" style={{ background: PORTRAIT_COLOURS[index % PORTRAIT_COLOURS.length], width: size, height: size, fontSize: short.length > 3 ? size / 4.4 : size / 3.4 }} aria-hidden="true">
      {short}
    </span>
  );
}

/** A book's own shade of its shelf's colour, fixed by its id, so a shelf of one kind is not a wall of one colour. */
export function coverColour(work: Pick<Entity, 'id' | 'data'>): string {
  let hash = 0;
  for (const ch of work.id) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  const shade = (hash % 5) * 7 - 12; // -12% (lighter) to +16% (darker)
  const base = colourOf((work.data as { genre?: string }).genre);
  return shade < 0 ? `color-mix(in srgb, ${base}, white ${-shade}%)` : `color-mix(in srgb, ${base}, black ${shade}%)`;
}

/**
 * A sefer's cover: its title page (the shaar), drawn from a PDF the site
 * serves (core/covers.ts), where the jobs have drawn one; else its cloth
 * cover, lettered with its name. A page a machine chose says so on hover.
 */
export function CoverPicture({ work, cover, lang, big }: { work: Pick<Entity, 'id' | 'data'>; cover?: Cover; lang: Lang; big?: boolean }) {
  const d = work.data as { title?: LocalName };
  if (cover) {
    const picture = big ? cover.image : cover.thumb;
    return (
      <span className="cover shaar" title={cover.machine ? (lang === 'he' ? 'השער נבחר על ידי מחשב' : 'Title page chosen by a machine') : undefined}>
        <img src={picture.url} width={picture.width} height={picture.height} alt={nameOf(d.title, lang)} loading="lazy" decoding="async" />
      </span>
    );
  }
  return (
    <span className="cover" style={{ background: coverColour(work) }} aria-hidden={big ? true : undefined}>
      <span className="cover-title">{nameOf(d.title, lang)}</span>
    </span>
  );
}

export function BookCover({ work, lang, meta, size = 'medium', cover }: { work: Entity; lang: Lang; meta?: string; size?: 'medium' | 'large'; cover?: Cover }) {
  return (
    <Link to={href(itemPath(work), lang)} className={`book ${size}`}>
      <CoverPicture work={work} cover={cover} lang={lang} />
      {meta ? <span className="book-meta">{meta}</span> : null}
    </Link>
  );
}

/** Covers in a row that scrolls sideways, or in a grid. */
export function Books({ works, lang, meta, grid, covers }: { works: Entity[]; lang: Lang; meta?: (w: Entity) => string | undefined; grid?: boolean; covers?: Record<string, Cover> }) {
  return (
    <ul className={grid ? 'books grid' : 'books'}>
      {works.map((w) => (
        <li key={w.id}>
          <BookCover work={w} lang={lang} meta={meta?.(w)} cover={covers?.[w.id]} />
        </li>
      ))}
    </ul>
  );
}
