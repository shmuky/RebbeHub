import { beforeAll, describe, expect, it } from 'vitest';
import { driveId, mafteach, placesOf, type Catalog, type Json } from '@rebbehub/core';
import type { EntityId, PageText } from '@rebbehub/model';
import { add, freshCatalog } from './helpers.js';

/**
 * A sefer's whole subject index gathered from its volumes' index pages,
 * over two invented volumes: the same topic printed a little differently
 * in each meets once, every place keeps its context and links, and what a
 * machine read stays labelled. The words are invented for the test.
 */

let catalog: Catalog;
const ids = {} as Record<string, EntityId>;
const read = (drive: string, title: string, page = 1) => `/read?${page > 1 ? `page=${page}&` : ''}title=${title.replace(/ /g, '+')}&src=https://drive.google.com/open?id=${drive}`;
const ocr = { by: 'ocr:test' };

const volume = (segments: PageText['versions'][number]['segments']): PageText => ({ profile: 'plain', versions: [{ id: 'he', language: 'he', segments }] });

beforeAll(async () => {
  ({ catalog } = await freshCatalog());
  ids.sefer = await add(catalog, 'shmuly', 'shmuly', 'work', { title: { he: 'ספר בדיקה' }, slug: 'sefer-bdika', authors: [], genre: 'sichos', levels: ['volume', 'sicha'] }, '/sefer-bdika');
  await add(catalog, 'shmuly', 'shmuly', 'unit', {
    work: ids.sefer,
    position: [{ level: 'volume', value: '1' }, { level: 'sicha', value: '5' }],
    order: '01',
    label: { he: 'שיחה ראשונה' },
    editions: [{ kind: 'pdf', role: 'sicha', url: 'https://drive.google.com/file/d/AAAAAAAAAAAA/view', source: 'mafteiach', sourceId: 'AAAAAAAAAAAA', licence: 'facts-and-links' }],
  } as unknown as Json, '/sefer-bdika/1/5');
  ids.index = await add(catalog, 'shmuly', 'shmuly', 'work', { title: { he: 'מפתח בדיקה' }, slug: 'mafteach-bdika', authors: [], genre: 'sichos', levels: ['volume'] }, '/mafteach-bdika');
  await add(catalog, 'shmuly', 'shmuly', 'unit', {
    work: ids.index,
    position: [{ level: 'volume', value: '1' }],
    order: '01V',
    label: { he: 'חלק א' },
    body: volume([
      { id: 't1', kind: 'heading', level: 2, text: [{ text: 'אור וחושך' }], origin: ocr },
      { id: 't1.1', kind: 'paragraph', origin: ocr, text: [{ text: '7', href: read('AAAAAAAAAAAA', 'ח"א ע\' 5 (בדיקה)', 3) }, { text: ' (האור דוחה החושך)' }, { text: '.' }, { text: ' ' }, { text: '9-10' }, { text: '.' }] },
      { id: 't2', kind: 'heading', level: 2, text: [{ text: 'מים' }] },
      { id: 't2.1', kind: 'paragraph', text: [{ text: '12', href: read('BBBBBBBBBBBB', 'ח"א ע\' 11 (מים)') }, { text: '.' }] },
    ]),
  } as unknown as Json, '/mafteach-bdika/1');
  await add(catalog, 'shmuly', 'shmuly', 'unit', {
    work: ids.index,
    position: [{ level: 'volume', value: '2' }],
    order: '02V',
    label: { he: 'חלק ב' },
    body: volume([
      { id: 't1', kind: 'heading', level: 2, text: [{ text: 'אור - וחושך' }] },
      { id: 't1.1', kind: 'paragraph', text: [{ text: '40', href: read('CCCCCCCCCCCC', 'ח"ב ע\' 40 (אור)') }, { text: ' (במקדש)' }, { text: '.' }] },
    ]),
  } as unknown as Json, '/mafteach-bdika/2');
});

describe('mafteach', () => {
  it('reads a paragraph of the index as places: pages, ranges, context and links', () => {
    const places = placesOf([{ text: '7', href: read('AAAAAAAAAAAA', 'שם', 3) }, { text: ' (הקשר)' }, { text: '.' }, { text: ' ' }, { text: '9-10' }, { text: '.' }, { text: ' ' }, { text: '337-0' }, { text: '.' }], (pdf) => (driveId(pdf) === 'AAAAAAAAAAAA' ? '/x/1' : undefined));
    expect(places).toEqual([
      { page: 7, pdf: 'https://drive.google.com/file/d/AAAAAAAAAAAA/view', at: 3, sicha: 'שם', text: '/x/1', context: 'הקשר' },
      { page: 9, to: 10 },
      { page: 337 },
    ]);
    expect(driveId('https://drive.google.com/file/d/1abcDEF_ghij/view')).toBe('1abcDEF_ghij');
    expect(driveId('https://drive.google.com/open?id=1abcDEF_ghij')).toBe('1abcDEF_ghij');
  });

  it('gathers every volume under each topic, the machine-read labelled, each place linked to its sicha', async () => {
    const index = await mafteach(catalog, ids.index!, { seferId: ids.sefer });
    expect(index!.totals).toEqual({ topics: 2, places: 4, volumes: 2 });
    expect(index!.letters).toEqual([{ letter: 'א', topics: 1 }, { letter: 'מ', topics: 1 }]);
    expect(index!.found).toBe(1);
    expect(index!.next).toBeNull();
    const [light] = index!.topics;
    expect(light!.volumes.map((v) => [v.label, v.machine, v.path])).toEqual([
      ['חלק א׳', true, '/mafteach-bdika/1'],
      ['חלק ב׳', false, '/mafteach-bdika/2'],
    ]);
    expect(light!.volumes[0]!.places[0]).toMatchObject({ page: 7, context: 'האור דוחה החושך', sicha: 'ח"א ע\' 5 (בדיקה)', text: '/sefer-bdika/1/5' });
    expect(light!.volumes[0]!.places[1]).toEqual({ page: 9, to: 10 });
  });

  it('finds topics by name first, then by a place\'s context', async () => {
    expect((await mafteach(catalog, ids.index!, { q: 'מים' }))!.topics.map((t) => t.topic)).toEqual(['מים']);
    // The topic of that very name comes before one that only holds it.
    expect((await mafteach(catalog, ids.index!, { q: 'אור' }))!.topics[0]!.topic).toBe('אור וחושך');
    expect((await mafteach(catalog, ids.index!, { q: 'מקדש' }))!.topics.map((t) => t.topic)).toHaveLength(1);
    expect((await mafteach(catalog, ids.index!, { letter: 'מ' }))!.topics.map((t) => t.topic)).toEqual(['מים']);
    expect((await mafteach(catalog, ids.index!, { q: 'אין כזה' }))!.found).toBe(0);
    // A page stops at its places, never at no topic: one topic a page here, the next where it stopped.
    const first = await mafteach(catalog, ids.index!, { q: 'ע', places: 1 });
    expect([first!.topics.length, first!.next]).toEqual([1, 1]);
  });

  it('sees a fix on an index page at once', async () => {
    await add(catalog, 'shmuly', 'shmuly', 'unit', {
      work: ids.index,
      position: [{ level: 'volume', value: '3' }],
      order: '03V',
      label: { he: 'חלק ג' },
      body: volume([{ id: 't1', kind: 'heading', level: 2, text: [{ text: 'שמחה' }] }, { id: 't1.1', kind: 'paragraph', text: [{ text: '3' }, { text: '.' }] }]),
    } as unknown as Json, '/mafteach-bdika/3');
    expect((await mafteach(catalog, ids.index!))!.totals).toEqual({ topics: 3, places: 5, volumes: 3 });
  });
});
