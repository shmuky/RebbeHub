import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { levelPdf } from '@rebbehub/pdf-fix';
import { canvasClip, canvasTransform, compose, fixesByPage, invert, type Matrix } from '../app/reader/pageFix.js';
import { drawPage } from '../../../packages/pdf-fix/tests/page.js';

/**
 * The reader draws a linked file through its page fix instead of a fixed
 * copy. Drawn so, a page must look the way the fixed copy looks: pdf.js
 * (the same build the analysis uses) draws both here and they are compared
 * pixel by pixel.
 */

async function draw(data: Uint8Array, fix?: number[]): Promise<{ gray: Uint8Array; width: number; height: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0 });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1.5 });
    const factory = doc.canvasFactory as { create(w: number, h: number): { canvas: unknown; context: CanvasRenderingContext2D } };
    const { canvas, context } = factory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const transform = fix ? canvasTransform(viewport.transform as Matrix, fix as Matrix) : undefined;
    await page.render({ canvas: canvas as HTMLCanvasElement, canvasContext: context, viewport, ...(transform ? { transform } : {}) }).promise;
    const { width, height } = viewport;
    const rgba = context.getImageData(0, 0, Math.ceil(width), Math.ceil(height)).data;
    const gray = new Uint8Array(rgba.length / 4);
    for (let i = 0; i < gray.length; i++) gray[i] = rgba[i * 4]!;
    return { gray, width: Math.ceil(width), height: Math.ceil(height) };
  } finally {
    await task.destroy();
  }
}

describe("the reader's page fixes", () => {
  it('composes and inverts matrices', () => {
    const m: Matrix = [0.99, 0.02, -0.02, 0.99, 3, -4];
    const identity = compose(m, invert(m)).map((n) => Math.round(n * 1e9) / 1e9);
    expect(identity).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('draws a leaning page the way its turned copy looks', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 400]).drawImage(await doc.embedPng(drawPage({ width: 600, height: 800, tilt: 1.5 }).png), { x: 0, y: 0, width: 300, height: 400 });
    const original = await doc.save();
    const { pdf, report } = await levelPdf(original);
    const [copy, drawn] = await Promise.all([draw(pdf!), draw(original, report.turned[0]!.transform)]);
    let differ = 0;
    for (let i = 0; i < copy.gray.length; i++) if (Math.abs(copy.gray[i]! - drawn.gray[i]!) > 64) differ += 1;
    // Anti-aliasing at the letters' edges aside, the same picture.
    expect(differ / copy.gray.length).toBeLessThan(0.005);
    // And it is not the page as scanned.
    const scanned = await draw(original);
    let moved = 0;
    for (let i = 0; i < copy.gray.length; i++) if (Math.abs(copy.gray[i]! - scanned.gray[i]!) > 64) moved += 1;
    expect(moved / copy.gray.length).toBeGreaterThan(0.02);
  });

  it('turns a cut in points into canvas pixels, y downwards', () => {
    // A 300 × 400 point page at 2 pixels a point: pdf.js's viewport matrix.
    expect(canvasClip([2, 0, 0, -2, 0, 800], [10, 20, 290, 380])).toEqual([20, 40, 560, 720]);
  });

  it('keeps only well-formed fixes', () => {
    const fixes = fixesByPage([
      { page: 1, transform: [1, 0, 0, 1, 0, 0] },
      { page: 2, transform: [1, 0, 0, 1] },
      { page: 3, transform: [1, 0, 0, 1, 0, Number.NaN] },
      { page: 4, transform: [1, 0, 0, 1, 0, 0], clip: [0, 0, 10] },
    ]);
    expect([...fixes.keys()]).toEqual([1, 4]);
    expect(fixes.get(4)).toEqual({ page: 4, transform: [1, 0, 0, 1, 0, 0] });
  });
});
