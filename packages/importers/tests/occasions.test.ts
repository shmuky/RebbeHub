import { beforeEach, describe, expect, it } from 'vitest';
import type { Catalog } from '@rebbehub/core';
import { audioUrl, idForKey, occasionDate, pdfUrl, runImport, sichosKodeshOccasionsImporter, type CatalogEntry, type MafteiachRecord } from '@rebbehub/importers';
import { freshCatalog } from '../../core/tests/helpers.js';

/** Two occasions in Sichos-Kodesh's catalog format: a farbrengen with two parts and two hanachos, and a second one the same day. */
const entries = (): CatalogEntry[] => [
  {
    occasionId: 11113014,
    hebrewYear: 5714,
    hebrewDate: '5714-03-19',
    occasionLabel: 'י"ט כסלו',
    occasionLabelEn: '19 Kislev',
    audio: [
      { workerFilename: 'AR0016657.mp3', durationMs: 359523, chapterName: 'Two Nigunim', chapterNameHe: 'שני ניגונים' },
      { workerFilename: 'AR0016658.mp3', durationMs: 610351, chapterName: 'Sicha 1', chapterNameHe: 'שיחה א׳' },
    ],
    pdfs: [
      { section: 'mugah', label: 'לקו"ש', driveFileId: '1KgxR1B-ab3l4kp_VMg-1WgudgSZpxfdJ' },
      { section: 'biltiMugah', label: 'תו"מ התוועדויות', driveFileId: '1tk7tznpZCW0cyFVuNPcwYZMaqzSIC9oO', resourceKey: '0-Xqz7bN0vTC1CZxMnwXcPeg' },
    ],
  },
  { occasionId: 11113015, hebrewYear: 5714, hebrewDate: '5714-03-19b', occasionLabel: 'י"ט כסלו, סעודה', audio: [], pdfs: [] },
];

let catalog: Catalog;
beforeEach(async () => {
  ({ catalog } = await freshCatalog());
});

describe('occasion dates', () => {
  it('reads mafteiach dates, second occasions of a day, and days the calendar lacks', () => {
    expect(occasionDate('5714-03-19')).toEqual({ date: '5714-03-19', order: 0, path: '/events/5714-03-19' });
    expect(occasionDate('5711-01-09b')).toEqual({ date: '5711-01-09', order: 1, path: '/events/5711-01-09b' });
    expect(occasionDate('5741-06B-14')?.path).toBe('/events/5741-06b-14');
    expect(occasionDate('5711-05-00')?.date).toBe('5711-05');
    expect(occasionDate('5721-12-30')?.date).toBe('5721-12'); // Elul 5721 has 29 days
    expect(occasionDate('not a date')).toBeNull();
  });
});

describe('the Sichos-Kodesh occasions importer', () => {
  it('makes a farbrengen with its hanachos first and a recording per part', async () => {
    const result = await runImport(catalog, sichosKodeshOccasionsImporter(entries()), { approveAs: 'shmuly' });
    expect(result.created).toBe(1 + 2 + 2); // the set, two events, two recordings

    const event = await catalog.get(await idForKey('mafteiach-occasion:11113014'));
    expect(event?.path).toBe('/events/5714-03-19');
    expect(event?.data).toMatchObject({ kind: 'farbrengen', title: { he: 'י"ט כסלו', en: '19 Kislev' }, date: '5714-03-19', externalIds: { mafteiach: '11113014' } });
    const links = (event!.data as { links: Array<{ kind: string; url: string }> }).links;
    expect(links.map((l) => l.kind)).toEqual(['bilti-mugah', 'mugah']);
    // The file's own Drive link, as the mafteiach gives it, with its resource key; the site reads it through the API.
    expect(links[0]!.url).toBe('https://drive.google.com/file/d/1tk7tznpZCW0cyFVuNPcwYZMaqzSIC9oO/view?resourcekey=0-Xqz7bN0vTC1CZxMnwXcPeg');
    expect(links[0]).toMatchObject({ origin: links[0]!.url });

    const second = await catalog.get(await idForKey('mafteiach-occasion:11113015'));
    expect(second?.data).toMatchObject({ date: '5714-03-19', order: 1 });

    const part2 = await catalog.get(await idForKey('mafteiach-recording:11113014/2'));
    expect(part2?.data).toMatchObject({ event: event!.id, title: { he: 'שיחה א׳', en: 'Sicha 1' }, url: audioUrl('AR0016658.mp3'), durationMs: 610351, part: 2 });
  });

  it('changes nothing when run again on the same catalog', async () => {
    await runImport(catalog, sichosKodeshOccasionsImporter(entries()), { approveAs: 'shmuly' });
    const again = await runImport(catalog, sichosKodeshOccasionsImporter(entries()), { approveAs: 'shmuly' });
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 5 });
  });

  it('adds every link and the content outline the mafteiach index has, and farbrengens only it knows', async () => {
    const empty = { links: [] };
    const record = (id: number, hebrewDate: string, detail: Partial<MafteiachRecord['detail']>): MafteiachRecord => ({
      id,
      hebrewYear: 5714,
      hebrewDate,
      isPreNesius: false,
      occasionLabel: 'י"ט כסלו',
      detail: { biltiMugah: empty, mugah: empty, maamorim: empty, english: empty, hagahos: empty, audio: empty, video: { links: [], youtubeIds: [] }, tochenInyanim: { text: null, links: [] }, hosofos: { text: null, links: [] }, ...detail },
    });
    const index = [
      record(11113014, '5714-03-19', {
        // The catalog's own hanacha (already there), a book on HebrewBooks, and a reshima the app leaves out.
        mugah: { links: [{ label: 'לקו"ש', url: 'https://drive.google.com/open?id=1KgxR1B-ab3l4kp_VMg-1WgudgSZpxfdJ' }, { label: 'ח"א ע\' 22', url: 'https://hebrewbooks.org/pdfpager.aspx?req=1&pgnum=22', group: 'ליקוט' }, { label: 'רשימות חוברת ב', url: 'https://drive.google.com/file/d/1db9QCEC2tRx/view' }] },
        maamorim: { links: [{ label: 'ראה מאמר\n   expand_more', url: '/maamorim/134', group: 'ד"ה\n  כרע שכב' }] },
        english: { links: [{ label: 'Proceeding Together Vol. 1', url: 'https://www.sie.org/templates/1.htm' }] },
        audio: { links: [{ label: 'אודיו', url: 'https://ashreinu.app/#/player/parentEvent~5080_event~5080' }] },
        video: { links: [{ label: 'וידאו', url: 'https://videos.jem.tv/v/1' }], youtubeIds: ['WB0UI77OY8A'] },
        tochenInyanim: { text: "1. הפיכת העינוי - לעת רצון\n 2. פרטי עניני צום גדלי'", links: [] },
      }),
      record(11119999, '5714-03-20', { tochenInyanim: { text: 'שיחה', links: [] } }),
    ];
    await runImport(catalog, sichosKodeshOccasionsImporter(entries(), { mafteiach: index }), { approveAs: 'shmuly' });
    const event = await catalog.get(await idForKey('mafteiach-occasion:11113014'));
    const data = event!.data as { links: Array<{ kind: string; url: string; label: { he: string } }>; body: unknown; bodySource: object };
    expect(data.links.map((l) => [l.kind, l.url])).toEqual([
      ['bilti-mugah', expect.any(String)],
      ['mugah', 'https://drive.google.com/file/d/1KgxR1B-ab3l4kp_VMg-1WgudgSZpxfdJ/view'],
      ['mugah', 'https://hebrewbooks.org/pdfpager.aspx?req=1&pgnum=22'],
      ['mugah', 'https://drive.google.com/file/d/1db9QCEC2tRx/view'],
      ['maamar', 'https://www.mafteiach.app/maamorim/134'],
      ['english', 'https://www.sie.org/templates/1.htm'],
      ['video', 'https://videos.jem.tv/v/1'],
      ['video', 'https://www.youtube.com/watch?v=WB0UI77OY8A'],
      ['audio', 'https://ashreinu.app/#/player/parentEvent~5080_event~5080'],
    ]);
    expect(data.links.find((l) => l.kind === 'maamar')!.label.he).toBe('ד"ה כרע שכב · ראה מאמר');
    // The outline keeps its own shape: a titled section of numbered items, drawn by the outline's display rules.
    expect(data.body).toEqual({
      profile: 'outline',
      versions: [
        {
          id: 'he',
          language: 'he',
          segments: [
            {
              id: 'contents',
              kind: 'section',
              text: [{ text: 'תוכן ענינים' }],
              children: [
                { id: 'contents.1', kind: 'item', n: 1, text: [{ text: 'הפיכת העינוי - לעת רצון' }] },
                { id: 'contents.2', kind: 'item', n: 2, text: [{ text: "פרטי עניני צום גדלי'" }] },
              ],
            },
          ],
        },
      ],
    });
    expect(data.bodySource).toMatchObject({ source: 'mafteiach', via: 'mafteiach-index', sourceId: '11113014', url: 'https://www.mafteiach.app/all/by_year/5714' });
    const onlyInIndex = await catalog.get(await idForKey('mafteiach-occasion:11119999'));
    expect(onlyInIndex?.data).toMatchObject({ date: '5714-03-20', body: { profile: 'outline', versions: [{ segments: [{ id: 'contents', children: [{ id: 'contents.1', kind: 'item', text: [{ text: 'שיחה' }] }] }] }] } });
  });
});
