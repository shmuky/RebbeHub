import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { analyzePage } from '../src/analyze.js';
import { checkFixed, fixPdf } from '../src/fix.js';
import { renderPages } from '../src/render.js';
import { drawPage } from './page.js';

/** A scanned PDF: each page one picture, drawn over the whole page. */
async function scannedPdf(pages: Array<Parameters<typeof drawPage>[0]>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const spec of pages) {
    const image = await doc.embedPng(drawPage(spec).png);
    const page = doc.addPage([spec.width / 2, spec.height / 2]);
    page.drawImage(image, { x: 0, y: 0, width: spec.width / 2, height: spec.height / 2 });
  }
  return doc.save();
}

async function measure(pdf: Uint8Array) {
  const out = [];
  for await (const page of renderPages(pdf, { scale: 2 })) out.push({ ...analyzePage(page.bitmap), width: page.bitmap.width });
  return out;
}

describe('fixPdf', () => {
  it('turns every page level, centres its text, cuts the edges off, and keeps the pages the same size', async () => {
    const original = await scannedPdf([
      { width: 600, height: 800, tilt: 1.6, shift: -45, edge: true },
      { width: 600, height: 800, tilt: -1.1, shift: 30, sheetEdge: true },
    ]);
    const { pdf, report } = await fixPdf(original);
    expect(report.fixed).toBe(2);
    expect(report.pages.map((page) => page.angle)).toEqual([expect.closeTo(1.6, 1), expect.closeTo(-1.1, 1)]);

    const after = await measure(pdf);
    for (const page of after) {
      expect(Math.abs(page.angle)).toBeLessThanOrEqual(0.1);
      // Centred across, top at the 5% margin, nothing of the scanner's left.
      expect((page.box!.left + page.box!.right) / 2).toBeCloseTo(page.width / 2, -1);
      expect(page.box!.top).toBeCloseTo(page.width * 0.05, -1);
      expect(page.setAside).toBe(0);
    }
    // One scale for the file: both text blocks come out the same width.
    expect(after[0]!.box!.right - after[0]!.box!.left).toBeCloseTo(after[1]!.box!.right - after[1]!.box!.left, -1);
    expect((await checkFixed(pdf, report)).ok).toBe(true);

    const [a, b] = await Promise.all([PDFDocument.load(original), PDFDocument.load(pdf)]);
    expect(b.getPages().map((page) => page.getSize())).toEqual(a.getPages().map((page) => page.getSize()));
  });

  it('leaves a blank page as it is', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 400]);
    const { report } = await fixPdf(await doc.save());
    expect(report).toMatchObject({ fixed: 0, pages: [{ number: 1, skipped: 'blank' }] });
  });
});
