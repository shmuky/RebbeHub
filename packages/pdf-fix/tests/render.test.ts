import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { analyzePage } from '../src/analyze.js';
import { hasPoppler, parsePgm, renderPages } from '../src/render.js';
import { drawPage } from './page.js';

const popplerInstalled = await hasPoppler();

describe('drawing pages', () => {
  it('reads a PGM, comments and all', () => {
    const header = new TextEncoder().encode('P5\n# drawn by pdftoppm\n3 2\n255\n');
    const pgm = new Uint8Array([...header, 0, 50, 100, 150, 200, 255]);
    expect(parsePgm(pgm)).toEqual({ width: 3, height: 2, gray: new Uint8Array([0, 50, 100, 150, 200, 255]) });
    expect(() => parsePgm(new TextEncoder().encode('P6\n3 2\n255\n'))).toThrow('PGM');
  });

  // Poppler is used where it is installed (much faster on big scans); pdf.js everywhere else. Both must read the same tilt.
  it.skipIf(!popplerInstalled)('reads the same page the same way with Poppler as with pdf.js', async () => {
    const doc = await PDFDocument.create();
    for (const tilt of [1.1, -0.6]) {
      const page = doc.addPage([300, 400]);
      page.drawImage(await doc.embedPng(drawPage({ width: 600, height: 800, tilt, shift: 20 }).png), { x: 0, y: 0, width: 300, height: 400 });
    }
    // A crop box smaller than the media box: both draw the crop box.
    doc.getPage(1).setCropBox(10, 10, 280, 380);
    const pdf = await doc.save();
    const read = async (engine: 'auto' | 'pdfjs') => {
      const out = [];
      for await (const page of renderPages(pdf, { engine })) out.push({ number: page.number, width: page.bitmap.width, height: page.bitmap.height, widthPt: page.widthPt, angle: analyzePage(page.bitmap).angle });
      return out;
    };
    const [poppler, pdfjs] = await Promise.all([read('auto'), read('pdfjs')]);
    expect(poppler.map((p) => p.number)).toEqual([1, 2]);
    for (const [a, b] of poppler.map((p, i) => [p, pdfjs[i]!] as const)) {
      expect(a.widthPt).toBe(b.widthPt);
      expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1);
      expect(a.angle).toBeCloseTo(b.angle, 1);
    }
  });
});
