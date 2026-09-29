import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * The words a PDF itself carries on its pages (a book set in type, or a
 * scan with an OCR layer), read with pdf.js without drawing anything: what
 * finding a sefer's title page reads alongside its ink ("ספר", a
 * publisher's line, a year). A scan without a text layer gives empty
 * strings.
 */

const require = createRequire(import.meta.url);
const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));

/** The text of each page asked for (1-based), in page order; pages beyond the end are left out. */
export async function pageTexts(data: Uint8Array, pages: readonly number[]): Promise<Array<{ page: number; text: string }>> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    cMapUrl: `${path.join(pdfjsRoot, 'cmaps')}/`,
    cMapPacked: true,
    standardFontDataUrl: `${path.join(pdfjsRoot, 'standard_fonts')}/`,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const out: Array<{ page: number; text: string }> = [];
    for (const number of [...new Set(pages)].filter((n) => n >= 1 && n <= doc.numPages).sort((a, b) => a - b)) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      page.cleanup();
      out.push({ page: number, text });
    }
    return out;
  } finally {
    await task.destroy();
  }
}

/** How many pages a PDF has. */
export async function pdfPageTotal(data: Uint8Array): Promise<number> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0 });
  try {
    return (await task.promise).numPages;
  } finally {
    await task.destroy();
  }
}
