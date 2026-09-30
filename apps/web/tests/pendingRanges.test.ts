import { describe, expect, it } from 'vitest';
import { pendingRanges } from '../app/lib/transcript.js';

/** Which words of a paragraph a waiting fix marks (lib/transcript.ts). */
describe('the words a waiting fix marks', () => {
  const words = (content: string, after: string) => pendingRanges(content, after).map((r) => content.slice(r.from, r.to).trim()).filter(Boolean);

  it('marks the words made unclear, and not the word after them', () => {
    const base = 'אז אף על פי [וואס מצד דעם?] גלות זיינען דאך';
    const heard = 'אז אף על פי וואס מצד דעם גלות זיינען דאך';
    expect(words(base, heard)).toEqual(['[', '?]']);
    expect(pendingRanges(base, heard).some((r) => base.slice(r.from, r.to).includes('ג'))).toBe(false);
  });

  it('marks a word changed, and the word beside words only added', () => {
    expect(words('ווען מען רעדט', 'ווען מען רעדט גוט')).toEqual(['ט']);
    expect(words('א מסיבת סיום', 'א מסיבה סיום').every((w) => 'מסיבת'.includes(w))).toBe(true);
  });
});
