import { Link } from 'react-router';
import type { Entity } from '../lib/api.js';
import { t, type Lang } from '../lib/i18n.js';
import { href, itemPath } from '../lib/links.js';

/**
 * A page's tabs, as on a wiki: the page itself, its talk page (the
 * conversation about it), its history, and editing it. On every item
 * page and on the three pages beside it.
 */
export function PageTabs({ entity, lang, current }: { entity: Pick<Entity, 'id' | 'path'>; lang: Lang; current: 'page' | 'talk' | 'history' | 'edit' }) {
  const tabs = [
    { key: 'page', to: href(itemPath(entity as Entity), lang), label: t(lang, 'tabPage') },
    { key: 'talk', to: href(`/talk/${entity.id}`, lang), label: t(lang, 'tabTalk') },
    { key: 'history', to: href(`/history/${entity.id}`, lang), label: t(lang, 'history') },
    { key: 'edit', to: href(`/edit/${entity.id}`, lang), label: t(lang, 'tabEdit') },
  ] as const;
  return (
    <nav className="page-tabs wiki-tabs" aria-label={t(lang, 'sections')}>
      {tabs.map((tab) => (
        <Link key={tab.key} to={tab.to} aria-current={current === tab.key ? 'page' : undefined}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
