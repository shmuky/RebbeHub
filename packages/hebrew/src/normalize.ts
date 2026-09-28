/**
 * Text as a search index holds it, and as a query must be written to match
 * it:
 * - no niqqud or cantillation;
 * - no geresh, gershayim or quotes, so ה"ה and ה״ה are both הה;
 * - lower case;
 * - every other character that is not a letter or digit becomes a space.
 *
 * The same contract as Sichos-Kodesh's `normalizeSearchText`
 * (packages/app-core/src/search): an index built here answers a query
 * normalised there. Plain code only (no Unicode property escapes, no
 * `normalize`), so every JavaScript engine gives the same answer.
 */
export function normalizeSearchText(text: string): string {
  return text
    .replace(/[֑-ׇֽֿׁׂׅׄ]/g, '')
    .replace(/[׳״"'`‘’“”]/g, '')
    .toLowerCase()
    .replace(/[^0-9a-zÀ-ɏא-תװ-ײ]+/g, ' ')
    .trim();
}

/** Final letters to their ordinary forms (ך→כ ...), for comparing words whose final letter was typed as ordinary. */
export function unfinal(text: string): string {
  return text.replace(/[ךםןףץ]/g, (ch) => ({ ך: 'כ', ם: 'מ', ן: 'נ', ף: 'פ', ץ: 'צ' })[ch] ?? ch);
}
