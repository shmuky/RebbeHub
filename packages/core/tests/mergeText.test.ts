import { describe, expect, it } from 'vitest';
import { mergeText, threeWayMerge, type Json } from '@rebbehub/core';

/** Two fixes of one text, merged word by word (merge.ts): only a change of the same words is a clash. */

const base = 'אזוי ווי מען דארף בהדליק נר של חנוכה, א פסח מוסף ובחוץ, ליכתל';

describe('merging two fixes of one text', () => {
  it('keeps both where they change different words', () => {
    const ours = base.replace('בהדליק', 'להדליק');
    const theirs = base.replace('א פסח', 'על פתח').replace('ליכתל', 'ליכטל');
    expect(mergeText(base, ours, theirs)).toBe('אזוי ווי מען דארף להדליק נר של חנוכה, על פתח מוסף ובחוץ, ליכטל');
  });

  it('takes a change made on both sides once', () => {
    const both = base.replace('ליכתל', 'ליכטל');
    expect(mergeText(base, both, both.replace('ווי', 'וויל'))).toBe(both.replace('ווי', 'וויל'));
  });

  it('keeps words added beside a changed word', () => {
    expect(mergeText(base, base.replace('נר של', 'נר און של'), base.replace('חנוכה', 'חנוכּה'))).toBe(base.replace('נר של', 'נר און של').replace('חנוכה', 'חנוכּה'));
  });

  it('leaves the same words changed two ways to a person', () => {
    expect(mergeText('יראת שמים', 'ירא שמים', 'יראה שמים')).toBeNull();
    expect(mergeText('א ב', 'א ג ב', 'א ד ב')).toBeNull();
    // A word changed on one side, a mark added to it on the other.
    expect(mergeText('שורה א', 'שורה א!', 'שורה אא')).toBeNull();
  });

  it('merges running text only, not names', () => {
    const { conflicts } = threeWayMerge({ title: 'Tanya' } as Json, { title: 'Tanya (Likkutei Amarim)' } as Json, { title: 'The Tanya' } as Json);
    expect(conflicts.map((c) => c.path)).toEqual(['/title']);
  });

  it('is how a paragraph changed on the site and in a suggestion is merged', () => {
    const site = { content: base.replace('בהדליק', 'להדליק'), proofread: 0 };
    const suggestion = { content: base.replace('ליכתל', 'ליכטל'), proofread: 1 };
    const { merged, conflicts } = threeWayMerge({ content: base, proofread: 0 } as Json, site as Json, suggestion as Json);
    expect(conflicts).toEqual([]);
    expect(merged).toEqual({ content: base.replace('בהדליק', 'להדליק').replace('ליכתל', 'ליכטל'), proofread: 1 });
  });
});
