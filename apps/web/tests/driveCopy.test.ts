import { describe, expect, it } from 'vitest';
import { driveCopyOf } from '../app/lib/drive.js';

describe('a printing’s PDF copy on Drive', () => {
  it('is the first source that is a Drive file, with its credit', () => {
    const sources = [
      { source: 'hebrewbooks', sourceId: '14957', url: 'https://hebrewbooks.org/14957' },
      { source: 'other', sourceId: '1P_mvp5FVshtVszEEuQE-1eZq8zAhbz9P', url: 'https://drive.google.com/file/d/1P_mvp5FVshtVszEEuQE-1eZq8zAhbz9P/view', note: 'אוצרות הרבי' },
    ];
    expect(driveCopyOf(sources)).toEqual({ url: sources[1]!.url, credit: 'אוצרות הרבי' });
  });
  it('is none without a Drive file', () => {
    expect(driveCopyOf(undefined)).toBeNull();
    expect(driveCopyOf([{ source: 'hebrewbooks', url: 'https://hebrewbooks.org/1' }])).toBeNull();
    expect(driveCopyOf([{ url: 'https://drive.google.com/drive/folders/1P_HX-GSgRfMarH97Jcn7v3MdmKmUZRsF' }])).toBeNull();
  });
});
