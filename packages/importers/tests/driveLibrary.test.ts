import { beforeEach, describe, expect, it } from 'vitest';
import type { Catalog } from '@rebbehub/core';
import { driveLibraryImporter, idForKey, listDriveFolder, OTZROS_SET, otzrosFolderSetKey, parseFolderView, runImport, type DriveFolder, type ImportRecord } from '@rebbehub/importers';
import { freshCatalog } from '../../core/tests/helpers.js';

/** Drive's public folder view, as far as the importer reads it. */
const view = (entries: Array<{ id: string; title: string; folder?: boolean }>) =>
  entries
    .map((e) => `<div class="flip-entry" id="entry-${e.id}" tabindex="0"><div class="flip-entry-info"><a href="https://drive.google.com/${e.folder ? `drive/folders/${e.id}` : `file/d/${e.id}/view?usp=drive_web`}" target="_blank"><div class="flip-entry-title">${e.title}</div></a></div></div>`)
    .join('');

const SITE: Record<string, string> = {
  root: view([
    { id: 'torah', title: '1. תורת כ&quot;ק אד&quot;ש', folder: true },
    { id: 'empty', title: '9. ריק', folder: true },
  ]),
  torah: view([
    { id: 'lks', title: 'לקוטי שיחות', folder: true },
    { id: 'maamarim', title: 'ספר המאמרים', folder: true },
  ]),
  lks: view([
    { id: 'f10', title: '10.pdf' },
    { id: 'f2', title: '02.pdf' },
    { id: 'notes', title: 'readme.txt' },
  ]),
  // A folder with a PDF of its own and folders of PDFs: a sefer, and a Set of the sefarim in it.
  maamarim: view([
    { id: 'm-index', title: 'מפתח.pdf' },
    { id: 'y5711', title: '5711', folder: true },
  ]),
  y5711: view([{ id: 'm5711', title: 'א.pdf' }]),
  empty: view([{ id: 'nothing', title: 'readme.txt' }]),
};

const fetchSite = (async (url: string) => new Response(SITE[/id=([\w-]+)/.exec(url)![1]!] ?? '')) as unknown as typeof globalThis.fetch;
const library = () => listDriveFolder({ id: 'root', title: 'ספרי ליובאוויטש' }, { fetch: fetchSite });

async function recordsOf(tree: DriveFolder): Promise<ImportRecord[]> {
  const records: ImportRecord[] = [];
  for await (const r of driveLibraryImporter(tree).records()) records.push(r);
  return records;
}

const refs = (value: unknown) => ((value as Array<{ $ref: string }>) ?? []).map((r) => r.$ref);

describe("Otzros HaRebbe's Drive library", () => {
  it('reads a folder view', () => {
    expect(parseFolderView(SITE.root!)).toEqual({
      folders: [
        { id: 'torah', title: '1. תורת כ"ק אד"ש' },
        { id: 'empty', title: '9. ריק' },
      ],
      files: [],
    });
  });

  it('makes a sefer of every folder of PDFs and a page of every PDF, linked to its exact file on Drive', async () => {
    const records = await recordsOf(await library());
    const work = records.find((r) => r.key === 'otzros-work:lks')!;
    expect(work.data).toMatchObject({ title: { he: 'לקוטי שיחות' }, genre: 'sichos', description: { he: '1. תורת כ"ק אד"ש' } });
    const units = records.filter((r) => r.type === 'unit' && refs([(r.data as { work: unknown }).work])[0] === 'otzros-work:lks');
    expect(units.map((u) => (u.data as { label: { he: string } }).label.he)).toEqual(['02', '10']); // in number order; not the .txt
    // The file's own Drive link; the site's reader opens it through RebbeHub's API.
    expect((units[0]!.data as { editions: Array<{ url: string }> }).editions.map((e) => e.url)).toEqual(['https://drive.google.com/file/d/f2/view']);
  });

  it("makes the library's folders a tree of Sets, each sefer in its folder's Set", async () => {
    const records = await recordsOf(await library());
    const sets = records.filter((r) => r.key.startsWith('otzros-folder:'));
    // Folders that hold folders of PDFs; not the sefarim's own folders, not an empty branch.
    expect(sets.map((s) => s.key)).toEqual([otzrosFolderSetKey('torah'), otzrosFolderSetKey('maamarim')]);
    const [torah, maamarim] = sets;
    expect(torah!.data).toMatchObject({ name: { he: '1. תורת כ"ק אד"ש' }, parent: { $ref: OTZROS_SET.key } });
    expect(torah!.path).toMatch(/^\/sets\/otzros\/[0-9a-f]{12}$/);
    expect(maamarim!.data).toMatchObject({ name: { he: 'ספר המאמרים' }, parent: { $ref: otzrosFolderSetKey('torah') }, description: { he: '1. תורת כ"ק אד"ש' } });
    // Each sefer: its genre, the library, and the Set of the folder it is in.
    const setsOf = (key: string) => refs((records.find((r) => r.key === key)!.data as { sets: unknown }).sets);
    expect(setsOf('otzros-work:lks')).toEqual(['rebbehub-set:sichos', OTZROS_SET.key, otzrosFolderSetKey('torah')]);
    expect(setsOf('otzros-work:maamarim')).toEqual(['rebbehub-set:sichos', OTZROS_SET.key, otzrosFolderSetKey('torah')]);
    expect(setsOf('otzros-work:y5711')).toEqual(['rebbehub-set:sichos', OTZROS_SET.key, otzrosFolderSetKey('maamarim')]);
    // A folder named only by its year is named with the folder it is in.
    expect((records.find((r) => r.key === 'otzros-work:y5711')!.data as { title: { he: string } }).title.he).toBe('ספר המאמרים 5711');
    // A Set comes before what is in it.
    const at = (key: string) => records.findIndex((r) => r.key === key);
    expect(at(otzrosFolderSetKey('torah'))).toBeLessThan(at(otzrosFolderSetKey('maamarim')));
    expect(at(otzrosFolderSetKey('maamarim'))).toBeLessThan(at('otzros-work:y5711'));
  });
});

describe('the Otzros import, run again', () => {
  let catalog: Catalog;
  beforeEach(async () => {
    ({ catalog } = await freshCatalog());
  });

  /** A person's change, suggested and approved. */
  async function personChanges(key: string, change: (data: Record<string, unknown>) => Record<string, unknown> | null, path?: string) {
    const item = (await catalog.get(await idForKey(key)))!;
    const cs = await catalog.createChangeset('mendy', { title: 'Sorting' });
    await catalog.putRevision(cs.id, 'mendy', { id: item.id, type: item.type, data: change(structuredClone(item.data) as Record<string, unknown>) as never, ...(path ? { path } : {}) });
    await catalog.submit(cs.id, 'mendy');
    await catalog.merge(cs.id, 'shmuly');
    return item.id;
  }

  it('adds the tree to sefarim already imported, keeping their paths', async () => {
    // As before this change: every sefer only in its genre and the library.
    const tree = await library();
    const flat = driveLibraryImporter(tree);
    const before = { ...flat, records: async function* () {
      for await (const r of flat.records() as AsyncIterable<ImportRecord>) {
        if (r.key.startsWith('otzros-folder:')) continue;
        if (r.type === 'work') yield { ...r, data: { ...(r.data as object), sets: (r.data as { sets: unknown[] }).sets.slice(0, 2) } };
        else yield r;
      }
    } };
    await runImport(catalog, before, { approveAs: 'shmuly' });
    const path = (await catalog.get(await idForKey('otzros-work:lks')))!.path;
    const again = await runImport(catalog, driveLibraryImporter(tree), { approveAs: 'shmuly' });
    expect(again).toMatchObject({ created: 2, updated: 3 }); // two Sets; three sefarim join theirs
    const work = (await catalog.get(await idForKey('otzros-work:lks')))!;
    expect(work.path).toBe(path);
    expect((work.data as { sets: string[] }).sets).toContain(await idForKey(otzrosFolderSetKey('torah')));
  });

  it('leaves what people moved, re-parented or deleted since as they left it', async () => {
    const tree = await library();
    await runImport(catalog, driveLibraryImporter(tree), { approveAs: 'shmuly' });
    const genre = await idForKey('rebbehub-set:sichos');
    // A person sorts the Likkutei Sichos folder's sefer out of the tree, and gives it a path of its own.
    await personChanges('otzros-work:lks', (d) => ({ ...d, sets: [genre] }), '/likkutei-sichos-otzros');
    // Another puts the ma'amarim's Set straight under the library.
    await personChanges(otzrosFolderSetKey('maamarim'), (d) => ({ ...d, parent: undefined }));
    // A third takes a page off (a duplicate, say).
    await personChanges('otzros-unit:f10', () => null);

    const again = await runImport(catalog, driveLibraryImporter(tree), { approveAs: 'shmuly' });
    expect(again.created).toBe(0);
    const lks = (await catalog.get(await idForKey('otzros-work:lks')))!;
    expect((lks.data as { sets: string[] }).sets).toEqual([genre]);
    expect(lks.path).toBe('/likkutei-sichos-otzros');
    expect((await catalog.get(await idForKey(otzrosFolderSetKey('maamarim'))))!.data).not.toHaveProperty('parent');
    expect(await catalog.get(await idForKey('otzros-unit:f10'))).toBeNull();
  });
});
