import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useMatches, useNavigate } from 'react-router';
import type { Lang } from '../lib/i18n.js';
import { tu, type UiKey } from '../lib/i18nUi.js';
import { href } from '../lib/links.js';
import { refreshAccount, useAccount } from '../lib/useAccount.js';
import { CommandPalette } from './CommandPalette.js';
import { Icon, type IconName } from './Icon.js';
import { Avatar } from './primitives.js';
import { setTheme, useTheme, type Theme } from './theme.js';

/**
 * The frame's header. On a wide screen: the mark, the six sections, the
 * search box (Ctrl K opens the command palette; without script it is a
 * plain form to the search page), the language, what you follow, and you.
 * On a phone: back, the section's name, search, and a menu sheet.
 */

const NAV: Array<{ to: string; key: UiKey; icon: IconName }> = [
  { to: '/', key: 'navHome', icon: 'home' },
  { to: '/sets', key: 'navLibrary', icon: 'book' },
  { to: '/calendar', key: 'navFarbrengens', icon: 'cal' },
  { to: '/review', key: 'navSuggestions', icon: 'suggest' },
  { to: '/reports', key: 'navReports', icon: 'report' },
  { to: '/projects', key: 'navProjects', icon: 'target' },
];

/** Which section a page belongs to: a farbrengen to Farbrengens, any other item to the Library. */
export function sectionOf(pathname: string): string {
  if (pathname === '/') return '/';
  if (pathname.startsWith('/calendar') || pathname.startsWith('/events') || pathname.startsWith('/sets/farbrengens')) return '/calendar';
  if (pathname.startsWith('/review')) return '/review';
  if (pathname.startsWith('/reports')) return '/reports';
  if (pathname.startsWith('/projects') || pathname.startsWith('/missing') || pathname.startsWith('/health') || pathname.startsWith('/help')) return '/projects';
  if (['/search', '/signin', '/account', '/admin', '/about', '/takedown', '/mirrors', '/read', '/_'].some((p) => pathname.startsWith(p))) return '';
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
          <Link role="menuitem" to={href('/review', lang, { q: lang === 'he' ? 'מחבר:אני' : 'author:me' })}>
            <Icon name="suggest" />
            {lang === 'he' ? 'ההצעות שלי' : 'My suggestions'}
          </Link>
          <Link role="menuitem" to={href('/account', lang, { tab: 'follows' })}>
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

  // Keyboard: Ctrl/⌘ K or / for the palette, ? for the shortcuts, g then h/l/f/s/r/p to go.
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
        const to = { h: '/', l: '/sets', f: '/calendar', s: '/review', r: '/reports', p: '/projects' }[e.key];
        g = 0;
        if (to) navigate(href(to, lang));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lang, navigate]);

  const openPalette = (initial = '') => setPalette({ open: true, initial });
  const other = otherLangHref(lang, pathname, search);
  const navItem = NAV.find((n) => n.to === section);
  const phoneTitle = phone.title?.[lang] ?? (navItem ? tu(lang, navItem.key) : pathname === '/search' ? tu(lang, 'searchShort') : 'RebbeHub');
  const home = pathname === '/';

  return (
    <>
      <header className="top">
        <Link to={href('/', lang)} className="brand" aria-label="RebbeHub">
          <span className="mark" aria-hidden="true">
            ר
          </span>
          RebbeHub
        </Link>
        <nav className="nav" aria-label={tu(lang, 'mainNav')}>
          {NAV.map((n) => (
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
            placeholder={tu(lang, 'searchPlaceholder')}
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
          <span className="kbds" aria-hidden="true">
            <kbd>Ctrl</kbd>
            <kbd>K</kbd>
          </span>
        </form>
        <div className="top-end">
          <a className="lang" href={other} hrefLang={lang === 'he' ? 'en' : 'he'} aria-label={tu(lang, 'language')}>
            {lang === 'he' ? (
              <>
                <b>עב</b> · EN
              </>
            ) : (
              <>
                עב · <b>EN</b>
              </>
            )}
          </a>
          {account ? (
            <Link className="icon-link" to={href('/account', lang, { tab: 'follows' })} aria-label={tu(lang, 'notifications')} title={tu(lang, 'notifications')}>
              <Icon name="bell" />
            </Link>
          ) : null}
          <AccountMenu lang={lang} />
        </div>
      </header>

      <header className="mtop">
        {home ? (
          <Link to={href('/', lang)} className="brand" aria-label="RebbeHub">
            <span className="mark" aria-hidden="true">
              ר
            </span>
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
        <span className="t">{phoneTitle}</span>
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
              <Link to={href('/', lang)} className="brand">
                <span className="mark" aria-hidden="true">
                  ר
                </span>
                RebbeHub
              </Link>
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
            <nav aria-label={tu(lang, 'mainNav')}>
              {NAV.map((n) => (
                <Link key={n.to} to={href(n.to, lang)} aria-current={section === n.to ? 'page' : undefined}>
                  <Icon name={n.icon} />
                  {tu(lang, n.key)}
                </Link>
              ))}
              <Link to={href('/search', lang)}>
                <Icon name="search" />
                {tu(lang, 'searchShort')}
              </Link>
            </nav>
            <hr />
            <nav aria-label={tu(lang, 'account')}>
              {account ? (
                <>
                  <Link to={href('/account', lang)}>
                    <Avatar name={account.person.displayName} id={account.person.id} size="sm" />
                    {account.person.displayName}
                  </Link>
                  <Link to={href('/account', lang, { tab: 'follows' })}>
                    <Icon name="bell" />
                    {tu(lang, 'notifications')}
                  </Link>
                  {account.person.steward ? (
                    <Link to={href('/admin', lang)}>
                      <Icon name="shield" />
                      {tu(lang, 'admin')}
                    </Link>
                  ) : null}
                </>
              ) : account === null ? (
                <Link to={href('/signin', lang, { return: `${pathname}${search}` })}>
                  <Icon name="user" />
                  {tu(lang, 'signIn')}
                </Link>
              ) : null}
              <a href={other} hrefLang={lang === 'he' ? 'en' : 'he'}>
                <Icon name="globe" />
                {lang === 'he' ? 'English' : 'עברית'}
              </a>
            </nav>
            <div className="sheet-sec">{tu(lang, 'theme')}</div>
            <div className="sheet-theme">
              <ThemeSwitch lang={lang} />
            </div>
            {account ? (
              <nav>
                <button type="button" onClick={signOut}>
                  <Icon name="logout" />
                  {tu(lang, 'signOut')}
                </button>
              </nav>
            ) : null}
          </div>
        </details>
      </header>

      <CommandPalette lang={lang} account={account} open={palette.open} initial={palette.initial} onClose={() => setPalette({ open: false, initial: '' })} />
    </>
  );
}
