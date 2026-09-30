import { describe, expect, it } from 'vitest';
import { linkTitle } from '../app/lib/linkTitle.js';

/** A subject index's page numbers name their sicha on hover, from the link's own title. */
describe('linkTitle', () => {
  it('reads the title a /read link carries, spaces written as +', () => {
    expect(linkTitle('/read?page=8&title=ח"א+ע\'+119+(וארא)&src=https://drive.google.com/open?id=1abc')).toBe('ח"א ע\' 119 (וארא)');
    expect(linkTitle('/read?title=a%2Bb%26c&src=x')).toBe('a+b&c');
  });

  it('gives nothing for a link without one', () => {
    expect(linkTitle('/likkutei-sichos/5')).toBeUndefined();
    expect(linkTitle('https://example.org/?q=1')).toBeUndefined();
    expect(linkTitle('/read?title=+&src=x')).toBeUndefined();
  });
});
