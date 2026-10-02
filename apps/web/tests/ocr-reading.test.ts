import { describe, expect, it } from 'vitest';
import { readingInline, readingOf } from '../app/lib/reading.js';

describe("a page our reader read", () => {
  it("makes the reader's marks the site's runs", () => {
    expect(readingInline('{63}⦃ב.⦄ והנה[6] ⟨שמחה⟩ בשבת[*]')).toEqual([
      { marker: '63' },
      { text: 'ב.', marks: ['ois'] },
      { text: ' והנה' },
      { note: 'n6' },
      { text: ' ' },
      { text: 'שמחה', marks: ['b'] },
      { text: ' בשבת' },
      { note: 'n-star' },
    ]);
  });

  it('reads the title, scan, headings, paragraphs and footnotes, leaving out the reader\'s own labels', () => {
    const reading = readingOf(['title: בהעלותך ב', 'scan: https://drive.google.com/open?id=1Q9h_YYCSVLm_HbGTqHxYgc_8b2nY2fWD', '## {62}בהעלותך 2)', '### אות א', '⦃א.⦄ איתא[1]', '---', '1) פרשתנו י, י.', 'ועוד.', '*) [level 2] ⟨נדפס גם⟩'].join('\n'))!;
    expect(reading.title).toBe('בהעלותך ב');
    expect(reading.scan).toBe('https://drive.google.com/open?id=1Q9h_YYCSVLm_HbGTqHxYgc_8b2nY2fWD');
    const [version] = reading.body.versions;
    expect(version!.origin).toEqual({ by: 'ocr:rebbehub-kraken-ls-v1', checked: false });
    expect(version!.segments.map((s) => s.kind)).toEqual(['heading', 'paragraph']);
    expect(version!.segments[0]!.text).toEqual([{ marker: '62' }, { text: 'בהעלותך ב' }]);
    expect(version!.notes!.map((n) => [n.id, n.n ?? n.label])).toEqual([
      ['n1', 1],
      ['n-star', '*'],
    ]);
    expect(version!.notes![0]!.text).toEqual([{ text: 'פרשתנו י, י.' }, { text: ' ' }, { text: 'ועוד.' }]);
  });

  it('is nothing when the file holds no words', () => {
    expect(readingOf('title: x\n\n---\n')).toBeNull();
  });
});
