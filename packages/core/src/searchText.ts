import { describeDateKey, normalizeSearchText, parseDateKey } from '@rebbehub/hebrew';

const TEXT_FIELDS = new Set(['he', 'en', 'yi', 'aliases', 'content', 'body', 'text', 'occasion', 'families', 'publisher', 'volume', 'placePrinted', 'label', 'slug']);
const DATE_FIELDS = new Set(['date', 'dateEnd', 'born', 'passed']);

/**
 * What the built-in search finds an item by: its names in every language,
 * aliases, labels, text, and its dates both as keys and as people write
 * them (`י׳ שבט תשמ״ב`, `10 Shevat 5742`) - all normalised the way queries
 * are, so niqqud, gershayim and case never stand in the way.
 */
export function searchTextOf(data: unknown): string {
  const parts: string[] = [];
  const walk = (value: unknown, key: string): void => {
    if (typeof value === 'string') {
      if (DATE_FIELDS.has(key) && parseDateKey(value)) parts.push(value, describeDateKey(value, 'he'), describeDateKey(value, 'en'));
      else if (TEXT_FIELDS.has(key)) parts.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item, key);
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(v, k);
    }
  };
  walk(data, '');
  return normalizeSearchText(parts.join(' ')).slice(0, 200_000);
}

/** A query as Postgres full text search takes it: every word, each as a prefix. Null when nothing is left to search for. */
export function toTsQuery(query: string): string | null {
  const words = normalizeSearchText(query)
    .split(' ')
    .filter((w) => w.length > 0)
    .slice(0, 12);
  return words.length > 0 ? words.map((w) => `${w}:*`).join(' & ') : null;
}
