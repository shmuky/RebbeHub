import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useMatches, useNavigate } from 'react-router';
import type { Lang } from '../lib/i18n.js';
import { tu, type UiKey } from '../lib/i18nUi.js';
import { href } from '../lib/links.js';
import { refreshAccount, useAccount } from '../lib/useAccount.js';
import { CommandPalette } from './CommandPalette.js';
import { Icon, type IconName } from './Icon.js';
import { Logo } from './Logo.js';
import { Avatar } from './primitives.js';
import { setTheme, useTheme, type Theme } from './theme.js';

/**
 * The frame's header, as the redesign draws it (design/README.md). On a wide
 * screen: the logo, which is the way home, the other four sections, the search box (Ctrl K opens the
 * command palette; without script it is a plain form to the search page),
 * the bell and you; Reports, Projects and the language are in your menu.
 * On a phone: the logo on the home page, or back and the page's name
 * elsewhere, with search and the bell; the five sections are tabs along the
 * bottom, where a thumb reaches them, the last one the menu.
 */

/** The sections a phone keeps as tabs at the bottom; the rest are in the menu. */
const TABS = ['/', '/sets', '/daily', '/calendar'];

/** The sections in the header and the phone's tabs. Listening is the farbrengens, where the recordings are. */
const NAV: Array<{ to: string; key: UiKey; icon: IconName }> = [
  { to: '/', key: 'navHome', icon: 'home' },
  { to: '/sets', key: 'navLibrary', icon: 'book' },
  { to: '/daily', key: 'navDaily', icon: 'cal' },
  { to: '/calendar', key: 'navListen', icon: 'audio' },
  { to: '/suggestions', key: 'navSuggestions', icon: 'suggest' },
];

/** The rest of the site's sections, in the menu. */
const MORE: Array<{ to: string; key: UiKey; icon: IconName }> = [
  { to: '/issues', key: 'navReports', icon: 'report' },
  { to: '/projects', key: 'navProjects', icon: 'target' },
];

/** Which section a page belongs to: a farbrengen to Farbrengens, any other item to the Library. */
export function sectionOf(pathname: string): string {
  if (pathname === '/') return '/';
  if (pathname.startsWith('/daily')) return '/daily';
  if (pathname.startsWith('/calendar') || pathname.startsWith('/events') || pathname.startsWith('/sets/farbrengens')) return '/calendar';
  if (pathname.startsWith('/review') || pathname.startsWith('/suggestions')) return '/suggestions';
  if (pathname.startsWith('/issues')) return '/issues';
  if (pathname.startsWith('/projects') || pathname.startsWith('/missing') || pathname.startsWith('/health') || pathname.startsWith('/help')) return '/projects';
  if (['/search', '/signin', '/account', '/inbox', '/u/', '/admin', '/about', '/takedown', '/mirrors', '/models', '/connect', '/developers', '/read', '/_'].some((p) => pathname.startsWith(p))) return '';
  return '/sets';
}

export interface PhoneHead {
  /** The phone header's title for this page ("התוועדות"). */
  title?: { he: string; en: string };
  /** Where back goes when there is no history to go back through. */
  up?: string;
}

function usePhoneHead(): PhoneHead {
  const matches = useMatches();
  for (let i = matches.length - 1; i >= 0; i--) {
    const handle = matches[i]!.handle as { phone?: PhoneHead | ((data: unknown) => PhoneHead | undefined) } | undefined;
    const phone = typeof handle?.phone === 'function' ? handle.phone(matches[i]!.data) : handle?.phone;
    if (phone) return phone;
  }
  return {};
}

function otherLangHref(lang: Lang, pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  if (lang === 'he') params.set('lang', 'en');
  else params.delete('lang');
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

function ThemeSwitch({ lang }: { lang: Lang }) {
  const theme = useTheme();
  const choices: Array<[Theme, IconName, UiKey]> = [
    ['light', 'sun', 'themeLight'],
    ['dark', 'moon', 'themeDark'],
    ['auto', 'monitor', 'themeAuto'],
  ];
  return (
    <div className="segmented theme-switch" role="radiogroup" aria-label={tu(lang, 'theme')}>
      {choices.map(([value, icon, key]) => (
        <button key={value} type="button" role="radio" aria-checked={theme === value} aria-pressed={theme === value} onClick={() => setTheme(value)} title={tu(lang, key)}>
          <Icon name={icon} size={14} />
          <span>{tu(lang, key)}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The bell: the inbox, with how many lines wait unread. The first count
 * comes with who is signed in; it is asked again on each new page and when
 * a page reads some (the `rebbehub:inbox` event).
 */
function InboxLink({ lang, first }: { lang: Lang; first: number }) {
  const [unread, setUnread] = useState(first);
  const { pathname } = useLocation();
  const seen = useRef(false);
  useEffect(() => {
    let live = true;
    const ask = () =>
      void fetch('/_/threads/inbox/count', { credentials: 'same-origin', headers: { accept: 'application/json' } })
        .then((r) => (r.ok ? (r.json() as Promise<{ unread: number }>) : null))
        .then((body) => live && body && setUnread(body.unread))
        .catch(() => undefined);
    window.addEventListener('rebbehub:inbox', ask);
    if (seen.current) ask();
    seen.current = true;
    return () => {
      live = false;
      window.removeEventListener('rebbehub:inbox', ask);
    };
  }, [pathname]);
  const label = unread ? `${tu(lang, 'notifications')} (${unread})` : tu(lang, 'notifications');
  return (
    <Link className="icon-link" to={href('/inbox', lang)} aria-label={label} title={label}>
      <Icon name="bell" />
      {unread ? <span className="dot-count">{unread > 99 ? '99+' : unread}</span> : null}
    </Link>
  );
}

/** One part of the phone's menu, under its small heading (design/ 4b). */
function MenuGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="menu-group">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/** A line of the menu: its icon and words, a count when something waits, and the arrow on. */
function MenuRow({ to, icon, label, badge, current, chevron }: { to: string; icon: IconName; label: string; badge?: number; current?: boolean; chevron: IconName }) {
  return (
    <Link className="menu-row" to={to} aria-current={current ? 'page' : undefined}>
      <Icon name={icon} />
      <span className="grow">{label}</span>
      {badge ? <span className="menu-badge">{badge > 99 ? '99+' : badge}</span> : null}
      <Icon name={chevron} />
    </Link>
  );
}

function signOut() {
  void fetch('/_/auth/sign-out', { method: 'POST', credentials: 'same-origin' }).then(() => refreshAccount());
}

function AccountMenu({ lang }: { lang: Lang }) {
  const account = useAccount();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const { pathname, search } = useLocation();
  useEffect(() => setOpen(false), [pathname, search]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  if (account === undefined) return <span className="avatar ghost" aria-hidden="true" />;
  if (!account)
    return (
      <Link className="sign-in-link" to={href('/signin', lang, { return: pathname === '/signin' ? undefined : `${pathname}${search}` })}>
        {tu(lang, 'signIn')}
      </Link>
    );
  const name = account.person.displayName;
  return (
    <div className="menu-wrap" ref={wrap}>
      <button type="button" className="account-button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label={`${tu(lang, 'account')}: ${name}`}>
        <Avatar name={name} id={account.person.id} />
      </button>
      {open ? (
        <div className="menu" role="menu">
          <div className="menu-h">
            <b>{name}</b>
            {account.person.admin ? tu(lang, 'admin') : account.person.steward ? tu(lang, 'steward') : null}
          </div>
          <Link role="menuitem" to={href('/account', lang)}>
            <Icon name="user" />
            {tu(lang, 'account')}
          </Link>
          {account.person.username ? (
            <Link role="menuitem" to={href(`/u/${account.person.username}`, lang)}>
              <Icon name="user" />
              {lang === 'he' ? 'הדף שלי' : 'Your page'}
            </Link>
          ) : null}
          <Link role="menuitem" to={href('/suggestions', lang, { q: 'author:@me' })}>
            <Icon name="suggest" />
            {lang === 'he' ? 'ההצעות שלי' : 'My suggestions'}
          </Link>
          <Link role="menuitem" to={href('/inbox', lang)}>
            <Icon name="bell" />
            {tu(lang, 'notifications')}
          </Link>
          {account.person.steward ? (
            <Link role="menuitem" to={href('/admin', lang)}>
              <Icon name="shield" />
              {tu(lang, 'admin')}
            </Link>
          ) : null}
          <hr />
          {MORE.map((n) => (
            <Link key={n.to} role="menuitem" to={href(n.to, lang)}>
              <Icon name={n.icon} />
              {tu(lang, n.key)}
            </Link>
          ))}
          <hr />
          <div className="menu-sec">{tu(lang, 'theme')}</div>
          <ThemeSwitch lang={lang} />
          <hr />
          <button type="button" role="menuitem" onClick={signOut}>
            <Icon name="logout" />
            {tu(lang, 'signOut')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Header({ lang }: { lang: Lang }) {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const account = useAccount();
  const phone = usePhoneHead();
  const [palette, setPalette] = useState<{ open: boolean; initial: string }>({ open: false, initial: '' });
  const sheet = useRef<HTMLDetailsElement>(null);
  const section = sectionOf(pathname);
  const q = pathname === '/search' ? (new URLSearchParams(search).get('q') ?? '') : '';

  // Close the phone's menu on every page change.
  useEffect(() => {
    if (sheet.current) sheet.current.open = false;
  }, [pathname, search]);

  // Keyboard: Ctrl/⌘ K or / for the palette, ? for the shortcuts, g then h/l/d/f/s/r/p to go.
  useEffect(() => {
    let g = 0;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette((p) => ({ open: !p.open, initial: '' }));
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        setPalette({ open: true, initial: '' });
      } else if (e.key === '?') {
        e.preventDefault();
        setPalette({ open: true, initial: '?' });
      } else if (e.key === 'g') g = Date.now();
      else if (Date.now() - g < 1200) {
        const to = { h: '/', l: '/sets', d: '/daily', f: '/calendar', s: '/suggestions', r: '/issues', i: '/inbox', p: '/projects' }[e.key];
        g = 0;
        if (to) navigate(href(to, lang));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lang, navigate]);

  const openPalette = (initial = '') => setPalette({ open: true, initial });
  const other = otherLangHref(lang, pathname, search);
  // The menu's arrows point on, toward the end of the line: left in Hebrew.
  const chevron: IconName = lang === 'he' ? 'chev' : 'chevr';
  const navItem = NAV.find((n) => n.to === section);
  // A page kept under another section's tab (what is missing, the catalog's health) is still called by its own name.
  const ownTitle = pathname.startsWith('/missing') ? tu(lang, 'missing') : pathname.startsWith('/health') ? tu(lang, 'health') : pathname.startsWith('/help') ? tu(lang, 'waysToHelp') : null;
  const phoneTitle = phone.title?.[lang] ?? ownTitle ?? (navItem ? tu(lang, navItem.key) : pathname === '/search' ? tu(lang, 'searchShort') : 'RebbeHub');
  const home = pathname === '/';

  return (
    <>
      <header className="top">
        <Link to={href('/', lang)} className="brand" aria-label="RebbeHub">
          <Logo size={24} />
        </Link>
        <nav className="nav" aria-label={tu(lang, 'mainNav')}>
          {NAV.filter((n) => n.to !== '/').map((n) => (
            <Link key={n.to} to={href(n.to, lang)} aria-current={section === n.to ? 'page' : undefined}>
              {tu(lang, n.key)}
            </Link>
          ))}
        </nav>
        <form
          className="search-form"
          action="/search"
          method="get"
          role="search"
          aria-label={tu(lang, 'searchShort')}
          onSubmit={(e) => {
            // With script, the box is the command palette's door.
            e.preventDefault();
            openPalette(new FormData(e.currentTarget).get('q')?.toString() ?? '');
          }}
        >
          <Icon name="search" />
          <input
            name="q"
            type="search"
            defaultValue={q}
            key={q}
            placeholder={tu(lang, 'searchLibrary')}
            aria-label={tu(lang, 'searchShort')}
            onFocus={(e) => {
              if (e.currentTarget.dataset.typed) return;
              e.currentTarget.blur();
              openPalette(e.currentTarget.value);
            }}
            onKeyDown={(e) => {
              e.currentTarget.dataset.typed = '1';
            }}
          />
          {lang === 'en' ? <input type="hidden" name="lang" value="en" /> : null}
        </form>
        <div className="top-end">
          <a className="lang" href={other} hrefLang={lang === 'he' ? 'en' : 'he'} lang={lang === 'he' ? 'en' : 'he'} aria-label={tu(lang, 'language')} title={tu(lang, 'language')}>
            {lang === 'he' ? 'English' : 'עברית'}
          </a>
          {account ? <InboxLink lang={lang} first={account.unread ?? 0} /> : null}
          <AccountMenu lang={lang} />
        </div>
      </header>

      <header className="mtop">
        {home ? (
          <Link to={href('/', lang)} className="brand" aria-label="RebbeHub">
            <Logo size={23} />
          </Link>
        ) : (
          <Link
            className="ib"
            to={href(phone.up ?? (navItem ? navItem.to : '/'), lang)}
            aria-label={tu(lang, 'back')}
            onClick={(e) => {
              const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
              if (idx > 0) {
                e.preventDefault();
                navigate(-1);
              }
            }}
          >
            <Icon name="back" />
          </Link>
        )}
        <span className="t">{home ? null : phoneTitle}</span>
        <Link
          className="ib"
          to={href('/search', lang)}
          aria-label={tu(lang, 'searchShort')}
          onClick={(e) => {
            e.preventDefault();
            openPalette();
          }}
        >
          <Icon name="search" />
        </Link>
        {account ? <InboxLink lang={lang} first={account.unread ?? 0} /> : null}
        <details className="msheet" ref={sheet}>
          <summary className="ib" aria-label={tu(lang, 'menu')}>
            <Icon name="more" />
          </summary>
          <div
            className="sheet-backdrop"
            onClick={() => {
              if (sheet.current) sheet.current.open = false;
            }}
          />
          <div className="sheet" role="dialog" aria-label={tu(lang, 'menu')}>
            <div className="sheet-h">
              <h2 className="sheet-title">{tu(lang, 'menu')}</h2>
              <button
                type="button"
                className="ib"
                aria-label={tu(lang, 'close')}
                onClick={() => {
                  if (sheet.current) sheet.current.open = false;
                }}
              >
                <Icon name="x" />
              </button>
            </div>
            {account ? (
              <Link className="me-card" to={href(account.person.username ? `/u/${account.person.username}` : '/account', lang)}>
                <Avatar name={account.person.displayName} id={account.person.id} />
                <span className="grow">
                  <b>{account.person.displayName}</b>
                  <span>{tu(lang, 'myProfile')}</span>
                </span>
                <Icon name={chevron} />
              </Link>
            ) : account === null ? (
              <Link className="me-card" to={href('/signin', lang, { return: `${pathname}${search}` })}>
                <span className="me-icon">
                  <Icon name="user" />
                </span>
                <span className="grow">
                  <b>{tu(lang, 'signIn')}</b>
                  <span>{tu(lang, 'signInWhy')}</span>
                </span>
                <Icon name={chevron} />
              </Link>
            ) : null}
            {account ? (
              <MenuGroup title={tu(lang, 'menuMine')}>
                <MenuRow to={href('/suggestions', lang, { q: lang === 'he' ? 'מצב:פתוחה מציע:@me' : 'state:open author:@me' })} icon="suggest" label={tu(lang, 'mySuggestions')} chevron={chevron} />
                <MenuRow to={href('/suggestions', lang, { q: lang === 'he' ? 'מצב:פתוחה בודק:@me' : 'state:open reviewer:@me' })} icon="check" label={tu(lang, 'toReview')} chevron={chevron} />
                <MenuRow to={href('/inbox', lang)} icon="bell" label={tu(lang, 'notifications')} badge={account.unread || undefined} chevron={chevron} />
                <MenuRow to={href('/account', lang)} icon="user" label={tu(lang, 'account')} chevron={chevron} />
                {account.person.steward ? <MenuRow to={href('/admin', lang)} icon="shield" label={tu(lang, 'admin')} chevron={chevron} /> : null}
              </MenuGroup>
            ) : null}
            <MenuGroup title={tu(lang, 'menuReading')}>
              <div className="menu-row static">
                <Icon name="sun" />
                <span className="grow">{tu(lang, 'theme')}</span>
                <ThemeSwitch lang={lang} />
              </div>
              <a className="menu-row" href={other} hrefLang={lang === 'he' ? 'en' : 'he'}>
                <Icon name="globe" />
                <span className="grow">{tu(lang, 'language')}</span>
                <span className="menu-value">{lang === 'he' ? 'עברית · English' : 'English · עברית'}</span>
                <Icon name={chevron} />
              </a>
              <MenuRow to={href('/daily', lang)} icon="cal" label={tu(lang, 'navDaily')} chevron={chevron} />
            </MenuGroup>
            <MenuGroup title={tu(lang, 'menuSite')}>
              {[...NAV.filter((n) => !TABS.includes(n.to)), ...MORE].map((n) => (
                <MenuRow key={n.to} to={href(n.to, lang)} icon={n.icon} label={tu(lang, n.key)} current={section === n.to} chevron={chevron} />
              ))}
              <MenuRow to={href('/search', lang)} icon="search" label={tu(lang, 'searchShort')} chevron={chevron} />
            </MenuGroup>
            <MenuGroup title={tu(lang, 'menuHelp')}>
              <MenuRow to={href('/help', lang)} icon="pencil" label={tu(lang, 'navHelp')} chevron={chevron} />
              <MenuRow to={href('/about', lang)} icon="info" label={tu(lang, 'about')} chevron={chevron} />
            </MenuGroup>
            {account ? (
              <div className="menu-group">
                <button type="button" className="menu-row" onClick={signOut}>
                  <Icon name="logout" />
                  <span className="grow">{tu(lang, 'signOut')}</span>
                </button>
              </div>
            ) : null}
          </div>
        </details>
      </header>

      <nav className="mtabs" aria-label={tu(lang, 'mainNav')}>
        {NAV.filter((n) => TABS.includes(n.to)).map((n) => (
          <Link key={n.to} to={href(n.to, lang)} aria-current={section === n.to ? 'page' : undefined}>
            <Icon name={n.icon} />
            <span>{tu(lang, n.key)}</span>
          </Link>
        ))}
        <button
          type="button"
          aria-current={TABS.includes(section) ? undefined : 'page'}
          onClick={() => {
            if (sheet.current) sheet.current.open = true;
          }}
        >
          <Icon name="more" />
          <span>{tu(lang, 'menu')}</span>
        </button>
      </nav>

      <CommandPalette lang={lang} account={account} open={palette.open} initial={palette.initial} onClose={() => setPalette({ open: false, initial: '' })} />
    </>
  );
}
