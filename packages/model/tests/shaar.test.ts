import { describe, expect, it } from 'vitest';
import { SchemaRegistry, applyShaar, readShaar, shaarBlocks, shaarFromCatalog, structureSentence, writeShaar, type WorkData } from '@rebbehub/model';

const work: WorkData = {
  title: { he: 'תניא', en: 'Tanya' },
  slug: 'tanya',
  authors: ['rh-0000000a'],
  genre: 'chassidus',
  levels: ['part', 'chapter'],
  shaar: {
    subtitle: { he: 'ליקוטי אמרים', en: 'Likkutei Amarim' },
    byLine: { he: 'מאת כ"ק אדמו"ר הזקן' },
    sections: {
      notes: 'Last.',
      about: 'The written Torah of Chabad.\n\nSee https://example.org/tanya and rh-0000000b.',
      printings: '- 5557, Slavita\n- 5574, Shklov',
    },
  },
};

describe('the shaar file', () => {
  it('is written the same way every time: header fields in order, sections in order', () => {
    const text = writeShaar(work, { 'rh-0000000a': 'אדמו"ר הזקן (בעל התניא)' });
    expect(text).toBe(
      [
        '---',
        'shaar: 1',
        'title: תניא',
        'title-en: Tanya',
        'subtitle: ליקוטי אמרים',
        'subtitle-en: Likkutei Amarim',
        'by: rh-0000000a (אדמו"ר הזקן בעל התניא)',
        'by-line: מאת כ"ק אדמו"ר הזקן',
        'genre: chassidus',
        '---',
        '',
        '## על הספר | About',
        '',
        'The written Torah of Chabad.',
        '',
        'See https://example.org/tanya and rh-0000000b.',
        '',
        '## הדפסות | Printings',
        '',
        '- 5557, Slavita',
        '- 5574, Shklov',
        '',
        '## הערות | Notes',
        '',
        'Last.',
        '',
      ].join('\n'),
    );
  });

  it('reads back what it writes', () => {
    const read = readShaar(writeShaar(work));
    expect(read.ok).toBe(true);
    expect(read.fields).toEqual({ title: work.title, authors: work.authors, genre: work.genre, shaar: work.shaar });
  });

  it('takes a heading by either name, sections in any order, and writes them back in order', () => {
    const text = ['---', 'shaar: 1', 'title: תניא', 'genre: chassidus', '---', '## Notes', 'n', '## על הספר', 'a'].join('\n');
    const read = readShaar(text);
    expect(read.ok && read.fields.shaar.sections).toEqual({ notes: 'n', about: 'a' });
    expect(writeShaar({ ...read.fields!, authors: [] }).indexOf('## על הספר')).toBeLessThan(writeShaar({ ...read.fields!, authors: [] }).indexOf('## הערות'));
  });

  it('says on which line anything is wrong, and why, in both languages', () => {
    const text = [
      '---',
      'shaar: 1',
      'title: תניא',
      'author: someone',
      'genre: poetry',
      'by: Alter Rebbe',
      'title-en: Tanya',
      'title: again',
      '---',
      'stray words',
      '# Heading',
      '## Haskamos',
      '## About',
      'a',
      '## About',
    ].join('\n');
    const read = readShaar(text);
    expect(read.ok).toBe(false);
    expect(read.problems.map((p) => p.line)).toEqual([4, 5, 6, 8, 10, 11, 12, 15]);
    expect(read.problems.every((p) => p.he && p.en)).toBe(true);
  });

  it('needs its header, its version, a title and a genre', () => {
    expect(readShaar('title: x').problems[0]).toMatchObject({ line: 1 });
    expect(readShaar('---\nshaar: 1\n').problems[0]!.en).toMatch(/no end/);
    expect(readShaar('---\ntitle: x\ngenre: sichos\n---').problems[0]!.en).toMatch(/shaar: 1/);
    expect(readShaar('---\nshaar: 2\ntitle: x\ngenre: sichos\n---').problems[0]).toMatchObject({ line: 2 });
    expect(readShaar('---\nshaar: 1\ngenre: sichos\n---').problems[0]!.en).toMatch(/name in Hebrew/);
    expect(readShaar('---\nshaar: 1\ntitle: x\n---').problems[0]!.en).toMatch(/kind of sefer/);
    expect(readShaar('---\nshaar: 1\ntitle: x\nsubtitle-en: y\ngenre: sichos\n---').problems[0]).toMatchObject({ line: 4 });
  });

  it('is read into a work, keeping what it has no field for', () => {
    const before: WorkData = { ...work, title: { he: 'תניא', yi: 'תניא' }, cover: { file: 'a'.repeat(64), page: 3 } };
    const applied = applyShaar(before, ['---', 'shaar: 1', 'title: ספר התניא', 'by: rh-0000000c', 'genre: chassidus', '---'].join('\n'));
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.data).toMatchObject({ title: { he: 'ספר התניא', yi: 'תניא' }, authors: ['rh-0000000c'], cover: before.cover, levels: before.levels });
    expect(applied.data.shaar).toEqual({});
    expect(SchemaRegistry.builtin().validate('work', applied.data)).toEqual({ ok: true });
  });

  it('is made from the catalog for a sefer no one wrote one for, labelled as such', () => {
    const made = shaarFromCatalog({ description: { he: 'שיחות', en: 'Talks' }, levels: ['volume', 'sicha'] });
    expect(made).toEqual({ sections: { about: 'שיחות\n\nTalks', structure: 'הספר מחולק לכרכים, וכל כרך לשיחות.' }, origin: { by: 'catalog', checked: false } });
    expect(SchemaRegistry.builtin().validate('work', { ...work, shaar: made })).toEqual({ ok: true });
    expect(structureSentence(['volume', 'parsha', 'sicha'])).toBe('הספר מחולק לכרכים, כל כרך לפרשיות, וכל פרשה לשיחות.');
    expect(structureSentence(['sicha'])).toBe('הספר מחולק לשיחות.');
    expect(structureSentence(['unknown'])).toBeNull();
  });

  it('shows a section as paragraphs and lists, with links to the web and to items', () => {
    expect(shaarBlocks('One\ntwo\n\n- a\n- b rh-0000000b\nafter')).toEqual([
      { kind: 'paragraph', runs: [{ text: 'One' }, { br: true }, { text: 'two' }] },
      { kind: 'list', items: [[{ text: 'a' }], [{ text: 'b ' }, { text: 'rh-0000000b', href: '/rh-0000000b' }]] },
      { kind: 'paragraph', runs: [{ text: 'after' }] },
    ]);
    expect(shaarBlocks('See https://example.org/x.')[0]).toEqual({ kind: 'paragraph', runs: [{ text: 'See ' }, { text: 'https://example.org/x', href: 'https://example.org/x' }, { text: '.' }] });
  });
});
