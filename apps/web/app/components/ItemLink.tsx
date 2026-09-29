import { Link } from 'react-router';
import type { Entity } from '../lib/api.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { useLang } from '../lib/useLang.js';

export function ItemLink({ item, children }: { item: Pick<Entity, 'id' | 'path' | 'type' | 'data'>; children?: React.ReactNode }) {
  const lang = useLang();
  return <Link to={href(itemPath(item), lang)}>{children ?? labelOf(item, lang)}</Link>;
}

/** Items as a list of rows, each with an optional note at its end (a date, a count). */
export function ItemList({ items, meta, after }: { items: Array<Pick<Entity, 'id' | 'path' | 'type' | 'data'>>; meta?: (item: Pick<Entity, 'id' | 'path' | 'type' | 'data'>) => React.ReactNode; after?: (item: Pick<Entity, 'id' | 'path' | 'type' | 'data'>) => React.ReactNode }) {
  const lang = useLang();
  return (
    <ul className="list">
      {items.map((item) => (
        <li key={item.id} className={after ? 'has-edit' : undefined}>
          <Link to={href(itemPath(item), lang)}>
            <span>{labelOf(item, lang)}</span>
            {meta ? <span className="meta">{meta(item)}</span> : null}
          </Link>
          {after?.(item)}
        </li>
      ))}
    </ul>
  );
}
