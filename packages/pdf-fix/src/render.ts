import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { PageBitmap } from './analyze.js';

/**
 * Draws a PDF's pages in greyscale - what the analysis looks at. Poppler's
 * `pdftoppm` does it when it is installed (poppler-utils): it decodes a
 * big compressed scan a hundred times faster than pdf.js does in Node
 * (a 450 dpi page: 0.08 s against 12 s). Otherwise, and for any page
 * Poppler cannot read, pdf.js (its legacy build, which runs in Node) on
 * @napi-rs/canvas; JBIG2 and JPEG 2000 scans need its wasm decoders, read
 * from pdfjs-dist. The page's size and turn always come from pdf.js.
 */

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
const run = promisify(execFile);

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
  /** `pdfjs` to draw with pdf.js even where Poppler is installed. */
  engine?: 'auto' | 'pdfjs';
}

let poppler: Promise<boolean> | undefined;

/** Whether Poppler's `pdftoppm` is installed. */
export function hasPoppler(): Promise<boolean> {
  poppler ??= run('pdftoppm', ['-v']).then(
    () => true,
    () => false,
  );
  return poppler;
}

const isSpace = (byte: number | undefined) => byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09;

/** An 8-bit binary PGM (P5), as `pdftoppm -gray` writes it. */
export function parsePgm(bytes: Uint8Array): PageBitmap {
  const tokens: string[] = [];
  let i = 0;
  while (tokens.length < 4) {
    // Whitespace, and comments to the end of their line.
    while (i < bytes.length && (isSpace(bytes[i]) || bytes[i] === 0x23)) {
      if (bytes[i] === 0x23) while (i < bytes.length && bytes[i] !== 0x0a) i += 1;
      else i += 1;
    }
    const start = i;
    while (i < bytes.length && !isSpace(bytes[i])) i += 1;
    if (start === i) throw new Error('not a PGM: its header ends early');
    tokens.push(new TextDecoder().decode(bytes.subarray(start, i)));
  }
  const [magic, w, h, max] = tokens;
  const width = Number(w);
  const height = Number(h);
  // One whitespace byte, then the pixels.
  const gray = bytes.slice(i + 1, i + 1 + width * height);
  if (magic !== 'P5' || max !== '255' || !(width > 0 && height > 0) || gray.length !== width * height) throw new Error('not an 8-bit PGM');
  return { width, height, gray };
}

/** Pages `first` to `last` drawn by pdftoppm from `dir/in.pdf`, by page number (the crop box, as pdf.js draws it). */
async function popplerPages(dir: string, first: number, last: number, scale: number): Promise<Map<number, PageBitmap>> {
  await run('pdftoppm', ['-f', String(first), '-l', String(last), '-r', String(scale * 72), '-gray', '-cropbox', path.join(dir, 'in.pdf'), path.join(dir, 'p')], { maxBuffer: 1 << 20 });
  const pages = new Map<number, PageBitmap>();
  for (const name of await readdir(dir)) {
    const match = /^p-(\d+)\.pgm$/.exec(name);
    if (!match) continue;
    const file = path.join(dir, name);
    pages.set(Number(match[1]), parsePgm(new Uint8Array(await readFile(file))));
    await rm(file);
  }
  return pages;
}

/** Page numbers as runs of consecutive pages, each at most `size` long: one pdftoppm call each. */
function runs(numbers: number[], size: number): number[][] {
  const out: number[][] = [];
  for (const n of numbers) {
    const last = out[out.length - 1];
    if (last && last[last.length - 1] === n - 1 && last.length < size) last.push(n);
    else out.push([n]);
  }
  return out;
}

/** Each page in turn (a few bitmaps in memory at a time). */
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
  let dir: string | null = null;
  try {
    const numbers = options.pages ? [...new Set(options.pages)].filter((n) => n >= 1 && n <= doc.numPages).sort((a, b) => a - b) : Array.from({ length: doc.numPages }, (_, i) => i + 1);
    if (options.engine !== 'pdfjs' && numbers.length && (await hasPoppler())) {
      dir = await mkdtemp(path.join(tmpdir(), 'pdf-fix-'));
      await writeFile(path.join(dir, 'in.pdf'), data);
    }
    for (const chunk of runs(numbers, 16)) {
      // Poppler draws a run of pages at once; a page it could not draw is drawn by pdf.js.
      const drawn = dir ? await popplerPages(dir, chunk[0]!, chunk[chunk.length - 1]!, scale).catch(() => null) : null;
      for (const number of chunk) {
        const page = await doc.getPage(number);
        let bitmap = drawn?.get(number);
        if (!bitmap) {
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
          bitmap = { width, height, gray };
        }
        const unscaled = page.getViewport({ scale: 1 });
        page.cleanup();
        yield { number, widthPt: unscaled.width, heightPt: unscaled.height, rotate: page.rotate, bitmap };
      }
    }
  } finally {
    // Only the loading task tears the document's worker down.
    await task.destroy();
    if (dir) await rm(dir, { recursive: true, force: true });
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
