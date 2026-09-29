import type { ReactNode } from 'react';
import type { Entity } from '../lib/api.js';
import { t, type Lang } from '../lib/i18n.js';
import { labelOf } from '../lib/labels.js';
import { href, itemPath } from '../lib/links.js';
import { ItemHeader } from '../ui/ItemShell.js';
import { cx, type TabItem } from '../ui/primitives.js';
import { p } from './itemParts.js';

/**
 * The pages beside an item's own (its talk page, its history, editing it,
 * all that belongs to it) share its frame: the item's name at the top,
 * where it is, and the tabs to move between the page and them - the wiki
 * model's tabs, drawn as every item page draws its tabs.
 */

export type Subpage = 'page' | 'talk' | 'history' | 'edit' | 'all';

export function subpageTabs(entity: Pick<Entity, 'id' | 'path' | 'type' | 'data'>, lang: Lang, counts: { talk?: number } = {}): TabItem[] {
  return [
    { key: 'page', label: t(lang, 'tabPage'), icon: 'file', to: href(itemPath(entity as Entity), lang) },
    { key: 'talk', label: p(lang, 'talk'), icon: 'discuss', to: href(`/talk/${entity.id}`, lang), count: counts.talk || undefined },
    { key: 'history', label: p(lang, 'history'), icon: 'history', to: href(`/history/${entity.id}`, lang) },
    { key: 'edit', label: p(lang, 'edit'), icon: 'pencil', to: href(`/edit/${entity.id}`, lang) },
  ];
}

export function ItemSubpage({
  entity,
  lang,
  current,
  here,
  counts,
  actions,
  sub,
  children,
  side,
  narrowSide,
}: {
  entity: Pick<Entity, 'id' | 'path' | 'type' | 'data'>;
  lang: Lang;
  current: Subpage;
  /** The last crumb: this page's own name. */
  here: ReactNode;
  counts?: { talk?: number };
  actions?: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  side?: ReactNode;
  narrowSide?: boolean;
}) {
  const name = labelOf(entity as Entity, lang);
  return (
    <>
      <ItemHeader
        lang={lang}
        head={{
          crumbs: [{ label: name, to: href(itemPath(entity as Entity), lang) }, { label: here }],
          title: name,
          torah: true,
          sub,
          actions,
          tabs: current === 'all' ? undefined : subpageTabs(entity, lang, counts),
          tab: current,
        }}
      />
      <div className={cx('wrap', side ? 'cols' : 'page', narrowSide && 'narrow-side')}>
        <div className="imain">{children}</div>
        {side ? (
          <aside className="side" aria-label={lang === 'he' ? 'פרטים' : 'Details'}>
            {side}
          </aside>
        ) : null}
      </div>
    </>
  );
}
