import { describe, expect, it } from 'vitest';
import { driveLibraryImporter, listDriveFolder, parseFolderView, type ImportRecord } from '@rebbehub/importers';

/** Drive's public folder view, as far as the importer reads it. */
const view = (entries: Array<{ id: string; title: string; folder?: boolean }>) =>
  entries
    .map((e) => `<div class="flip-entry" id="entry-${e.id}" tabindex="0"><div class="flip-entry-info"><a href="https://drive.google.com/${e.folder ? `drive/folders/${e.id}` : `file/d/${e.id}/view?usp=drive_web`}" target="_blank"><div class="flip-entry-title">${e.title}</div></a></div></div>`)
    .join('');

const SITE: Record<string, string> = {
  root: view([{ id: 'torah', title: '1. תורת כ&quot;ק אד&quot;ש', folder: true }]),
  torah: view([{ id: 'lks', title: 'לקוטי שיחות', folder: true }]),
  lks: view([
    { id: 'f10', title: '10.pdf' },
    { id: 'f2', title: '02.pdf' },
    { id: 'notes', title: 'readme.txt' },
  ]),
};

describe("Otzros HaRebbe's Drive library", () => {
  it('reads a folder view', () => {
    expect(parseFolderView(SITE.root!)).toEqual({ folders: [{ id: 'torah', title: '1. תורת כ"ק אד"ש' }], files: [] });
  });

  it('makes a sefer of every folder of PDFs and a page of every PDF, read in the site and linked to its exact file', async () => {
    const fetch = (async (url: string) => new Response(SITE[/id=([\w-]+)/.exec(url)![1]!] ?? '')) as unknown as typeof globalThis.fetch;
    const tree = await listDriveFolder({ id: 'root', title: 'ספרי ליובאוויטש' }, { fetch });
    const records: ImportRecord[] = [];
    for await (const r of driveLibraryImporter(tree).records()) records.push(r);
    const work = records.find((r) => r.type === 'work')!;
    expect(work.data).toMatchObject({ title: { he: 'לקוטי שיחות' }, genre: 'sichos', description: { he: '1. תורת כ"ק אד"ש' } });
    const units = records.filter((r) => r.type === 'unit');
    expect(units.map((u) => (u.data as { label: { he: string } }).label.he)).toEqual(['02', '10']); // in number order; not the .txt
    expect((units[0]!.data as { editions: Array<{ url: string }> }).editions.map((e) => e.url)).toEqual([
      'https://sichos-kodesh-media-proxy.shmuky.workers.dev/drive/f2?filename=f2.pdf',
      'https://drive.google.com/file/d/f2/view',
    ]);
  });
});
