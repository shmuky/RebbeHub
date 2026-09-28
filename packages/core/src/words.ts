import { normalizeSearchText, unfinal } from '@rebbehub/hebrew';

/**
 * Words, and which words of two texts are the same (the plan, section 9:
 * "compare printings", "forced alignment for word timings"). Both need the
 * same thing: the longest run of words two sequences share, in order,
 * compared the Hebrew way (no niqqud, geresh or gershayim, final letters as
 * ordinary ones, punctuation ignored), fast enough for an hour's farbrengen.
 */

/** One word of a text: what it says, where it stands (character offsets), and the key it is compared by. */
export interface Word {
  text: string;
  from: number;
  to: number;
  /** '' for a word that is only punctuation: it never matches anything. */
  key: string;
}

/** The key two words are compared by: `ה״ה`, `ה"ה` and `הה` are one word, and so are `כך` and `ככ`. */
export function wordKey(word: string): string {
  return unfinal(normalizeSearchText(word)).replace(/\s+/g, '');
}

/** Splits a text into its words at whitespace, keeping where each stands. */
export function words(text: string): Word[] {
  const out: Word[] = [];
  const re = /\S+/g;
  for (let m = re.exec(text); m; m = re.exec(text)) out.push({ text: m[0], from: m.index, to: m.index + m[0].length, key: wordKey(m[0]) });
  return out;
}

/** Past this many cells a gap is split at words both sides have once, else matched by the plain table. */
const TABLE_CELLS = 4_000_000;

/**
 * The pairs (i, j) of `a[i]` and `b[j]` that are the same word, in order:
 * the longest common subsequence, found as patience diff does (words that
 * occur once on each side anchor the match, the gaps between anchors are
 * matched the same way, and a gap small enough by a plain table). Empty
 * keys never match.
 */
export function matchWords(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  gap(a, b, 0, a.length, 0, b.length, out, 0);
  return out;
}

function gap(a: readonly string[], b: readonly string[], a0: number, a1: number, b0: number, b1: number, out: Array<[number, number]>, depth: number): void {
  // Same words at the ends are matched straight away.
  while (a0 < a1 && b0 < b1 && a[a0] && a[a0] === b[b0]) out.push([a0++, b0++]);
  const tail: Array<[number, number]> = [];
  while (a1 > a0 && b1 > b0 && a[a1 - 1] && a[a1 - 1] === b[b1 - 1]) tail.push([--a1, --b1]);
  if (a0 < a1 && b0 < b1) {
    const n = a1 - a0;
    const m = b1 - b0;
    const anchors = n * m > TABLE_CELLS && depth < 40 ? uniqueAnchors(a, b, a0, a1, b0, b1) : [];
    if (anchors.length) {
      let [pa, pb] = [a0, b0];
      for (const [i, j] of anchors) {
        gap(a, b, pa, i, pb, j, out, depth + 1);
        out.push([i, j]);
        [pa, pb] = [i + 1, j + 1];
      }
      gap(a, b, pa, a1, pb, b1, out, depth + 1);
    } else if (n * m <= TABLE_CELLS) {
      table(a, b, a0, a1, b0, b1, out);
    } else {
      // Nothing unique to hold on to and too big for a table: match it in slices, side by side.
      const slices = Math.ceil((n * m) / TABLE_CELLS);
      for (let s = 0; s < slices; s++) {
        table(a, b, a0 + Math.floor((n * s) / slices), a0 + Math.floor((n * (s + 1)) / slices), b0 + Math.floor((m * s) / slices), b0 + Math.floor((m * (s + 1)) / slices), out);
      }
    }
  }
  for (let k = tail.length - 1; k >= 0; k--) out.push(tail[k]!);
}

/** Words that occur exactly once on each side, as pairs, cut down to the longest run in order on both sides. */
function uniqueAnchors(a: readonly string[], b: readonly string[], a0: number, a1: number, b0: number, b1: number): Array<[number, number]> {
  const count = new Map<string, { a: number; b: number; ai: number; bi: number }>();
  for (let i = a0; i < a1; i++) {
    if (!a[i]) continue;
    const c = count.get(a[i]!) ?? { a: 0, b: 0, ai: -1, bi: -1 };
    c.a++;
    c.ai = i;
    count.set(a[i]!, c);
  }
  for (let j = b0; j < b1; j++) {
    const c = b[j] ? count.get(b[j]!) : undefined;
    if (!c) continue;
    c.b++;
    c.bi = j;
  }
  const pairs = [...count.values()].filter((c) => c.a === 1 && c.b === 1).map((c) => [c.ai, c.bi] as [number, number]);
  pairs.sort((x, y) => x[0] - y[0]);
  return longestIncreasing(pairs);
}

/** The longest run of pairs whose second halves rise (patience sorting). */
function longestIncreasing(pairs: Array<[number, number]>): Array<[number, number]> {
  const tails: number[] = [];
  const back = new Array<number>(pairs.length).fill(-1);
  for (let k = 0; k < pairs.length; k++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]!]![1] < pairs[k]![1]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) back[k] = tails[lo - 1]!;
    tails[lo] = k;
  }
  const out: Array<[number, number]> = [];
  for (let k = tails.length ? tails[tails.length - 1]! : -1; k >= 0; k = back[k]!) out.push(pairs[k]!);
  return out.reverse();
}

/** The plain longest-common-subsequence table, for a gap small enough. */
function table(a: readonly string[], b: readonly string[], a0: number, a1: number, b0: number, b1: number, out: Array<[number, number]>): void {
  const n = a1 - a0;
  const m = b1 - b0;
  if (n <= 0 || m <= 0) return;
  const w = m + 1;
  const t = Math.min(n, m) < 65_535 ? new Uint16Array((n + 1) * w) : new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    const ai = a[a0 + i];
    for (let j = m - 1; j >= 0; j--) {
      t[i * w + j] = ai && ai === b[b0 + j] ? t[(i + 1) * w + j + 1]! + 1 : Math.max(t[(i + 1) * w + j]!, t[i * w + j + 1]!);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[a0 + i] && a[a0 + i] === b[b0 + j]) {
      out.push([a0 + i, b0 + j]);
      i++;
      j++;
    } else if (t[(i + 1) * w + j]! >= t[i * w + j + 1]!) i++;
    else j++;
  }
}
