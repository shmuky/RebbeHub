import { describe, expect, it } from 'vitest';
import { itemsIn, mentionsIn, referencesIn, tokenize } from '../src/mentions.js';

describe('what people write', () => {
  it('names people with @, but not in an email address or code', () => {
    expect(mentionsIn('Thanks @Mendy and @chaim-b, cc @mendy.')).toEqual(['mendy', 'chaim-b']);
    expect(mentionsIn('write to mendy@example.org')).toEqual([]);
    expect(mentionsIn('see `@not-a-mention` here')).toEqual([]);
    expect(mentionsIn('(@shmuly)')).toEqual(['shmuly']);
    expect(mentionsIn('שאלה ל@shmuly')).toEqual(['shmuly']);
  });

  it('numbers suggestions and reports with #, and reads "Fixes #12", in Hebrew too', () => {
    expect(referencesIn('See #3 and #4; fixes #12. Closes: #13')).toEqual([
      { number: 3, closes: false },
      { number: 4, closes: false },
      { number: 12, closes: true },
      { number: 13, closes: true },
    ]);
    expect(referencesIn('מתקן #7')).toEqual([{ number: 7, closes: true }]);
    expect(referencesIn('a#1 and &#39; and https://x.org/#5')).toEqual([]);
    expect(referencesIn('Prefixes #9')).toEqual([{ number: 9, closes: false }]);
  });

  it('finds items by id, and addresses whole', () => {
    expect(itemsIn('Compare rh-7k2m9q4d with rh-7K2M')).toEqual(['rh-7k2m9q4d']);
    expect(tokenize('Read https://rebbehub.org/x, then @mendy.')).toEqual([
      { kind: 'text', text: 'Read ' },
      { kind: 'url', url: 'https://rebbehub.org/x', text: 'https://rebbehub.org/x' },
      { kind: 'text', text: ', then ' },
      { kind: 'mention', username: 'mendy', text: '@mendy' },
      { kind: 'text', text: '.' },
    ]);
  });
});
