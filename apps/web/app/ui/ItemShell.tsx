import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { Lang } from '../lib/i18n.js';
import { Icon, type IconName } from './Icon.js';
import { Breadcrumbs, Tabs, cx, type TabItem } from './primitives.js';

/**
 * Every item's page has one frame: breadcrumbs; a head with its picture
 * (a shaar, a portrait), its name, a line under it, its facts with their
 * icons, a few words about it and its actions; tabs with counts; then the
 * page's own body beside a side column of details. The item's route adds
 * what every page carries (follow, report, suggest a fix, embed) through
 * ItemSlots, so each kind of page draws only what is its own.
 */

export interface ItemFact {
  icon: IconName;
  children: ReactNode;
  key?: string;
}

export interface ItemHead {
  crumbs: Array<{ label: ReactNode; to?: string }>;
  cover?: ReactNode;
  kicker?: ReactNode;
  title: ReactNode;
  /** Set in the display face, as a sefer's or a sicha's name is. */
  torah?: boolean;
  sub?: ReactNode;
  facts?: Array<ItemFact | null | false | undefined>;
  desc?: ReactNode;
  actions?: ReactNode;
  tabs?: TabItem[];
  tab?: string;
  /** Anything under the facts (a machine label, a notice). */
  extra?: ReactNode;
}

export interface ItemSlotsValue {
  lang: Lang;
  /** Buttons every page has (follow, edit), after the page's own. */
  actions?: ReactNode;
  /** Panels under the body (suggest a fix, report, upload, embed). */
  below?: ReactNode;
  /** Sections at the end of the side column (links, sources, the permanent link). */
  side?: ReactNode;
}

export const ItemSlots = createContext<ItemSlotsValue | null>(null);

export function ItemHeader({ head, lang, flat }: { head: ItemHead; lang: Lang; flat?: boolean }) {
  const slots = useContext(ItemSlots);
  return (
    <div className={cx('phead', flat && 'flat')}>
      <div className="wrap">
        <Breadcrumbs items={head.crumbs} lang={lang} />
        <div className={cx('ihero', head.cover ? 'has-cover' : null)}>
          {head.cover ? <div className="ihero-cover">{head.cover}</div> : null}
          <div className="ihero-main">
            {head.kicker ? <p className="kicker">{head.kicker}</p> : null}
            <h1 className={cx('page-title', head.torah && 'torah')}>{head.title}</h1>
            {head.sub ? <p className="lede">{head.sub}</p> : null}
            {head.facts?.some(Boolean) ? (
              <div className="facts-row">
                {head.facts.filter((f): f is ItemFact => Boolean(f)).map((f, i) => (
                  <span key={f.key ?? i}>
                    <Icon name={f.icon} className="subtle" />
                    <span>{f.children}</span>
                  </span>
                ))}
              </div>
            ) : null}
            {head.extra}
            {head.desc ? <div className="ihero-desc">{head.desc}</div> : null}
          </div>
          {head.actions || slots?.actions ? (
            <div className="phead-acts">
              {slots?.actions}
              {head.actions}
            </div>
          ) : null}
        </div>
        {head.tabs?.length ? <Tabs items={head.tabs} current={head.tab ?? head.tabs[0]!.key} label={lang === 'he' ? 'חלקי העמוד' : 'Sections'} /> : null}
      </div>
    </div>
  );
}

/**
 * "Report a problem", "Suggest a fix": a link to a panel's id opens the
 * panel and brings it into view, from the page's own buttons and from a
 * link that arrives with the hash.
 */
export function useHashPanels() {
  useEffect(() => {
    const open = (id: string) => {
      const el = id ? document.getElementById(id) : null;
      if (!(el instanceof HTMLDetailsElement)) return false;
      el.open = true;
      el.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      el.querySelector<HTMLElement>('input, textarea, select, button:not([type=button])')?.focus({ preventScroll: true });
      return true;
    };
    open(decodeURIComponent(location.hash.slice(1)));
    const onHash = () => open(decodeURIComponent(location.hash.slice(1)));
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.('a[href^="#"]');
      if (a && open(decodeURIComponent(a.getAttribute('href')!.slice(1)))) {
        e.preventDefault();
        history.replaceState(history.state, '', a.getAttribute('href')!);
      }
    };
    window.addEventListener('hashchange', onHash);
    document.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('click', onClick);
    };
  }, []);
}

export function ItemShell({ head, lang, children, side, wide }: { head: ItemHead; lang: Lang; children: ReactNode; side?: ReactNode; wide?: boolean }) {
  const slots = useContext(ItemSlots);
  useHashPanels();
  const hasSide = Boolean(side || slots?.side);
  return (
    <>
      <ItemHeader head={head} lang={lang} />
      <div className={cx('wrap', hasSide ? 'cols' : 'page', wide && 'wide-side')}>
        <div className="imain">
          {children}
          {slots?.below ? <div className="below">{slots.below}</div> : null}
        </div>
        {hasSide ? (
          <aside className="side" aria-label={lang === 'he' ? 'פרטים' : 'Details'}>
            {side}
            {slots?.side}
          </aside>
        ) : null}
      </div>
    </>
  );
}
