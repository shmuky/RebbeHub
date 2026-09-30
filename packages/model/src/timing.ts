/**
 * Word timings kept through a fix. A person who fixes a few words of a
 * paragraph changes only those words: every word they left as it was is
 * still heard where it was, so it keeps its time, and a word they changed
 * or added takes the time between the words kept on either side of it,
 * shared by length. So the player goes on lighting up the paragraph word
 * by word after a fix, and not only once the words are timed again from
 * the audio (a machine's timing either way, labelled as the paragraph's
 * sync is).
 */

/** One word of a paragraph with when it is heard: character offsets into the paragraph. */
export interface WordTime {
  from: number;
  to: number;
  startMs: number;
  endMs: number;
}

/** How two words are compared: letters and digits only, so a comma or quote mark added in a fix leaves the word as it was. */
const keyOf = (word: string) => word.replace(/[^\p{L}\p{N}]/gu, '');

/**
 * The word timings of `oldContent` carried over to `newContent`. Null when
 * there were none, or the new text has no words.
 */
export function carryWordTimes(oldContent: string, oldWords: readonly WordTime[] | null | undefined, newContent: string): WordTime[] | null {
  if (!oldWords?.length) return null;
  const heard = oldWords.filter((w) => w.to <= oldContent.length && w.from < w.to);
  const tokens = [...newContent.matchAll(/\S+/g)].map((m) => ({ from: m.index!, to: m.index! + m[0].length, key: keyOf(m[0]) }));
  // A paragraph of thousands of words is left to be timed again from the audio, rather than compared word against word here.
  if (!heard.length || !tokens.length || tokens.length * heard.length > 4_000_000) return null;
  const heardKeys = heard.map((w) => keyOf(oldContent.slice(w.from, w.to)));

  // The longest run of words both share, in order.
  const n = tokens.length;
  const m = heard.length;
  const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i]![j] = tokens[i]!.key && tokens[i]!.key === heardKeys[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const start = new Array<number>(n).fill(NaN);
  const end = new Array<number>(n).fill(NaN);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (tokens[i]!.key && tokens[i]!.key === heardKeys[j]) {
      start[i] = heard[j]!.startMs;
      end[i] = heard[j]!.endMs;
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) i++;
    else j++;
  }

  // The words changed or added share the time between the kept words on either side, by length.
  const first = Math.min(...heard.map((w) => w.startMs));
  const last = Math.max(...heard.map((w) => w.endMs));
  for (let i = 0; i < n; ) {
    if (!Number.isNaN(start[i]!)) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && Number.isNaN(start[j]!)) j++;
    const from = i > 0 ? end[i - 1]! : first;
    const to = j < n ? start[j]! : last;
    const span = Math.max(0, to - from);
    const chars = tokens.slice(i, j).reduce((sum, t) => sum + (t.to - t.from), 0) || 1;
    let at = from;
    for (let k = i; k < j; k++) {
      const len = (span * (tokens[k]!.to - tokens[k]!.from)) / chars;
      start[k] = at;
      end[k] = at + len;
      at += len;
    }
    i = j;
  }
  return tokens.map((t, i) => ({ from: t.from, to: t.to, startMs: Math.round(start[i]!), endMs: Math.max(Math.round(start[i]!), Math.round(end[i]!)) }));
}
