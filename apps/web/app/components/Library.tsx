import type { ReactNode } from 'react';
import type { LocalName } from '@rebbehub/model';
import type { Cover, Entity } from '../lib/api.js';
import { nameOf, type Lang } from '../lib/i18n.js';
import { href, itemPath } from '../lib/links.js';
import { Shaar } from '../ui/Shaar.js';

/**
 * The library's pieces: a book as its title page (the shaar, as the
 * library's own row of sefarim draws it), a Rebbe as a portrait circle.
 */

/** The Rebbeim in their order: the Baal Shem Tov and the Maggid, then the seven Rebbeim of Chabad. */
export function rebbeOrder(author: Entity): number {
  const d = author.data as { slug?: string; rebbe?: number };
  if (d.rebbe) return d.rebbe;
  if (d.slug === 'baal-shem-tov') return -2;
  if (d.slug === 'maggid') return -1;
  return 99;
}

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

export function RebbePortrait({ author, lang = 'he', size = 62 }: { author: Entity; lang?: Lang; size?: number }) {
  const d = author.data as { name?: LocalName; slug?: string };
  const short = SHORT_NAMES[d.slug ?? '']?.[lang] ?? nameOf(d.name, lang).charAt(0);
  return (
    <span className="portrait" style={{ width: size, height: size, fontSize: short.length > 3 ? size / 4.4 : size / 3.4 }} aria-hidden="true">
      {short}
    </span>
  );
}

/**
 * Sefarim as their title pages, in the row the library draws them in (a
 * grid on wide screens, a row that scrolls sideways on a phone): the page a
 * PDF the site serves shows (core/covers.ts) where the jobs have drawn one,
 * else the title page set from the catalog's words.
 */
export function Books({ works, lang, meta, covers, action }: { works: Entity[]; lang: Lang; meta?: (w: Entity) => string | undefined; covers?: Record<string, Cover>; action?: (w: Entity) => ReactNode }) {
  return (
    <ul className="shaar-row">
      {works.map((w) => {
        const title = nameOf((w.data as { title?: LocalName }).title, lang);
        const more = meta?.(w);
        return (
          <li key={w.id} className={action ? 'has-edit' : undefined}>
            <Shaar
              title={title}
              image={covers?.[w.id]?.thumb.url ?? null}
              to={href(itemPath(w), lang)}
              caption={
                <>
                  <b className="torah">{title}</b>
                  {more ? <span>{more}</span> : null}
                </>
              }
            />
            {action?.(w)}
          </li>
        );
      })}
    </ul>
  );
}
