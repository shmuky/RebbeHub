import type { Lang } from './i18n.js';

/** A link within the site, keeping the page's language. */
export function href(path: string, lang: Lang, params: Record<string, string | undefined> = {}): string {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') query.set(k, v);
  if (lang === 'en') query.set('lang', 'en');
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

/** Where an item lives: its readable path, or its permanent id. */
export const itemPath = (item: { id: string; path: string | null }) => item.path ?? `/${item.id}`;

/** Where a set is browsed: the farbrengens by year on their own tab, any other set on its page. */
export const setPath = (set: { id: string; path: string | null }) => (set.path === '/sets/farbrengens' ? '/calendar' : itemPath(set));

/**
 * Where a source's copy is read or heard, when RebbeHub links rather than
 * holds it. Unknown sources and ids give no link rather than a wrong one.
 */
export function sourceUrl(copy: { source: string; sourceId: string; url?: string }): string | null {
  if (copy.url) return copy.url;
  const id = copy.sourceId;
  switch (copy.source) {
    case 'sefaria':
      return `https://www.sefaria.org/${encodeURIComponent(id.replace(/ /g, '_')).replace(/%2C/g, ',')}`;
    case 'hebrewbooks':
      return /^\d+$/.test(id) ? `https://hebrewbooks.org/${id}` : `https://hebrewbooks.org/home.aspx?search=${encodeURIComponent(id)}`;
    case 'chabadlibrary':
      return /^\d+$/.test(id) ? `https://chabadlibrary.org/books/${id}` : null;
    case 'mafteiach':
      return 'https://mafteiach.app';
    default:
      return /^https?:\/\//.test(id) ? id : null;
  }
}

export const SOURCE_NAMES: Record<string, { he: string; en: string }> = {
  sefaria: { he: 'ספריא', en: 'Sefaria' },
  hebrewbooks: { he: 'היברו בוקס', en: 'HebrewBooks' },
  chabadlibrary: { he: 'ספריית חב״ד', en: 'Chabad Library' },
  mafteiach: { he: 'מפתח', en: 'Mafteiach' },
  other: { he: 'מקור', en: 'Source' },
  jem: { he: 'JEM', en: 'JEM' },
  'igros-app': { he: 'אגרות קודש', en: 'Igros Kodesh app' },
  kehot: { he: 'קה״ת', en: 'Kehot' },
  nli: { he: 'הספרייה הלאומית', en: 'National Library of Israel' },
  'chabad-org': { he: 'chabad.org', en: 'chabad.org' },
  youtube: { he: 'YouTube', en: 'YouTube' },
  contribution: { he: 'תרומה', en: 'Contribution' },
  isbn: { he: 'ISBN', en: 'ISBN' },
  oclc: { he: 'OCLC', en: 'OCLC' },
  otzar: { he: 'אוצר החכמה', en: 'Otzar HaChochma' },
};

/**
 * A long link or id as a short label a phone can show: a web address as
 * its host and "…" (`drive.google.com/…`), any other long unbroken id cut
 * with "…". The whole value stays in the link and its title.
 */
export function shortLabel(value: string, max = 24): string {
  const text = value.trim();
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      const host = url.hostname.replace(/^www\./, '');
      return url.pathname === '/' && !url.search && !url.hash ? host : `${host}/…`;
    } catch {
      // Not a valid address after all: cut it like any other id.
    }
  }
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
