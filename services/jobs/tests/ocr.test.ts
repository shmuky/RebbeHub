import { describe, expect, it } from 'vitest';
import type { EntityId } from '@rebbehub/model';
import { registerFile } from '@rebbehub/core';
import { linesFromTsv, readScans, scansToRead, type OcrEngine } from '../src/ocr.js';
import { add, freshCatalog } from '../../../packages/core/tests/helpers.js';

const TSV = `level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext
1\t1\t0\t0\t0\t0\t0\t0\t1000\t2000\t-1\t
5\t1\t1\t1\t1\t1\t600\t100\t200\t40\t91\tבס״ד
5\t1\t1\t1\t1\t2\t400\t105\t150\t40\t90\tשיחה
5\t1\t1\t1\t2\t1\t500\t200\t300\t50\t88\tא.
5\t1\t1\t1\t2\t2\t100\t200\t10\t10\t10\t 
`;

describe('machine OCR', () => {
  it("reads Tesseract's TSV as lines, with boxes as fractions of the page", () => {
    expect(linesFromTsv(TSV)).toEqual([
      { id: 'l1', text: 'בס״ד שיחה', box: [0.4, 0.05, 0.4, 0.0225] },
      { id: 'l2', text: 'א.', box: [0.5, 0.1, 0.3, 0.025] },
    ]);
  });

  it('adds a machine layer to each served scan without one, once, as the bot, approved by a steward', async () => {
    const { catalog, set } = await freshCatalog();
    const sha = (n: string) => n.repeat(64);
    const scan = async (file: string) => {
      const publication = await add(catalog, 'mendy', 'keeper', 'publication', { kind: 'book-volume', title: { he: 'כרך' }, sets: [set] });
      return add(catalog, 'mendy', 'keeper', 'scan', { publication, file, completeness: 'complete', sets: [set] });
    };
    await registerFile(catalog.db, { sha256: sha('a'), bytes: 10, mime: 'application/pdf', source: 'contribution', licence: 'cc0', held: true });
    await registerFile(catalog.db, { sha256: sha('b'), bytes: 10, mime: 'application/pdf', source: 'contribution', licence: 'unknown', held: true });
    const served = await scan(sha('a'));
    await scan(sha('b')); // kept privately: never read

    const engine: OcrEngine = {
      name: 'fake',
      version: async () => '1.0',
      pages: async () => ['p1.png', 'p2.png'],
      lines: async (image) => [{ id: 'l1', text: `שורה ${image}`, box: [0, 0, 1, 0.1] }],
    };
    const done = await readScans(catalog, { approveAs: 'shmuly', engine, fetchFile: async () => new Uint8Array([37, 80, 68, 70]) });
    expect(done).toEqual([{ scan: served, pages: 2, lines: 2 }]);

    const layers = await catalog.list({ type: 'text-layer' });
    expect(layers.map((l) => (l.data as { kind: string }).kind).sort()).toEqual(['community', 'machine-ocr']);
    const machine = layers.find((l) => (l.data as { kind: string }).kind === 'machine-ocr')!;
    expect(machine.data).toMatchObject({ scan: served, engine: { name: 'fake', version: '1.0' } });
    expect(layers.find((l) => l.id !== machine.id)!.data).toMatchObject({ scan: served, seededFrom: machine.id });
    const pages = await catalog.list({ type: 'text-page' });
    expect(pages.map((p) => (p.data as { page: number; proofread: number }).page).sort()).toEqual([1, 2]);
    expect(pages.every((p) => (p.data as { proofread: number }).proofread === 0)).toBe(true);
    expect(await scansToRead(catalog)).toEqual([]);
    expect((await catalog.history(machine.id as EntityId))[0]).toMatchObject({ author: 'bot:ocr', mergedBy: 'shmuly', authorIsBot: true });
  });
});

describe('fix this line', () => {
  it('shows the machine page, and a fix makes the community page with that line checked', async () => {
    const { catalog, set } = await freshCatalog();
    const { fixLine, scanText } = await import('@rebbehub/core');
    await registerFile(catalog.db, { sha256: 'c'.repeat(64), bytes: 10, mime: 'application/pdf', source: 'contribution', licence: 'cc0', held: true });
    const publication = await add(catalog, 'mendy', 'keeper', 'publication', { kind: 'book-volume', title: { he: 'כרך' }, sets: [set] });
    const scan = await add(catalog, 'mendy', 'keeper', 'scan', { publication, file: 'c'.repeat(64), completeness: 'complete', sets: [set] });
    const engine: OcrEngine = {
      name: 'fake',
      version: async () => '1.0',
      pages: async () => ['p1.png'],
      lines: async () => [
        { id: 'l1', text: 'בס"ד', box: [0, 0, 1, 0.1] },
        { id: 'l2', text: 'שיחח א', box: [0, 0.1, 1, 0.1] },
      ],
    };
    await readScans(catalog, { approveAs: 'shmuly', engine, fetchFile: async () => new Uint8Array([1]) });

    const before = (await scanText(catalog, scan, 1))!;
    expect(before).toMatchObject({ pages: 1, machine: true, engine: { name: 'fake' } });
    expect(before.lines.map((l) => l.checked)).toEqual([false, false]);

    const fix = await fixLine(catalog, 'chaim', { scan, page: 1, line: 'l2', text: '  שיחה א׳ ' });
    expect(fix.status).toBe('open');
    await catalog.merge(fix.id, 'keeper');

    const after = (await scanText(catalog, scan, 1))!;
    expect(after.machine).toBe(false);
    expect(after.lines).toMatchObject([
      { id: 'l1', text: 'בס"ד', checked: false },
      { id: 'l2', text: 'שיחה א׳', checked: true },
    ]);
    // The machine's own reading is kept as it came.
    const machinePage = (await catalog.list({ type: 'text-page' })).find((p) => p.id !== after.pageId)!;
    expect((machinePage.data as { lines: Array<{ text: string }> }).lines[1]!.text).toBe('שיחח א');
    await expect(fixLine(catalog, 'chaim', { scan, page: 1, line: 'l9', text: 'x' })).rejects.toThrow(/line l9/);

    // A better engine reads it again: the machine layer takes the new reading, and the community page
    // takes it too, except the line Chaim checked.
    const better: OcrEngine = {
      ...engine,
      version: async () => '2.0',
      lines: async () => [
        { id: 'l1', text: 'ב"ה', box: [0, 0, 1, 0.1] },
        { id: 'l2', text: 'שיחה א (מכונה)', box: [0, 0.1, 1, 0.1] },
        { id: 'l3', text: 'שורה חדשה', box: [0, 0.3, 1, 0.1] },
      ],
    };
    expect(await readScans(catalog, { approveAs: 'shmuly', engine: better, fetchFile: async () => new Uint8Array([1]) })).toEqual([]);
    expect(await readScans(catalog, { approveAs: 'shmuly', engine: better, reread: true, fetchFile: async () => new Uint8Array([1]) })).toEqual([{ scan, pages: 1, lines: 3 }]);
    const reread = (await scanText(catalog, scan, 1))!;
    expect(reread.engine).toEqual({ name: 'fake', version: '2.0' });
    expect(reread.lines.map((l) => [l.text, l.level])).toEqual([
      ['ב"ה', 0],
      ['שיחה א׳', 1],
      ['שורה חדשה', 0],
    ]);
    expect((await catalog.list({ type: 'text-layer' })).length).toBe(2);
    expect(await readScans(catalog, { approveAs: 'shmuly', engine: better, reread: true, fetchFile: async () => new Uint8Array([1]) })).toEqual([]);
  });
});
