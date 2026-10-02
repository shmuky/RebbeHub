import { describe, expect, it } from 'vitest';
import type { PageVersion } from '@rebbehub/model';
import { noteLabels, printPagesOf } from '../app/lib/printLines.js';
import { readingOfJson } from '../app/lib/reading.js';

const box = (y: number, x = 0.5): [number, number, number, number] => [x, y, 0.33, 0.012];

/** Made-up words in the reader's shape: a heading, a paragraph over two printed lines with a broken word, a footnote, on two pages. */
const version: PageVersion = {
  id: 'he',
  language: 'he',
  segments: [
    { id: 'h1', kind: 'heading', text: [{ marker: '10' }, { text: 'כותרת' }, { eol: 'line', page: 1, box: box(0.14, 0.42) }] },
    {
      id: 's1',
      kind: 'section',
      children: [
        {
          id: 'p1',
          kind: 'paragraph',
          text: [{ text: 'א.', marks: ['ois'] }, { text: ' מילה ארו' }, { eol: 'line', split: true, page: 1, box: box(0.2) }, { text: 'כה ' }, { text: 'מודגשת', marks: ['b'] }, { note: 'n1' }, { eol: 'page', page: 1, box: box(0.22) }, { marker: '11' }, { text: 'עוד שורה' }, { eol: 'line', page: 2, box: box(0.1) }],
        },
      ],
    },
  ],
  notes: [{ id: 'n1', kind: 'note', n: 1, text: [{ text: 'מקור.' }, { eol: 'line', page: 1, box: box(0.6) }] }],
};

describe('printPagesOf', () => {
  it('sets each printed line on its page, in the print faces, with the page numbers', () => {
    const pages = printPagesOf(version)!;
    expect(pages.map((p) => [p.page, p.printed, p.lines.length])).toEqual([
      [1, '10', 4],
      [2, '11', 1],
    ]);
    const [heading, first, second, note] = pages[0]!.lines;
    expect(heading!.kind).toBe('heading');
    expect(first).toMatchObject({ kind: 'body', first: true, last: false, split: true });
    expect(second).toMatchObject({ first: false, last: false, split: false });
    expect(second!.runs).toContainEqual({ text: 'מודגשת', marks: ['b'] });
    expect(note).toMatchObject({ kind: 'note', label: '1', first: true, last: true });
    expect(pages[1]!.lines[0]).toMatchObject({ last: true });
    expect(noteLabels(version)).toEqual({ n1: '1' });
  });

  it('is nothing for words without printed line ends', () => {
    expect(printPagesOf({ id: 'he', language: 'he', segments: [{ id: 'p1', kind: 'paragraph', text: [{ text: 'מילים' }] }] })).toBeNull();
  });
});

describe('readingOfJson', () => {
  it("takes the reader's output file, keeps its line ends and drops a link that goes nowhere allowed", () => {
    const file = JSON.stringify({
      sicha: '1_0010',
      pageText: { profile: 'sichos-kodesh', versions: [{ ...version, id: 'yi', language: 'yi', url: 'https://drive.google.com/file/d/x/view', segments: [...version.segments, { id: 'p9', kind: 'paragraph', text: [{ text: 'קישור', href: 'javascript:alert(1)' }, { eol: 'line', page: 2, box: box(0.12) }] }] }] },
      layout: [{ lines: [] }],
    });
    const reading = readingOfJson(file, 'fallback')!;
    expect(reading.title).toBe('כותרת');
    expect(reading.scan).toBe('https://drive.google.com/file/d/x/view');
    expect(reading.body.versions[0]!.language).toBe('yi');
    expect(printPagesOf(reading.body.versions[0])).not.toBeNull();
    expect(JSON.stringify(reading.body)).not.toContain('javascript');
  });

  it('is nothing for a file that is not the reader’s', () => {
    expect(readingOfJson('{"a":1}')).toBeNull();
    expect(readingOfJson('not json')).toBeNull();
  });
});
