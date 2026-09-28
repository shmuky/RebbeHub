import { createRequire } from 'node:module';
import path from 'node:path';
import type { PageBitmap } from './analyze.js';

/**
 * Draws a PDF's pages in greyscale with pdf.js (its legacy build, which
 * runs in Node) on @napi-rs/canvas - what the analysis looks at. JBIG2 and
 * JPEG 2000 scans need pdf.js's wasm decoders, read from pdfjs-dist.
 */

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));

export interface RenderedPage {
  /** 1-based, like the page numbers people use. */
  number: number;
  /** The page's size in PDF points, as it shows (its /Rotate applied). */
  widthPt: number;
  heightPt: number;
  /** The page's own /Rotate (0, 90, 180, 270). */
  rotate: number;
  bitmap: PageBitmap;
}

export interface RenderOptions {
  /** Pixels per PDF point (1.25 is 90 dpi: plenty to read a tilt to a fiftieth of a degree). */
  scale?: number;
}

/** Each page in turn (one bitmap in memory at a time). */
export async function* renderPages(data: Uint8Array, options: RenderOptions = {}): AsyncGenerator<RenderedPage> {
  const scale = options.scale ?? 1.25;
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    // pdf.js takes the buffer over; a copy keeps the caller's bytes whole.
    data: new Uint8Array(data),
    wasmUrl: `${path.join(pdfjsRoot, 'wasm')}/`,
    cMapUrl: `${path.join(pdfjsRoot, 'cmaps')}/`,
    cMapPacked: true,
    standardFontDataUrl: `${path.join(pdfjsRoot, 'standard_fonts')}/`,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    for (let number = 1; number <= doc.numPages; number++) {
      const page = await doc.getPage(number);
      const viewport = page.getViewport({ scale });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);
      // pdf.js's own factory: @napi-rs/canvas in Node.
      const factory = doc.canvasFactory as { create(width: number, height: number): { canvas: unknown; context: CanvasRenderingContext2D } };
      const { canvas, context } = factory.create(width, height);
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      await page.render({ canvas: canvas as HTMLCanvasElement, canvasContext: context, viewport }).promise;
      const rgba = context.getImageData(0, 0, width, height).data;
      const gray = new Uint8Array(width * height);
      for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (rgba[j]! * 299 + rgba[j + 1]! * 587 + rgba[j + 2]! * 114) / 1000;
      const unscaled = page.getViewport({ scale: 1 });
      page.cleanup();
      yield { number, widthPt: unscaled.width, heightPt: unscaled.height, rotate: page.rotate, bitmap: { width, height, gray } };
    }
  } finally {
    // Only the loading task tears the document's worker down.
    await task.destroy();
  }
}
