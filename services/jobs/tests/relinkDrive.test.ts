import { beforeEach, describe, expect, it } from 'vitest';
import { knownDriveFile, type Catalog } from '@rebbehub/core';
import { MIGRATIONS } from '@rebbehub/db';
import {
  driveLibraryImporter,
  idForKey,
  pdfUrl,
  relinkDrive,
  relinkJem,
  runImport,
  sichosKodeshOccasionsImporter,
  type CatalogEntry,
  type DriveFolder,
  type ImportRecord,
  type Importer,
} from '@rebbehub/importers';
import { jemAudioFile } from '@rebbehub/model';
import { RELINK_BOT, RELINK_JEM_BOT, relinkDriveLinks, relinkJemLinks } from '../src/relinkDrive.js';
import { freshCatalog } from '../../../packages/core/tests/helpers.js';

/**
 * `rebbehub relink-drive`: the media proxy links older imports stored
 * become the files' own Drive links, as reviewed bot Suggestions.
 */

const entries = (): CatalogEntry[] => [
  {
    occasionId: 11113014,
    hebrewYear: 5714,
    hebrewDate: '5714-03-19',
    occasionLabel: 'י"ט כסלו',
    audio: [{ workerFilename: 'AR0016657.mp3', durationMs: 359523 }],
    pdfs: [
      { section: 'mugah', label: 'לקו"ש', driveFileId: '1KgxR1B-ab3l4kp_VMg-1WgudgSZpxfdJ' },
      { section: 'biltiMugah', label: 'תו"מ', driveFileId: '1tk7tznpZCW0cyFVuNPcwYZMaqzSIC9oO', resourceKey: '0-Xqz7bN0vTC1CZxMnwXcPeg' },
    ],
  },
];

const library: DriveFolder = {
  id: 'root',
  title: 'ספרי ליובאוויטש',
  files: [],
  folders: [{ id: 'lks-folder-1', title: 'לקוטי שיחות', files: [{ id: 'otzrosfile01', title: '01.pdf' }, { id: 'otzrosfile02', title: '02.pdf' }], folders: [] }],
};

const PROXY_JEM = 'https://sichos-kodesh-media-proxy.shmuky.workers.dev/jem-audio/';

/** What the importers stored before: every Drive PDF and JEM recording on the media proxy (an Otzros page also kept its Drive copy). */
function legacy(importer: Importer): Importer {
  const proxied = (url: string) => {
    const m = /\/file\/d\/([\w-]+)\/view(?:\?resourcekey=([\w-]+))?$/.exec(url);
    const jem = jemAudioFile(url);
    return m ? pdfUrl({ driveFileId: m[1]!, resourceKey: m[2] }) : jem ? `${PROXY_JEM}${encodeURIComponent(jem)}` : url;
  };
  return {
    ...importer,
    async *records() {
      for await (const record of importer.records() as AsyncIterable<ImportRecord>) {
        const data = structuredClone(record.data) as { url?: string; links?: Array<{ url: string }>; editions?: Array<{ url: string; label?: string }> };
        if (data.url) data.url = proxied(data.url);
        for (const link of data.links ?? []) link.url = proxied(link.url);
        if (data.editions) data.editions = [...data.editions.map((e) => ({ ...e, label: 'reader', url: proxied(e.url) })), ...data.editions];
        yield { ...record, data };
      }
    },
  };
}

let catalog: Catalog;
beforeEach(async () => {
  ({ catalog } = await freshCatalog());
  await runImport(catalog, legacy(sichosKodeshOccasionsImporter(entries())), { approveAs: 'shmuly' });
  await runImport(catalog, legacy(driveLibraryImporter(library)), { approveAs: 'shmuly' });
});

const approveAll = async (ids: number[]) => {
  for (const id of ids) await catalog.merge(id, 'shmuly');
};

describe('relinkDrive', () => {
  it('turns media proxy addresses into Drive links, keeps origins, and drops a copy then listed twice', () => {
    const out = relinkDrive({
      links: [
        { url: pdfUrl({ driveFileId: '1tk7tznpZCW0cyFVuNPcwYZMaqzSIC9oO', resourceKey: '0-Xqz7bN0vTC1CZxMnwXcPeg' }), origin: 'https://drive.google.com/open?id=1tk7tznpZCW0cyFVuNPcwYZMaqzSIC9oO' },
        { url: 'https://sichos-kodesh-media-proxy.shmuky.workers.dev/jem-audio/AR1.mp3' },
      ],
      editions: [
        { label: 'reader', url: pdfUrl({ driveFileId: 'otzrosfile01' }) },
        { label: 'drive', url: 'https://drive.google.com/file/d/otzrosfile01/view' },
      ],
    });
    expect(out?.links).toBe(2);
    expect(out?.data).toEqual({
      links: [
        { url: 'https://drive.google.com/file/d/1tk7tznpZCW0cyFVuNPcwYZMaqzSIC9oO/view?resourcekey=0-Xqz7bN0vTC1CZxMnwXcPeg', origin: 'https://drive.google.com/open?id=1tk7tznpZCW0cyFVuNPcwYZMaqzSIC9oO' },
        { url: 'https://sichos-kodesh-media-proxy.shmuky.workers.dev/jem-audio/AR1.mp3' }, // JEM's audio is not on Drive
      ],
      editions: [{ label: 'drive', url: 'https://drive.google.com/file/d/otzrosfile01/view' }],
    });
    expect(relinkDrive({ url: 'https://drive.google.com/file/d/otzrosfile01/view' })).toBeNull();
  });
});

describe('rebbehub relink-drive', () => {
  it('counts on a dry run and changes nothing', async () => {
    const head = await catalog.head();
    const result = await relinkDriveLinks(catalog, { dryRun: true });
    expect(result).toMatchObject({ items: 3, links: 4, byType: { event: 1, unit: 2 }, suggestions: [] });
    expect(await catalog.head()).toBe(head);
    expect(await catalog.listChangesets({ author: RELINK_BOT.id })).toEqual([]);
  });

  it('sends one bot suggestion per batch for review, and nothing twice', async () => {
    const result = await relinkDriveLinks(catalog, { batch: 2 });
    expect(result.items).toBe(3);
    expect(result.suggestions).toHaveLength(2);
    for (const id of result.suggestions) expect(await catalog.changeset(id)).toMatchObject({ author: RELINK_BOT.id, status: 'open', kind: 'import' });
    // What waits for review is not sent again.
    expect((await relinkDriveLinks(catalog)).items).toBe(0);

    await approveAll(result.suggestions);
    const event = await catalog.get(await idForKey('mafteiach-occasion:11113014'));
    const links = (event!.data as { links: Array<{ url: string; origin?: string }> }).links;
    expect(links.map((l) => l.url)).toEqual([
      'https://drive.google.com/file/d/1tk7tznpZCW0cyFVuNPcwYZMaqzSIC9oO/view?resourcekey=0-Xqz7bN0vTC1CZxMnwXcPeg',
      'https://drive.google.com/file/d/1KgxR1B-ab3l4kp_VMg-1WgudgSZpxfdJ/view',
    ]);
    expect(links.every((l) => l.origin === l.url)).toBe(true);
    const unit = await catalog.get(await idForKey('otzros-unit:otzrosfile01'));
    expect((unit!.data as { editions: unknown[] }).editions).toEqual([expect.objectContaining({ label: 'drive', url: 'https://drive.google.com/file/d/otzrosfile01/view' })]);
    // The recording still plays through the proxy: it is JEM's, not on Drive.
    const recording = await catalog.get(await idForKey('mafteiach-recording:11113014/1'));
    expect((recording!.data as { url: string }).url).toContain('/jem-audio/');

    // Nothing is left, and the importers, run again as they are now, find nothing to change but the recording (relink-jem's).
    expect((await relinkDriveLinks(catalog)).items).toBe(0);
    expect(await runImport(catalog, sichosKodeshOccasionsImporter(entries()), { dryRun: true })).toMatchObject({ created: 0, updated: 1 });
    expect(await runImport(catalog, driveLibraryImporter(library), { dryRun: true })).toMatchObject({ created: 0, updated: 0 });
  });

  it('knows the Drive files the catalog links to, before and after', async () => {
    expect(await knownDriveFile(catalog.db, '1tk7tznpZCW0cyFVuNPcwYZMaqzSIC9oO')).toEqual({ id: '1tk7tznpZCW0cyFVuNPcwYZMaqzSIC9oO', resourceKey: '0-Xqz7bN0vTC1CZxMnwXcPeg' });
    await approveAll((await relinkDriveLinks(catalog)).suggestions);
    expect(await knownDriveFile(catalog.db, 'otzrosfile02')).toEqual({ id: 'otzrosfile02', resourceKey: null });
    expect(await knownDriveFile(catalog.db, '1tk7tznpZCW0cyFVuNPcwYZMaqzSIC9oO')).toMatchObject({ resourceKey: '0-Xqz7bN0vTC1CZxMnwXcPeg' });
    expect(await knownDriveFile(catalog.db, 'nobodylinksthis')).toBeNull();
  });

  it("fills the Drive files from what main holds when the table is first made, as merges keep it", async () => {
    const rows = async () => (await catalog.db.query('SELECT file_id, entity_id, resource_key FROM drive_file ORDER BY file_id, entity_id')).rows;
    const kept = await rows();
    expect(kept).toHaveLength(4);
    const up = MIGRATIONS.find((m) => m.name === 'drive-files')!.up;
    await catalog.db.exec(`DELETE FROM drive_file; ${up.slice(up.indexOf('INSERT INTO drive_file'))}`);
    expect(await rows()).toEqual(kept);
  });
});

describe('relinkJem', () => {
  it("turns the proxy's JEM addresses into Ashreinu's files and leaves the rest", () => {
    const out = relinkJem({ url: `${PROXY_JEM}JEMSK%202957.mp3`, links: [{ url: 'https://sichos-kodesh-media-proxy.shmuky.workers.dev/drive/1tk7tznpZCW0cyFVuNPcwYZMaqzSIC9oO' }] });
    expect(out).toEqual({ links: 1, data: { url: 'https://dtgj2yu3gmlic.cloudfront.net/JEMSK%202957.mp3', links: [{ url: 'https://sichos-kodesh-media-proxy.shmuky.workers.dev/drive/1tk7tznpZCW0cyFVuNPcwYZMaqzSIC9oO' }] } });
    expect(relinkJem({ url: 'https://dtgj2yu3gmlic.cloudfront.net/JEMSK0001.mp3' })).toBeNull();
  });
});

describe('rebbehub relink-jem', () => {
  it("points the recordings at Ashreinu's files, for review, and the importer then agrees", async () => {
    expect(await relinkJemLinks(catalog, { dryRun: true })).toMatchObject({ items: 1, links: 1, byType: { recording: 1 }, suggestions: [] });
    const result = await relinkJemLinks(catalog);
    expect(result.suggestions).toHaveLength(1);
    expect(await catalog.changeset(result.suggestions[0]!)).toMatchObject({ author: RELINK_JEM_BOT.id, status: 'open', kind: 'import' });
    expect((await relinkJemLinks(catalog)).items).toBe(0);
    await approveAll(result.suggestions);
    const recording = await catalog.get(await idForKey('mafteiach-recording:11113014/1'));
    expect((recording!.data as { url: string }).url).toBe('https://dtgj2yu3gmlic.cloudfront.net/AR0016657.mp3');
    // The Drive links are relink-drive's, still on the proxy.
    const event = await catalog.get(await idForKey('mafteiach-occasion:11113014'));
    expect(JSON.stringify(event!.data)).toContain('/drive/');
    await approveAll((await relinkDriveLinks(catalog)).suggestions);
    expect(await runImport(catalog, sichosKodeshOccasionsImporter(entries()), { dryRun: true })).toMatchObject({ created: 0, updated: 0 });
  });
});
