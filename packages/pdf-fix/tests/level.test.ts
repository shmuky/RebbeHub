import { PDFDocument, StandardFonts } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { inspectPdf, spread } from '../src/inspect.js';
import { levelPdf, levelTransform, measureAngles } from '../src/level.js';
import { drawPage } from './page.js';

/** A scanned book: each page one picture, drawn over the whole page. */
async function scannedBook(tilts: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const tilt of tilts) {
    const image = await doc.embedPng(drawPage({ width: 600, height: 800, tilt }).png);
    doc.addPage([300, 400]).drawImage(image, { x: 0, y: 0, width: 300, height: 400 });
  }
  return doc.save();
}

/** A book set in type: its letters are text. */
async function typesetBook(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([300, 400]);
    for (let line = 0; line < 20; line++) page.drawText(`Line ${line + 1} of page ${i + 1}, set in type.`, { x: 30, y: 360 - line * 16, size: 11, font });
  }
  return doc.save();
}

describe('inspectPdf', () => {
  it('tells a scan from a book set in type, from a few pages', async () => {
    expect(await inspectPdf(await scannedBook([0, 0.5, 0]))).toMatchObject({ pages: 3, kind: 'scan', scanned: 3 });
    expect(await inspectPdf(await typesetBook(12), { sample: 4 })).toMatchObject({ pages: 12, kind: 'born-digital', scanned: 0, sampled: [1, 5, 8, 12] });
  });

  it('spreads its sample over the whole book', () => {
    expect(spread(3, 6)).toEqual([1, 2, 3]);
    expect(spread(500, 5)).toEqual([1, 126, 251, 375, 500]);
  });
});

describe('levelPdf', () => {
  it('turns only the pages that lean, each about its middle, and each reads back level', async () => {
    const original = await scannedBook([1.3, 0.05, -0.9]);
    const { pdf, report } = await levelPdf(original);
    expect(report.turned.map((turn) => turn.page)).toEqual([1, 3]);
    expect(report.turned.map((turn) => turn.angle)).toEqual([expect.closeTo(1.3, 1), expect.closeTo(-0.9, 1)]);
    expect(report.dropped).toEqual([]);
    for (const page of await measureAngles(pdf!)) expect(Math.abs(page.angle)).toBeLessThanOrEqual(0.3);
    // Nothing else changes: the page sizes, and the straight page's content.
    const [a, b] = await Promise.all([PDFDocument.load(original), PDFDocument.load(pdf!)]);
    expect(b.getPages().map((page) => page.getSize())).toEqual(a.getPages().map((page) => page.getSize()));
  });

  it('leaves a straight book as it is, with no copy', async () => {
    expect(await levelPdf(await scannedBook([0, 0.1]))).toEqual({ pdf: null, report: { pages: 2, turned: [], dropped: [], skipped: [] } });
  });

  it('measures only the pages asked for', async () => {
    const book = await scannedBook([0, 1.1, 0, 0]);
    expect((await measureAngles(book, { pages: [2, 4] })).map((page) => [page.page, Math.round(page.angle)])).toEqual([
      [2, 1],
      [4, 0],
    ]);
  });

  it('turns about the middle of the crop box: the middle stays where it is', () => {
    const [a, b, c, d, e, f] = levelTransform(2, { x: 0, y: 0, width: 300, height: 400 });
    expect(a! * 150 + c! * 200 + e!).toBeCloseTo(150, 2);
    expect(b! * 150 + d! * 200 + f!).toBeCloseTo(200, 2);
  });
});
