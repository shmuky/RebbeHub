/**
 * Which words changed between two versions of a text, as a reviewer reads
 * a suggestion: the words kept, the words taken out, the words put in.
 * Words and the spaces and marks between them are separate pieces, so a
 * changed letter shows as its word changed and punctuation stays put.
 */

export type DiffPart = { kind: 'same' | 'del' | 'ins'; text: string };

/** Splits into words and the runs between them (spaces, punctuation), keeping every character. */
export function tokenize(text: string): string[] {
  return text.match(/[\p{L}\p{M}\p{N}״׳'"־-]+|[^\p{L}\p{M}\p{N}״׳'"־-]+/gu) ?? [];
}

/** Past this many pieces on both sides the table grows too large; the change is shown whole. */
const LIMIT = 4000;

export function wordDiff(before: string, after: string): DiffPart[] {
  if (before === after) return before ? [{ kind: 'same', text: before }] : [];
  const a = tokenize(before);
  const b = tokenize(after);
  // Common start and end first: most suggestions change a few words in a long passage.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart['kind'], text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  push('same', a.slice(0, start).join(''));
  if (midA.length * midB.length > LIMIT * LIMIT || midA.length > LIMIT || midB.length > LIMIT) {
    push('del', midA.join(''));
    push('ins', midB.join(''));
  } else {
    // Longest common subsequence over the changed middle.
    const n = midA.length;
    const m = midB.length;
    const table: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i]![j] = midA[i] === midB[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        push('same', midA[i]!);
        i++;
        j++;
      } else if (table[i + 1]![j]! >= table[i]![j + 1]!) push('del', midA[i++]!);
      else push('ins', midB[j++]!);
    }
    while (i < n) push('del', midA[i++]!);
    while (j < m) push('ins', midB[j++]!);
  }
  push('same', a.slice(endA).join(''));
  return tidy(parts);
}

/**
 * A lone space kept between two changes reads as noise ("<del>a</del>
 * <ins>b</ins> <del>c</del>"); it is folded into both sides so each
 * change reads as one run.
 */
function tidy(parts: DiffPart[]): DiffPart[] {
  const out: DiffPart[] = [];
  for (let k = 0; k < parts.length; k++) {
    const p = parts[k]!;
    const prev = out[out.length - 1];
    const next = parts[k + 1];
    if (p.kind === 'same' && /^\s+$/.test(p.text) && prev && prev.kind !== 'same' && next && next.kind !== 'same') {
      out.push({ kind: 'del', text: p.text }, { kind: 'ins', text: p.text });
      continue;
    }
    out.push({ ...p });
  }
  // Merge runs the fold made adjacent, keeping deletions before insertions.
  const merged: DiffPart[] = [];
  let dels = '';
  let inss = '';
  const flush = () => {
    if (dels) merged.push({ kind: 'del', text: dels });
    if (inss) merged.push({ kind: 'ins', text: inss });
    dels = inss = '';
  };
  for (const p of out) {
    if (p.kind === 'del') dels += p.text;
    else if (p.kind === 'ins') inss += p.text;
    else {
      flush();
      const last = merged[merged.length - 1];
      if (last?.kind === 'same') last.text += p.text;
      else merged.push(p);
    }
  }
  flush();
  return merged;
}

/** How many words a change adds and removes: "+2 −2 words". */
export function diffStat(parts: DiffPart[]): { added: number; removed: number } {
  const words = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;
  let added = 0;
  let removed = 0;
  for (const p of parts) {
    if (p.kind === 'ins') added += words(p.text);
    if (p.kind === 'del') removed += words(p.text);
  }
  return { added, removed };
}
