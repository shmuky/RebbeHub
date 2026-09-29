import { describe, expect, it } from 'vitest';
import { spellingHints, toHouseSpelling } from '@rebbehub/model';

describe('the house spelling', () => {
  it('points out words written other than the booklets do, once each', () => {
    expect(spellingHints('ער האט אויכעט געזאגט, אויכעט דעמולט: אראפבריינגען ע״י')).toEqual([
      { written: '׳ ״', house: `' "` },
      { written: 'אויכעט', house: 'אויך' },
      { written: 'דעמולט', house: 'דעמאלט' },
      { written: 'אראפבריינגען', house: 'אראפברענגען' },
    ]);
    expect(spellingHints('ער האט אויך געזאגט')).toEqual([]);
    // עם is often Loshon Kodesh: never hinted.
    expect(spellingHints('מען דארף געבן עם')).toEqual([]);
  });

  it('rewrites a text the way the training run does, עם as אים except in Loshon Kodesh', () => {
    expect(toHouseSpelling('ער האט עם אויכעט געזאגט, מ׳בריינגט עם ישראל ע״י')).toBe(`ער האט אים אויך געזאגט, מ'ברענגט עם ישראל ע"י`);
  });
});
