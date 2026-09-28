import { beforeEach, describe, expect, it } from 'vitest';
import type { Catalog } from '@rebbehub/core';
import { audioUrl, idForKey, occasionDate, pdfUrl, runImport, sichosKodeshOccasionsImporter, type CatalogEntry } from '@rebbehub/importers';
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
    expect(links[0]!.url).toBe(pdfUrl({ driveFileId: '1tk7tznpZCW0cyFVuNPcwYZMaqzSIC9oO', resourceKey: '0-Xqz7bN0vTC1CZxMnwXcPeg' }));
    expect(links[0]!.url).toContain('&resourcekey=0-Xqz7bN0vTC1CZxMnwXcPeg');

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
});
