import { Link } from 'react-router';
import type { LocalName } from '@rebbehub/model';
import type { Entity } from '../lib/api.js';
import { nameOf, type Lang } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { Icon } from '../ui/Icon.js';

const W = {
  previous: { he: 'הקודם', en: 'Previous' },
  next: { he: 'הבא', en: 'Next' },
  chapters: { he: 'מעבר בין הפרקים', en: 'Chapters' },
};

type Step = { level: string; value: string; label?: LocalName };

/**
 * What a neighbouring sicha is called beside its button: its own name, and
 * its volume's too when it is in another volume than the one being read
 * (the last sicha of חלק א leads to the first of חלק ב).
 */
export function neighbourLabel(neighbour: Pick<Entity, 'id' | 'type' | 'data'>, current: Pick<Entity, 'data'>, lang: Lang): string {
  const steps = ((neighbour.data as { position?: Step[] }).position ?? []) as Step[];
  const here = ((current.data as { position?: Step[] }).position ?? []) as Step[];
  const own = labelOf(neighbour, lang);
  // A sicha kept in pieces numbered 1, 2, 3 (Likkutei Sichos 30): a piece is called by its sicha, and by its number within the same one.
  const between = steps.slice(1, -1);
  const pieceOf = /^\d+$/.test(own) && between.length ? between.map((s) => nameOf(s.label, lang) || s.value) : null;
  const sameSicha = pieceOf && here.length === steps.length && here.slice(0, -1).every((s, i) => s.value === steps[i]!.value);
  const name = !pieceOf ? own : sameSicha ? `${pieceOf[pieceOf.length - 1]} (${own})` : pieceOf.join(', ');
  const volume = steps.length > 1 ? steps[0] : undefined;
  if (!volume || (here.length > 1 && here[0]!.value === volume.value)) return name;
  return `${nameOf(volume.label, lang) || volume.value}, ${name}`;
}

/**
 * A sicha's back and forth: the one before it and the one after it in its
 * sefer, as the contents order them, above its text and below it. Icons are
 * drawn for Hebrew, so "previous" points right there and left in English.
 */
export function ChapterNav({ unit, previous, next, lang, where }: { unit: Entity; previous: Entity | null; next: Entity | null; lang: Lang; where: 'top' | 'bottom' }) {
  if (!previous && !next) return null;
  return (
    // Its own class names: the site header is `.top`, and taking it made these stick over the text.
    <nav className={`chapter-nav chapter-nav-${where}`} aria-label={W.chapters[lang]}>
      {previous ? (
        <Link className="chapter-nav-link prev" to={href(itemPath(previous), lang)} rel="prev">
          <Icon name="chevr" className="flip-ltr" size={16} />
          <span className="chapter-nav-text">
            <span className="subtle">{W.previous[lang]}</span>
            <span className="chapter-nav-name">{neighbourLabel(previous, unit, lang)}</span>
          </span>
        </Link>
      ) : (
        <span className="chapter-nav-gap" />
      )}
      {next ? (
        <Link className="chapter-nav-link next" to={href(itemPath(next), lang)} rel="next">
          <span className="chapter-nav-text">
            <span className="subtle">{W.next[lang]}</span>
            <span className="chapter-nav-name">{neighbourLabel(next, unit, lang)}</span>
          </span>
          <Icon name="chev" className="flip-ltr" size={16} />
        </Link>
      ) : (
        <span className="chapter-nav-gap" />
      )}
    </nav>
  );
}
