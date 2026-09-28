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
  /** Only these pages (1-based), for a sample of a long book; every page when left out. */
  pages?: readonly number[];
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
    const numbers = options.pages ? [...new Set(options.pages)].filter((n) => n >= 1 && n <= doc.numPages).sort((a, b) => a - b) : Array.from({ length: doc.numPages }, (_, i) => i + 1);
    for (const number of numbers) {
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

/** An encoded picture of a page: JPEG bytes and their size in pixels. */
export interface EncodedImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

export interface PageImage {
  number: number;
  widthPt: number;
  heightPt: number;
  /** The page as a reader sees it, `width` pixels across. */
  image: EncodedImage;
  /** A small copy for lists and a viewer's strip of pages. */
  thumb: EncodedImage;
  /** The thumbnail in grey, for the page's perceptual hash. */
  bitmap: PageBitmap;
}

export interface PageImageOptions {
  /** Pixels across a page image (1600 reads well on a phone, zoomed). */
  width?: number;
  /** Pixels across a thumbnail. */
  thumbWidth?: number;
  /** JPEG quality, 0-100. */
  quality?: number;
  pages?: readonly number[];
}

/** The page images' version, as their derivations' `encoder`: bumped whenever an image would come out differently. */
export const PAGE_IMAGES_ENCODER = 'page-images@1';

/**
 * Each page drawn in colour as a JPEG page image and a thumbnail (the
 * plan, section 8: "page images and thumbnails", regenerable from the
 * PDF): what a scan's IIIF manifest shows, and the site's scan viewer.
 */
export async function* renderPageImages(data: Uint8Array, options: PageImageOptions = {}): AsyncGenerator<PageImage> {
  const width = options.width ?? 1600;
  const thumbWidth = options.thumbWidth ?? 240;
  const quality = options.quality ?? 82;
  const { createCanvas } = await import('@napi-rs/canvas');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
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
    const numbers = options.pages ? [...new Set(options.pages)].filter((n) => n >= 1 && n <= doc.numPages).sort((a, b) => a - b) : Array.from({ length: doc.numPages }, (_, i) => i + 1);
    for (const number of numbers) {
      const page = await doc.getPage(number);
      const unscaled = page.getViewport({ scale: 1 });
      // Never drawn larger than four times the page's own size: a tiny page stays a small picture.
      const viewport = page.getViewport({ scale: Math.min(width / unscaled.width, 4) });
      const w = Math.ceil(viewport.width);
      const h = Math.ceil(viewport.height);
      const canvas = createCanvas(w, h);
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, w, h);
      await page.render({ canvas: canvas as unknown as HTMLCanvasElement, canvasContext: context as unknown as CanvasRenderingContext2D, viewport }).promise;
      const tw = Math.min(thumbWidth, w);
      const th = Math.max(1, Math.round((h * tw) / w));
      const thumb = createCanvas(tw, th);
      const small = thumb.getContext('2d');
      small.drawImage(canvas, 0, 0, tw, th);
      const rgba = small.getImageData(0, 0, tw, th).data;
      const gray = new Uint8Array(tw * th);
      for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (rgba[j]! * 299 + rgba[j + 1]! * 587 + rgba[j + 2]! * 114) / 1000;
      const [imageBytes, thumbBytes] = await Promise.all([canvas.encode('jpeg', quality), thumb.encode('jpeg', quality)]);
      page.cleanup();
      yield {
        number,
        widthPt: unscaled.width,
        heightPt: unscaled.height,
        image: { bytes: new Uint8Array(imageBytes), width: w, height: h },
        thumb: { bytes: new Uint8Array(thumbBytes), width: tw, height: th },
        bitmap: { width: tw, height: th, gray },
      };
    }
  } finally {
    await task.destroy();
  }
}
