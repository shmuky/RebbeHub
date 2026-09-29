import { createHash } from 'node:crypto';
import { PDFDocument, rgb } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { coversOf, getDerivations, getFile, hebrewBooksPdfUrl, registerFile } from '@rebbehub/core';
import { makeCovers } from '../src/covers.js';
import type { ObjectStore } from '../src/readingCopies.js';
import { add, freshCatalog } from '../../../packages/core/tests/helpers.js';

/**
 * Sefarim's covers from their title pages, drawn from a real PDF made here:
 * a blank page, a title page (a few short centred lines), and pages of text.
 */

type Block = [number, number, number, number];

/** A PDF whose pages are dark blocks where each page's list says (x, y from the top, width, height, as fractions). */
async function bookPdf(pages: Block[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const blocks of pages) {
    const page = doc.addPage([300, 420]);
    for (const [x, y, w, h] of blocks) page.drawRectangle({ x: x * 300, y: (1 - y - h) * 420, width: w * 300, height: h * 420, color: rgb(0.05, 0.05, 0.05) });
  }
  return doc.save();
}

const title: Block[] = [
  [0.3, 0.2, 0.4, 0.04],
  [0.35, 0.3, 0.3, 0.02],
  [0.4, 0.7, 0.2, 0.015],
  [0.42, 0.75, 0.16, 0.015],
];
const body: Block[] = Array.from({ length: 30 * 10 }, (_, k) => [0.1 + (k % 10) * 0.08, 0.07 + Math.floor(k / 10) * 0.028, 0.05, 0.012] as Block);

function memoryStore(): ObjectStore & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return { objects, get: async (key) => objects.get(key) ?? null, has: async (key) => objects.has(key), put: async (key, bytes) => void objects.set(key, bytes) };
}

describe('rebbehub covers', () => {
  it("draws a sefer's title page past a blank first page, then a page a keeper chose", async () => {
    const { catalog, set } = await freshCatalog();
    const pdf = await bookPdf([[], title, body, body]);
    const sha256 = createHash('sha256').update(pdf).digest('hex');
    await registerFile(catalog.db, { sha256, bytes: pdf.byteLength, mime: 'application/pdf', source: 'contribution', licence: 'cc0', held: true });
    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'ספר' }, slug: 'sefer', authors: [], genre: 'sichos', levels: ['volume'], sets: [set] });
    const pub = await add(catalog, 'mendy', 'keeper', 'publication', { kind: 'book-volume', title: { he: 'דפוס' }, work });
    await add(catalog, 'mendy', 'keeper', 'scan', { publication: pub, file: sha256, completeness: 'complete' });

    const store = memoryStore();
    const fetchFile = async (sha: string) => {
      if (sha !== sha256) throw new Error('no such file');
      return pdf;
    };
    expect(await makeCovers(catalog, { fetchFile, store })).toEqual([{ work, file: sha256, page: 2, machine: true }]);
    const cover = (await coversOf(catalog.db, [work]))[work]!;
    expect(cover).toMatchObject({ page: 2, machine: true, image: { width: 480 }, thumb: { width: 180 } });
    expect(store.objects.has(`objects/${cover.image.sha256}`)).toBe(true);
    expect((await getDerivations(catalog.db, sha256)).map((d) => d.profile).sort()).toEqual(['cover-thumb/2', 'cover/2']);
    // Nothing left to do until something changes.
    expect(await makeCovers(catalog, { fetchFile, store })).toEqual([]);

    // A keeper chooses page 4; a page past the end falls back to page 1.
    const choose = async (page: number) => {
      const cs = await catalog.createChangeset('mendy', { title: 'Cover' });
      await catalog.putRevision(cs.id, 'mendy', { id: work, type: 'work', data: { ...((await catalog.get(work))!.data as object), cover: { file: sha256, page } } });
      await catalog.submit(cs.id, 'mendy');
      await catalog.merge(cs.id, 'keeper');
    };
    await choose(4);
    expect(await makeCovers(catalog, { fetchFile, store })).toEqual([{ work, file: sha256, page: 4, machine: false }]);
    expect((await coversOf(catalog.db, [work]))[work]).toMatchObject({ page: 4, machine: false, reasons: ['chosen by a person'] });
    await choose(40);
    expect(await makeCovers(catalog, { fetchFile, store })).toEqual([{ work, file: sha256, page: 1, machine: true }]);
  }, 60_000);

  it('draws a cover from a PDF only linked: fetched from its link, kept in the preservation bucket, the cover served', async () => {
    const { catalog, set } = await freshCatalog();
    const otzros = await bookPdf([title, body]);
    const hebrewBooks = await bookPdf([[], [], title, body]);
    const otzrosSha = createHash('sha256').update(otzros).digest('hex');
    const hebrewBooksSha = createHash('sha256').update(hebrewBooks).digest('hex');
    const driveUrl = 'https://drive.google.com/file/d/1OtzrosAbCdEf/view';
    // An Otzros library PDF on Drive, known but not held (page-fixes registers it so).
    await registerFile(catalog.db, { sha256: otzrosSha, bytes: otzros.byteLength, mime: 'application/pdf', source: 'other', licence: 'free-to-read', fileClass: 'publisher-scan', credit: 'אוצרות הרבי', url: driveUrl, held: false });
    const work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'ספר' }, slug: 'sefer', authors: [], genre: 'sichos', levels: ['volume'], sets: [set] });
    await add(catalog, 'mendy', 'keeper', 'unit', {
      work,
      position: [{ level: 'volume', value: '1' }],
      order: 'a0',
      label: { he: 'א' },
      editions: [{ source: 'other', sourceId: '1OtzrosAbCdEf', kind: 'pdf', licence: 'free-to-read', url: driveUrl }],
    });
    // A sefer on HebrewBooks only, and one whose scan HebrewBooks will not give.
    const hb = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'ספר בהיברו בוקס' }, slug: 'hb', authors: [], genre: 'sichos', levels: ['volume'], sets: [set] });
    await add(catalog, 'mendy', 'keeper', 'publication', { kind: 'book-volume', title: { he: 'דפוס' }, work: hb, identifiers: { hebrewbooks: '111' } });
    const gone = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'ספר שאיננו' }, slug: 'gone', authors: [], genre: 'sichos', levels: ['volume'], sets: [set] });
    await add(catalog, 'mendy', 'keeper', 'publication', { kind: 'book-volume', title: { he: 'דפוס' }, work: gone, identifiers: { hebrewbooks: '222' } });

    const store = memoryStore();
    const preservation = memoryStore();
    const fetched: string[] = [];
    const fetchLinked = async (url: string) => {
      fetched.push(url);
      if (url === driveUrl) return otzros;
      if (url === hebrewBooksPdfUrl('111')) return hebrewBooks;
      throw new Error('404');
    };
    const fetchFile = async () => {
      throw new Error('nothing here is served');
    };
    const lines: string[] = [];

    // Without the preservation bucket, they wait.
    expect(await makeCovers(catalog, { fetchFile, fetchLinked, store, log: (l) => lines.push(l) })).toEqual([]);
    expect(fetched).toEqual([]);
    expect(lines.at(-1)).toMatch(/3 sefarim whose PDFs are only linked wait/);

    const done = await makeCovers(catalog, { fetchFile, fetchLinked, store, preservation, log: (l) => lines.push(l) });
    expect(done.sort((a, b) => a.work.localeCompare(b.work))).toEqual(
      [
        { work, file: otzrosSha, page: 1, machine: true },
        { work: hb, file: hebrewBooksSha, page: 3, machine: true },
      ].sort((a, b) => a.work.localeCompare(b.work)),
    );
    // The PDFs are kept privately, never in the public bucket; the covers are public.
    expect([...preservation.objects.keys()].sort()).toEqual([`objects/${otzrosSha}`, `objects/${hebrewBooksSha}`].sort());
    expect(store.objects.has(`objects/${otzrosSha}`)).toBe(false);
    expect(await getFile(catalog.db, otzrosSha)).toMatchObject({ rights_state: 'link', storage_tier: 'preservation' });
    expect(await getFile(catalog.db, hebrewBooksSha)).toMatchObject({ rights_state: 'link', storage_tier: 'preservation', credit: 'HebrewBooks.org' });
    const covers = await coversOf(catalog.db, [work, hb, gone]);
    expect(Object.keys(covers).sort()).toEqual([work, hb].sort());
    expect(covers[hb]).toMatchObject({ page: 3, machine: true, credit: 'HebrewBooks.org' });
    expect(store.objects.has(`objects/${covers[hb]!.image.sha256}`)).toBe(true);
    expect(await getFile(catalog.db, covers[hb]!.image.sha256)).toMatchObject({ rights_state: 'credit', storage_tier: 'public' });
    expect(lines.some((l) => l.includes(`${gone}: ${hebrewBooksPdfUrl('222')}: 404`))).toBe(true);

    // Nothing left to do: the scan HebrewBooks would not give is not asked for again.
    fetched.length = 0;
    expect(await makeCovers(catalog, { fetchFile, fetchLinked, store, preservation })).toEqual([]);
    expect(fetched).toEqual([]);
  }, 60_000);
});
