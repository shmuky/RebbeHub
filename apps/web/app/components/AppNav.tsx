import { CalendarRange, HandHeart, House, Library, Search } from 'lucide-react';
import { Link, useLocation } from 'react-router';
import { t, type Lang } from '../lib/i18n.js';
import { href } from '../lib/links.js';

/**
 * The five tabs: this week, the farbrengens by year, the library of sets
 * and works, how to help, and search. A bar at the foot of a
 * phone's screen; a rail at the side of a wide one.
 */
const TABS = [
  { key: 'tabWeek', to: '/', icon: House },
  { key: 'tabFarbrengens', to: '/calendar', icon: CalendarRange },
  { key: 'tabLibrary', to: '/sets', icon: Library },
  { key: 'tabHelp', to: '/help', icon: HandHeart },
  { key: 'search', to: '/search', icon: Search },
] as const;

/** Which tab a page belongs to: an event is a farbrengen; any other item is in the library. */
function tabOf(pathname: string): string {
  if (pathname === '/') return '/';
  if (pathname.startsWith('/calendar') || pathname.startsWith('/events')) return '/calendar';
  if (pathname.startsWith('/search')) return '/search';
  if (pathname.startsWith('/help')) return '/help';
  // A person's own pages belong to no tab.
  if (pathname.startsWith('/signin') || pathname.startsWith('/account')) return '';
  return '/sets';
}

export function AppNav({ lang }: { lang: Lang }) {
  const { pathname } = useLocation();
  const active = tabOf(pathname);
  return (
    <nav className="app-nav" aria-label={lang === 'he' ? 'ניווט ראשי' : 'Main'}>
      <Link to={href('/', lang)} className="rail-brand" aria-label={t(lang, 'home')}>
        <span className="brand-mark" aria-hidden="true">
          ר
        </span>
      </Link>
      {TABS.map(({ key, to, icon: Icon }) => {
        const on = active === to;
        return (
          <Link key={to} to={href(to, lang)} className={on ? 'tab active' : 'tab'} aria-current={on ? 'page' : undefined}>
            <span className="tab-icon">
              <Icon size={22} strokeWidth={on ? 2.25 : 1.9} aria-hidden="true" />
            </span>
            <span className="tab-label">{t(lang, key)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
