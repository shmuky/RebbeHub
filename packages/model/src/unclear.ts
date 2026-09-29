/**
 * Words a listener was not sure of, marked in a transcript's own text as
 * `[words?]`: the words they think they heard, in square brackets, with a
 * question mark. The mark stays in the words the site shows (a reader
 * sees them as uncertain), and a paragraph with one is no training clip,
 * since the model must not learn from a guess (core/trainingClips.ts).
 */
export const UNCLEAR_MARK = /\[([^\]\n]*?)\?\]/g;

/** Whether a paragraph has words marked unclear. */
export function hasUnclear(content: string): boolean {
  return new RegExp(UNCLEAR_MARK.source).test(content);
}

/** The places in a text marked unclear, as [from, to) character offsets, brackets included. */
export function unclearRanges(content: string): Array<{ from: number; to: number }> {
  return [...content.matchAll(new RegExp(UNCLEAR_MARK.source, 'g'))].map((m) => ({ from: m.index!, to: m.index! + m[0].length }));
}

/** Words marked unclear: `[words?]`. */
export const markUnclear = (words: string) => `[${words.replace(/^\[|\?\]$/g, '')}?]`;
