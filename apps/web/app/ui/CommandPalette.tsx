import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { Lang } from '../lib/i18n.js';
import { tu } from '../lib/i18nUi.js';
import { href } from '../lib/links.js';
import { refreshAccount, type SignedIn } from '../lib/useAccount.js';
import { Icon, type IconName } from './Icon.js';
import { useToast } from './Toast.js';
import { setTheme } from './theme.js';

/**
 * Ctrl K (or /): one box for going anywhere and doing anything. It finds
 * items in the catalog as one types, suggestions by title or number
 * ("#1284"), and for stewards reports and people; and it holds the
 * site's commands (language, appearance, copy link, sign out). Arrow keys
 * move, Enter opens, Escape closes. "?" lists the keyboard shortcuts.
 */

interface Entry {
  id: string;
  section: 'commands' | 'pages' | 'items' | 'suggestions' | 'reports' | 'people' | 'keys';
  icon: IconName;
  title: ReactNode;
  sub?: ReactNode;
  hint?: ReactNode;
  keywords: string;
  run: () => void;
}

interface Found {
  id: string;
  path: string;
  label: string;
  kind: string;
  type: string;
  date: string | null;
}

interface SuggestionRow {
  id: number;
  title: string;
  status: string;
}

interface ReportRow {
  id: number;
  reason: string;
  note: string | null;
  entity_id: string | null;
}

const ICON_OF_TYPE: Record<string, IconName> = { event: 'cal', recording: 'audio', unit: 'file', work: 'book', set: 'layers', publication: 'scan', author: 'user', 'text-page': 'file', video: 'video' };

const SECTION_KEY = { commands: 'paletteCommands', pages: 'palettePages', items: 'paletteItems', suggestions: 'paletteSuggestions', reports: 'paletteReports', people: 'palettePeople', keys: 'keyboard' } as const;

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[֑-ׇ]/g, '')
    .replace(/["״׳']/g, '');
}

export function CommandPalette({ lang, account, open, onClose, initial = '' }: { lang: Lang; account: SignedIn | null | undefined; open: boolean; onClose: () => void; initial?: string }) {
  const [q, setQ] = useState(initial);
  const [active, setActive] = useState(0);
  const [found, setFound] = useState<Found[]>([]);
  const [date, setDate] = useState<{ key: string; label: string } | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestionRow[] | null>(null);
  const [reports, setReports] = useState<ReportRow[] | null>(null);
  const [people, setPeople] = useState<Array<{ id: string; displayName: string; username?: string | null }>>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const steward = Boolean(account?.person.steward);

  useEffect(() => {
    if (!open) return;
    setQ(initial);
    setActive(0);
    requestAnimationFrame(() => input.current?.focus());
    // Suggestions are public; reports are for stewards. Asked once, when first opened.
    if (suggestions === null)
      void fetch('/_/suggestions?status=open&limit=200', { headers: { accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : { suggestions: [] }))
        .then((b: { suggestions?: SuggestionRow[] }) => setSuggestions(b.suggestions ?? []))
        .catch(() => setSuggestions([]));
    if (steward && reports === null)
      void fetch('/_/steward/reports', { headers: { accept: 'application/json' }, credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : { reports: [] }))
        .then((b: { reports?: ReportRow[] }) => setReports(b.reports ?? []))
        .catch(() => setReports([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // The catalog, as one types, a moment after the last key.
  useEffect(() => {
    if (!open) return;
    const text = q.trim();
    if (text.length < 2 || text.startsWith('#') || text === '?') {
      setFound([]);
      setDate(null);
      return;
    }
    setBusy(true);
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      void fetch(href('/_/find', lang, { q: text }), { signal: ctrl.signal, headers: { accept: 'application/json' } })
        .then((r) => r.json() as Promise<{ items: Found[]; date: { key: string; label: string } | null }>)
        .then((b) => {
          setFound(b.items);
          setDate(b.date);
        })
        .catch(() => {})
        .finally(() => setBusy(false));
      if (steward)
        void fetch(`/_/steward/admin/people?q=${encodeURIComponent(text)}`, { signal: ctrl.signal, credentials: 'same-origin', headers: { accept: 'application/json' } })
          .then((r) => (r.ok ? r.json() : { people: [] }))
          .then((b: { people?: Array<{ id: string; displayName?: string; display_name?: string; username?: string | null }> }) => setPeople((b.people ?? []).slice(0, 5).map((p) => ({ id: p.id, displayName: p.displayName ?? p.display_name ?? p.id, username: p.username }))))
          .catch(() => {});
    }, 160);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, open, lang, steward]);

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  const entries: Entry[] = useMemo(() => {
    const text = q.trim();
    const n = norm(text);
    const out: Entry[] = [];
    if (text === '?') {
      const keys: Array<[string, string]> = [
        ['Ctrl K', tu(lang, 'shortcutsPalette')],
        ['/', tu(lang, 'shortcutsPalette')],
        ['g h', tu(lang, 'shortcutsGoHome')],
        ['g l', tu(lang, 'shortcutsGoLibrary')],
        ['g s', tu(lang, 'shortcutsGoSuggestions')],
        ['g r', tu(lang, 'shortcutsGoReports')],
        ['?', tu(lang, 'shortcutsHelp')],
      ];
      return keys.map(([k, what]) => ({ id: `key-${k}`, section: 'keys', icon: 'keyboard', title: what, hint: <span className="kbds">{k.split(' ').map((x, i) => <kbd key={i}>{x}</kbd>)}</span>, keywords: '', run: () => {} }));
    }
    const match = (s: string) => !n || norm(s).includes(n);

    // "#1284": straight to that suggestion.
    const num = /^#?(\d{1,7})$/.exec(text);
    if (num) out.push({ id: `goto-${num[1]}`, section: 'suggestions', icon: 'suggest', title: `${tu(lang, 'paletteGoSuggestion')} #${num[1]}`, keywords: '', run: () => go(href('/review', lang, { s: num[1] })) });

    const other = lang === 'he' ? 'en' : 'he';
    const langHref = (() => {
      const p = new URLSearchParams(location.search);
      if (other === 'en') p.set('lang', 'en');
      else p.delete('lang');
      const s = p.toString();
      return `${location.pathname}${s ? `?${s}` : ''}`;
    })();
    const commands: Entry[] = [
      { id: 'lang', section: 'commands', icon: 'globe', title: other === 'en' ? 'English' : 'עברית', sub: tu(lang, 'language'), keywords: 'language שפה english עברית', run: () => go(langHref) },
      { id: 'theme-light', section: 'commands', icon: 'sun', title: `${tu(lang, 'theme')}: ${tu(lang, 'themeLight')}`, keywords: 'theme light מראה בהיר', run: () => (setTheme('light'), onClose()) },
      { id: 'theme-dark', section: 'commands', icon: 'moon', title: `${tu(lang, 'theme')}: ${tu(lang, 'themeDark')}`, keywords: 'theme dark מראה כהה', run: () => (setTheme('dark'), onClose()) },
      { id: 'theme-auto', section: 'commands', icon: 'monitor', title: `${tu(lang, 'theme')}: ${tu(lang, 'themeAuto')}`, keywords: 'theme system device auto מראה מכשיר', run: () => (setTheme('auto'), onClose()) },
      {
        id: 'copy',
        section: 'commands',
        icon: 'link',
        title: tu(lang, 'copyLink'),
        keywords: 'copy link share העתקה קישור',
        run: () => {
          void navigator.clipboard?.writeText(window.location.href).then(() => toast(tu(lang, 'copied')));
          onClose();
        },
      },
      { id: 'keys', section: 'commands', icon: 'keyboard', title: tu(lang, 'keyboard'), hint: <kbd>?</kbd>, keywords: 'keyboard shortcuts קיצורים מקלדת', run: () => setQ('?') },
    ];
    if (typeof document !== 'undefined' && document.getElementById('report'))
      commands.unshift({ id: 'report', section: 'commands', icon: 'report', title: lang === 'he' ? 'דיווח על בעיה בעמוד הזה' : 'Report a problem on this page', keywords: 'report problem דיווח בעיה', run: () => go(`${location.pathname}${location.search}#report`) });
    if (typeof document !== 'undefined' && document.getElementById('suggest'))
      commands.unshift({ id: 'suggest', section: 'commands', icon: 'suggest', title: lang === 'he' ? 'הצעת תיקון לעמוד הזה' : 'Suggest a fix to this page', keywords: 'suggest fix edit הצעה תיקון', run: () => go(`${location.pathname}${location.search}#suggest`) });
    if (account)
      commands.push({
        id: 'signout',
        section: 'commands',
        icon: 'logout',
        title: tu(lang, 'signOut'),
        keywords: 'sign out logout יציאה',
        run: () => {
          void fetch('/_/auth/sign-out', { method: 'POST', credentials: 'same-origin' }).then(() => refreshAccount());
          onClose();
        },
      });
    else if (account === null) commands.push({ id: 'signin', section: 'commands', icon: 'user', title: tu(lang, 'signIn'), keywords: 'sign in login כניסה', run: () => go(href('/signin', lang, { return: location.pathname })) });

    const pages: Array<[string, IconName, string, string]> = [
      ['/', 'home', tu(lang, 'navHome'), 'home בית'],
      ['/sets', 'book', tu(lang, 'navLibrary'), 'library sets ספרייה'],
      ['/calendar', 'cal', tu(lang, 'navFarbrengens'), 'farbrengens calendar התוועדויות לוח'],
      ['/daily', 'book', lang === 'he' ? 'לימוד יומי' : 'Daily learning', 'daily learning chitas tanya hayom yom לימוד יומי חת״ת חתת תניא היום יום'],
      ['/review', 'suggest', tu(lang, 'navSuggestions'), 'suggestions review הצעות'],
      ['/reports', 'report', tu(lang, 'navReports'), 'reports issues דיווחים'],
      ['/projects', 'target', tu(lang, 'navProjects'), 'projects פרויקטים'],
      ['/missing', 'search', tu(lang, 'missing'), 'missing חסר'],
      ['/health', 'pulse', tu(lang, 'health'), 'health מצב'],
      ['/help', 'heart', tu(lang, 'contribute'), 'help contribute עזרה'],
      ['/search', 'search', tu(lang, 'searchShort'), 'search חיפוש'],
      ['/mirrors', 'database', tu(lang, 'mirrors'), 'mirrors download הורדה'],
      ['/about', 'info', tu(lang, 'about'), 'about אודות'],
      ['/takedown', 'shield', tu(lang, 'takedown'), 'takedown הסרה'],
      ['/connect', 'bot', lang === 'he' ? 'חיבור ל-Claude ול-ChatGPT' : 'Connect Claude or ChatGPT', 'connect claude chatgpt mcp ai agent חיבור בינה'],
    ];
    if (account) pages.push(['/account', 'user', tu(lang, 'account'), 'account settings חשבון'], ['/account/developers', 'code', lang === 'he' ? 'טוקנים ו-webhooks' : 'API tokens and webhooks', 'tokens webhooks developers api טוקן']);
    if (steward) pages.push(['/admin', 'shield', tu(lang, 'admin'), 'admin ניהול']);

    const pageEntries: Entry[] = pages.map(([path, icon, title, kw]) => ({ id: `page-${path}`, section: 'pages', icon, title, keywords: `${title} ${kw}`, run: () => go(href(path, lang)) }));

    if (n) {
      out.push(...commands.filter((c) => match(c.keywords) || match(String(c.title))));
      out.push(...pageEntries.filter((p) => match(p.keywords)));
    } else {
      out.push(...pageEntries.slice(0, 6), ...commands.slice(0, 4));
    }

    if (date) out.push({ id: `date-${date.key}`, section: 'items', icon: 'cal', title: date.label, sub: lang === 'he' ? 'תאריך · כל מה שנאמר בו' : 'Date · everything on it', keywords: '', run: () => go(href('/search', lang, { q: text })) });
    for (const f of found) out.push({ id: `item-${f.id}`, section: 'items', icon: ICON_OF_TYPE[f.type] ?? 'file', title: f.label, sub: [f.kind, f.date].filter(Boolean).join(' · '), keywords: '', run: () => go(href(f.path, lang)) });
    if (text.length >= 2 && !num) out.push({ id: 'search-all', section: 'items', icon: 'search', title: `${tu(lang, 'paletteSearchAll')} "${text}"`, hint: <kbd>↵</kbd>, keywords: '', run: () => go(href('/search', lang, { q: text })) });

    if (n && suggestions)
      for (const s of suggestions.filter((s) => match(`${s.title} ${s.id}`) || (num && String(s.id).startsWith(num[1]!))).slice(0, 5))
        out.push({ id: `s-${s.id}`, section: 'suggestions', icon: 'suggest', title: s.title, hint: <span className="num">#{s.id}</span>, keywords: '', run: () => go(href('/review', lang, { s: String(s.id) })) });
    if (n && reports)
      for (const r of reports.filter((r) => match(`${r.reason} ${r.note ?? ''} ${r.id}`)).slice(0, 5))
        out.push({ id: `r-${r.id}`, section: 'reports', icon: 'report', title: r.note || r.reason, hint: <span className="num">#{r.id}</span>, keywords: '', run: () => go(href('/reports', lang, { r: String(r.id) })) });
    if (n) for (const p of people) out.push({ id: `p-${p.id}`, section: 'people', icon: 'user', title: p.displayName, sub: p.username ? `@${p.username}` : undefined, keywords: '', run: () => go(href('/admin', lang, { q: p.displayName })) });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, found, date, suggestions, reports, people, account, lang, location.pathname, location.search]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  const sections: Array<[Entry['section'], Entry[]]> = [];
  for (const e of entries) {
    const last = sections[sections.length - 1];
    if (last && last[0] === e.section) last[1].push(e);
    else sections.push([e.section, [e]]);
  }
  let index = -1;

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label={tu(lang, 'openPalette')}>
        <div className="palette-in">
          <Icon name={busy ? 'loader' : 'search'} className={busy ? 'spin' : undefined} />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tu(lang, 'paletteHint')}
            aria-label={tu(lang, 'searchShort')}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={entries[active] ? `pal-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActive((a) => Math.min(a + 1, entries.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(a - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const pick = entries[active];
                if (pick) pick.run();
                else if (q.trim()) go(href('/search', lang, { q: q.trim() }));
              } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
              } else if (e.key === 'Home' && e.ctrlKey) setActive(0);
            }}
          />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" ref={list} aria-label={tu(lang, 'openPalette')}>
          {entries.length === 0 ? <div className="palette-empty">{busy ? tu(lang, 'loading') : tu(lang, 'paletteNone')}</div> : null}
          {sections.map(([section, items]) => (
            <div key={section} role="group" aria-label={tu(lang, SECTION_KEY[section])}>
              <div className="palette-sec">{tu(lang, SECTION_KEY[section])}</div>
              {items.map((e) => {
                index++;
                const i = index;
                return (
                  <div
                    key={e.id}
                    id={`pal-${i}`}
                    role="option"
                    aria-selected={i === active}
                    className="palette-o"
                    onMouseMove={() => active !== i && setActive(i)}
                    onClick={() => e.run()}
                  >
                    <Icon name={e.icon} />
                    <span className="grow">
                      <span className="t">{e.title}</span>
                      {e.sub ? <span className="s">{e.sub}</span> : null}
                    </span>
                    {e.hint ? <span className="k">{e.hint}</span> : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="palette-f">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> {tu(lang, 'paletteNavigate')}
          </span>
          <span>
            <kbd>↵</kbd> {tu(lang, 'paletteOpen')}
          </span>
          <span>
            <kbd>Esc</kbd> {tu(lang, 'paletteClose')}
          </span>
          <span>
            <kbd>#</kbd> {tu(lang, 'paletteSuggestions')}
          </span>
          <span>
            <kbd>?</kbd> {tu(lang, 'keyboard')}
          </span>
        </div>
      </div>
    </div>
  );
}
