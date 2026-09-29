/**
 * Filters written into the search line, as GitHub's are: `מצב:פתוח
 * אוסף:"אגרות קודש" עמוד חסר`. Each filter has a Hebrew and an English
 * name, and so does each of its values; the rest is free text. Loaders
 * read the line with `parseTokens`; the TokenSearch box writes it.
 */

export interface TokenValue {
  value: string;
  he: string;
  en: string;
  /** A label colour, when the value is one (סריקה, טקסט). */
  tone?: string;
  /** How many there are, when the page knows. */
  count?: number;
}

export interface TokenKey {
  key: string;
  he: string;
  en: string;
  /** The values it takes, when they are few and known; free values otherwise. */
  values?: TokenValue[];
  /** What a free value is, shown while it is typed ("a person's username"). */
  hint?: { he: string; en: string };
}

export interface ParsedTokens {
  /** Each filter's values, by its key, in the values' own terms (`open`, not פתוח). */
  filters: Record<string, string[]>;
  /** The words that are not filters. */
  text: string;
}

const QUOTES = /^["״“”]|["״“”]$/g;

/** Splits a line into words, keeping quoted runs (`"אגרות קודש"`) whole. */
export function words(line: string): Array<{ text: string; start: number; end: number }> {
  const out: Array<{ text: string; start: number; end: number }> = [];
  const quote = (c: string) => c === '"' || c === '״' || c === '“' || c === '”';
  let i = 0;
  while (i < line.length) {
    while (i < line.length && /\s/.test(line[i]!)) i++;
    if (i >= line.length) break;
    const start = i;
    let inQuote = false;
    // A quote opens a run only at a word's start or after `key:` (״ is also the gershayim in תשי״א),
    // and closes it only before a space or the end.
    while (i < line.length && (inQuote || !/\s/.test(line[i]!))) {
      const c = line[i]!;
      if (!inQuote && quote(c) && (i === start || line[i - 1] === ':')) inQuote = true;
      else if (inQuote && quote(c) && (i + 1 >= line.length || /\s/.test(line[i + 1]!))) inQuote = false;
      i++;
    }
    out.push({ text: line.slice(start, i), start, end: i });
  }
  return out;
}

/** The key a word names, if it is a filter (`מצב:פתוח` → status). */
export function keyOf(word: string, keys: TokenKey[]): { key: TokenKey; raw: string; value: string } | null {
  const colon = word.indexOf(':');
  if (colon <= 0) return null;
  const name = word.slice(0, colon).toLowerCase();
  const key = keys.find((k) => k.key === name || k.he === name || k.en.toLowerCase() === name);
  if (!key) return null;
  return { key, raw: word.slice(0, colon), value: word.slice(colon + 1).replace(QUOTES, '') };
}

/** A value as the loader wants it: a known value's own id, else the words as typed. */
export function valueOf(key: TokenKey, value: string): string {
  const v = value.trim();
  const known = key.values?.find((x) => x.value === v || x.he === v || x.en.toLowerCase() === v.toLowerCase());
  return known ? known.value : v;
}

export function parseTokens(line: string | null | undefined, keys: TokenKey[]): ParsedTokens {
  const filters: Record<string, string[]> = {};
  const rest: string[] = [];
  for (const w of words(line ?? '')) {
    const hit = keyOf(w.text, keys);
    if (hit && hit.value) (filters[hit.key.key] ??= []).push(valueOf(hit.key, hit.value));
    else if (!hit) rest.push(w.text);
  }
  return { filters, text: rest.join(' ').trim() };
}

/** A filter as it is written in the page's language: `מצב:פתוח`, `collection:"Igros Kodesh"`. */
export function tokenText(key: TokenKey, value: string, lang: 'he' | 'en'): string {
  const known = key.values?.find((x) => x.value === value);
  const shown = known ? known[lang] : value;
  const name = lang === 'he' ? key.he : key.en;
  return `${name}:${/\s/.test(shown) ? `"${shown}"` : shown}`;
}

/** The line with one filter set to a value (or removed, given null), the rest kept as written. */
export function withToken(line: string, keys: TokenKey[], key: string, value: string | null, lang: 'he' | 'en'): string {
  const k = keys.find((x) => x.key === key)!;
  const kept = words(line)
    .filter((w) => keyOf(w.text, keys)?.key.key !== key)
    .map((w) => w.text);
  if (value !== null) kept.unshift(tokenText(k, value, lang));
  return kept.join(' ');
}
