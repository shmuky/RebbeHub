import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * Whether a PDF is a scan at all, told without drawing it. A scanned page
 * is one picture over (most of) the page, with or without an invisible OCR
 * text layer on top; a page set in type draws its letters as text or as
 * outlines. pdf.js's list of drawing operations for a few pages says which
 * in a fraction of the time drawing them takes, so a born-digital book of
 * five hundred pages is passed over in a second.
 */

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));

export interface PdfKind {
  pages: number;
  /** `scan` when most of the pages looked at are one picture each. */
  kind: 'scan' | 'born-digital';
  /** The pages looked at, and how many of them are scanned. */
  sampled: number[];
  scanned: number;
}

/** A picture covering at least this share of the page makes the page a scanned one. */
export const SCAN_COVER = 0.5;

/** `count` page numbers spread evenly through a document of `pages`, first and last included. */
export function spread(pages: number, count: number): number[] {
  if (pages <= count) return Array.from({ length: pages }, (_, i) => i + 1);
  return [...new Set(Array.from({ length: count }, (_, i) => 1 + Math.round((i * (pages - 1)) / (count - 1))))];
}

type Matrix = [number, number, number, number, number, number];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  n[0] * m[0] + n[1] * m[2],
  n[0] * m[1] + n[1] * m[3],
  n[2] * m[0] + n[3] * m[2],
  n[2] * m[1] + n[3] * m[3],
  n[4] * m[0] + n[5] * m[2] + m[4],
  n[4] * m[1] + n[5] * m[3] + m[5],
];

/** Looks at `sample` pages spread through the file (default 6). */
export async function inspectPdf(data: Uint8Array, options: { sample?: number } = {}): Promise<PdfKind> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { OPS } = pdfjs;
  // One picture drawn over the page: its unit square, through the transform in force, covers the page.
  const pictures = new Set<number>([OPS.paintImageXObject, OPS.paintImageMaskXObject, OPS.paintInlineImageXObject]);
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    wasmUrl: `${path.join(pdfjsRoot, 'wasm')}/`,
    cMapUrl: `${path.join(pdfjsRoot, 'cmaps')}/`,
    cMapPacked: true,
    standardFontDataUrl: `${path.join(pdfjsRoot, 'standard_fonts')}/`,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const sampled = spread(doc.numPages, options.sample ?? 6);
    let scanned = 0;
    for (const number of sampled) {
      const page = await doc.getPage(number);
      const [x0, y0, x1, y1] = page.view as [number, number, number, number];
      const area = Math.abs((x1 - x0) * (y1 - y0)) || 1;
      const { fnArray, argsArray } = await page.getOperatorList();
      const stack: Matrix[] = [];
      let ctm: Matrix = [1, 0, 0, 1, 0, 0];
      let largest = 0;
      for (let i = 0; i < fnArray.length; i++) {
        const fn = fnArray[i]!;
        const args = argsArray[i] as unknown[] | null;
        if (fn === OPS.save) stack.push(ctm);
        else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
        else if (fn === OPS.transform) ctm = multiply(ctm, args as Matrix);
        else if (fn === OPS.paintFormXObjectBegin) {
          stack.push(ctm);
          const matrix = args?.[0] as Matrix | null | undefined;
          if (matrix && matrix.length === 6) ctm = multiply(ctm, matrix);
        } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm;
        else if (pictures.has(fn)) largest = Math.max(largest, Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]) / area);
      }
      page.cleanup();
      if (largest >= SCAN_COVER) scanned += 1;
    }
    return { pages: doc.numPages, kind: scanned * 2 >= sampled.length && scanned > 0 ? 'scan' : 'born-digital', sampled, scanned };
  } finally {
    await task.destroy();
  }
}
