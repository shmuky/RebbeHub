import { describe, expect, it } from 'vitest';
import { hasUnclear, markUnclear, unclearRanges } from '@rebbehub/model';

describe('words marked unclear', () => {
  it('finds `[words?]` marks, and marks words once', () => {
    const text = 'עס שטייט [אין פסוק?] און [דער?] רבי';
    expect(hasUnclear(text)).toBe(true);
    expect(hasUnclear('עס שטייט [אין פסוק] און?')).toBe(false);
    expect(unclearRanges(text).map((r) => text.slice(r.from, r.to))).toEqual(['[אין פסוק?]', '[דער?]']);
    expect(markUnclear('פסוק')).toBe('[פסוק?]');
    expect(markUnclear('[פסוק?]')).toBe('[פסוק?]');
  });
});
