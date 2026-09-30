import { describe, expect, it } from 'vitest';
import { hebrewNumber, ofVolume, volumeNumber, workVolumes } from '../app/lib/volumes.js';

describe('volumes', () => {
  it('reads a volume number however a source names it', () => {
    expect(volumeNumber('34')).toBe(34);
    expect(volumeNumber('לד (דברים)')).toBe(34);
    expect(volumeNumber('כרך לד')).toBe(34);
    expect(volumeNumber('טו (בראשית)')).toBe(15);
    expect(volumeNumber('א (בראשית - שמות - ויקרא)')).toBe(1);
    expect(volumeNumber('שמות - כרך א')).toBeNull();
    expect(volumeNumber('בראשית')).toBeNull();
    expect(volumeNumber('חג השבועות')).toBeNull();
    expect(hebrewNumber(34)).toBe('לד');
    expect(hebrewNumber(16)).toBe('טז');
  });

  it("puts a printing with its volume by number, not by the contents' own value", () => {
    const vol30 = { value: '1', label: { he: 'כרך ל' }, units: 9 };
    expect(ofVolume('ל (בראשית)', vol30)).toBe(true);
    expect(ofVolume('30', vol30)).toBe(true);
    expect(ofVolume('1', vol30)).toBe(false);
    expect(ofVolume(undefined, vol30)).toBe(true);
    expect(ofVolume('בראשית', { value: 'בראשית', label: null })).toBe(true);
  });

  it('gives each volume only printings have one row, in order', () => {
    const outline = [
      { value: '1', label: { he: 'כרך ל' }, units: 9 },
      { value: '2', label: { he: 'כרך לא' }, units: 8 },
    ];
    const parts = workVolumes(outline, ['ה (בראשית)', '5', 'ל (בראשית)', '30', '1', 'א (בראשית - שמות - ויקרא)', undefined]);
    expect(parts.map((p) => p.label?.he)).toEqual(['כרך א (בראשית - שמות - ויקרא)', 'כרך ה (בראשית)', 'כרך ל', 'כרך לא']);
    expect(parts[1]).toMatchObject({ value: 'ה (בראשית)', units: 0 });
  });
});
