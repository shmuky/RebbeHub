import { describe, expect, it } from 'vitest';
import { spellingHints } from '@rebbehub/model';

describe('the house spelling', () => {
  it('points out words written other than the booklets do, once each', () => {
    expect(spellingHints('ער האט אויכעט געזאגט, אויכעט דעמולט: אראפבריינגען ע״י')).toEqual([
      { written: '׳ ״', house: `' "` },
      { written: 'אויכעט', house: 'אויך' },
      { written: 'דעמולט', house: 'דעמאלט' },
      { written: 'אראפבריינגען', house: 'אראפברענגען' },
    ]);
    expect(spellingHints('ער האט אויך געזאגט')).toEqual([]);
  });
});
