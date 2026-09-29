/**
 * What people write in comments, reviews, suggestions and reports, read
 * the way GitHub reads it: `@mendy` names a person, `#12` a Suggestion or a
 * Report, `rh-7k2m9q4d` an item, and "Fixes #12" in a suggestion says that
 * approving it settles Report 12. The API reads it to tell the people
 * named and to link the conversations; the site reads it the same way to
 * draw the links. Words between backquotes are code and are left alone.
 */

export type Token =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'mention'; username: string; text: string }
  | { kind: 'ref'; number: number; text: string }
  | { kind: 'item'; id: string; text: string }
  | { kind: 'url'; url: string; text: string };

const HANDLE = '[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}';

/**
 * One pass over the text: code spans first (so nothing inside them counts),
 * then addresses, then items, mentions and numbers, each only where it
 * stands as a word of its own: `name@example.com` mentions nobody, and
 * `a#1` refers to nothing.
 */
const PATTERN = new RegExp(
  [
    '(`[^`\\n]+`)',
    '(https?:\\/\\/[^\\s<>"]*[^\\s<>".,;:!?)\\]\'])',
    '(?<![A-Za-z0-9_-])(rh-[0-9a-hjkmnp-tv-z]{6,16})(?![A-Za-z0-9])',
    `(?<![A-Za-z0-9_@./\\\\-])@(${HANDLE})(?![A-Za-z0-9@-])`,
    '(?<![A-Za-z0-9_&#/\\\\-])#(\\d{1,9})(?![A-Za-z0-9])',
  ].join('|'),
  'g',
);

export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  const push = (token: Token) => {
    const last = tokens[tokens.length - 1];
    if (token.kind === 'text' && last?.kind === 'text') last.text += token.text;
    else tokens.push(token);
  };
  for (const match of text.matchAll(PATTERN)) {
    const start = match.index;
    if (start > at) push({ kind: 'text', text: text.slice(at, start) });
    const [whole, code, url, item, handle, number] = match;
    if (code) push({ kind: 'code', text: code.slice(1, -1) });
    else if (url) push({ kind: 'url', url, text: url });
    else if (item) push({ kind: 'item', id: item, text: item });
    else if (handle) push({ kind: 'mention', username: handle, text: whole });
    else if (number) push({ kind: 'ref', number: Number(number), text: whole });
    at = start + whole.length;
  }
  if (at < text.length) push({ kind: 'text', text: text.slice(at) });
  return tokens;
}

/** The handles written in a text, lower-case, each once. */
export function mentionsIn(text: string): string[] {
  return [...new Set(tokenize(text).flatMap((t) => (t.kind === 'mention' ? [t.username.toLowerCase()] : [])))];
}

/** Words that, just before `#12`, say a Suggestion settles Report 12 (as on GitHub, and in Hebrew). */
const CLOSING = /(?:^|[^\p{L}])(close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved|סוגר|סוגרת|פותר|פותרת|מתקן|מתקנת)\s*:?\s+$/iu;

/** The numbers written in a text, each once, and whether a closing word came just before it ("Fixes #12"). */
export function referencesIn(text: string): Array<{ number: number; closes: boolean }> {
  const found = new Map<number, boolean>();
  let before = '';
  for (const token of tokenize(text)) {
    if (token.kind === 'ref') {
      const closes = CLOSING.test(before);
      found.set(token.number, (found.get(token.number) ?? false) || closes);
      before = '';
    } else {
      before = token.kind === 'text' ? before + token.text : '';
    }
  }
  return [...found].map(([number, closes]) => ({ number, closes }));
}

/** The items written in a text by their ids, each once. */
export function itemsIn(text: string): string[] {
  return [...new Set(tokenize(text).flatMap((t) => (t.kind === 'item' ? [t.id] : [])))];
}
