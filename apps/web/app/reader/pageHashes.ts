import { pageHash, samplePages } from '@rebbehub/model';
import { loadPdfDocument } from './renderPdf.js';

/**
 * What the browser measures of a file before it is sent, so the person
 * hears "we already have this — here" before waiting for an upload: its
 * sha256, and for a PDF the perceptual hashes of a dozen pages spread
 * through it (@rebbehub/model's `pageHash`, the same the jobs compute for
 * every held scan). Only these small numbers go to the server; the file
 * goes only when sent.
 */

export async function sha256OfFile(file: Blob): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The hashes of up to `most` pages of a PDF, drawn small; null for a blank page. */
export async function pdfPageHashes(file: Blob, most = 12): Promise<Array<string | null>> {
  const url = URL.createObjectURL(file);
  const task = loadPdfDocument(url);
  try {
    const doc = await task.promise;
    const hashes: Array<string | null> = [];
    for (const number of samplePages(doc.numPages, most)) {
      const page = await doc.getPage(number);
      const viewport = page.getViewport({ scale: 240 / page.getViewport({ scale: 1 }).width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const gray = new Uint8Array(canvas.width * canvas.height);
      for (let i = 0, j = 0; i < gray.length; i++, j += 4) gray[i] = (rgba[j]! * 299 + rgba[j + 1]! * 587 + rgba[j + 2]! * 114) / 1000;
      hashes.push(pageHash({ width: canvas.width, height: canvas.height, gray }));
      page.cleanup();
    }
    return hashes;
  } finally {
    await task.destroy();
    URL.revokeObjectURL(url);
  }
}
