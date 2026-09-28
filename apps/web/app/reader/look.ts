import { useSyncExternalStore } from 'react';

/**
 * How the reader shows its pages, taken from Sichos-Kodesh's PDF reader
 * (packages/app-core/src/pdf/pdfLook.ts and its settings sheet) so both
 * read alike: the paper as scanned, a warm sepia, grey (a yellowed scan
 * made plain) or dark pages (white on black), and a stronger contrast for
 * a faint scan. `auto` is dark pages when the device is in dark mode and
 * the paper as scanned by day, as Sichos-Kodesh does by default.
 *
 * One setting for the whole site, kept in this browser.
 */

export type PdfColors = 'auto' | 'original' | 'sepia' | 'gray' | 'dark';
export const PDF_COLORS: readonly PdfColors[] = ['auto', 'original', 'sepia', 'gray', 'dark'];

export interface PdfLook {
  colors: PdfColors;
  contrast: boolean;
}

export const DEFAULT_PDF_LOOK: PdfLook = { colors: 'auto', contrast: false };
const STORE = 'rebbehub.pdf-look';

/** A stored look, anything missing or unknown at its default. */
export function parsePdfLook(raw: string | null | undefined): PdfLook {
  let value: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = parsed as Record<string, unknown>;
  } catch {
    value = {};
  }
  return {
    colors: PDF_COLORS.includes(value.colors as PdfColors) ? (value.colors as PdfColors) : DEFAULT_PDF_LOOK.colors,
    contrast: typeof value.contrast === 'boolean' ? value.contrast : DEFAULT_PDF_LOOK.contrast,
  };
}

/** The colours the pages are drawn in, once `auto` has looked at the device's theme. */
export function resolvedColors(colors: PdfColors, dark: boolean): Exclude<PdfColors, 'auto'> {
  return colors === 'auto' ? (dark ? 'dark' : 'original') : colors;
}

/**
 * The CSS filter the pages are drawn through (Sichos-Kodesh's pdfCssFilter):
 * dark pages flip the colours but keep their hues (`hue-rotate(180deg)`
 * after `invert(1)`, so red ink stays red), sepia warms, grey greys, and
 * contrast deepens the ink.
 */
export function pdfCssFilter(colors: Exclude<PdfColors, 'auto'>, contrast: boolean): string {
  const steps: string[] = [];
  if (colors === 'dark') steps.push('invert(1)', 'hue-rotate(180deg)');
  if (colors === 'sepia') steps.push('sepia(0.45)', 'brightness(0.97)');
  if (colors === 'gray') steps.push('grayscale(1)');
  if (contrast) steps.push('contrast(1.35)');
  return steps.length ? steps.join(' ') : 'none';
}

let look: PdfLook | null = null;
const listeners = new Set<() => void>();

function read(): PdfLook {
  if (!look) {
    try {
      look = parsePdfLook(localStorage.getItem(STORE));
    } catch {
      look = DEFAULT_PDF_LOOK;
    }
  }
  return look;
}

export function setPdfLook(change: Partial<PdfLook>): void {
  look = { ...read(), ...change };
  try {
    localStorage.setItem(STORE, JSON.stringify(look));
  } catch {
    // Private windows: the look holds for this visit only.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The look, the same on the server (its default) and in the browser until it has read what was chosen. */
export function usePdfLook(): PdfLook {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_PDF_LOOK);
}

/** Whether the device is in dark mode now, following it as it changes. */
export function usePrefersDark(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia('(prefers-color-scheme: dark)');
      query.addEventListener('change', listener);
      return () => query.removeEventListener('change', listener);
    },
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
    () => false,
  );
}
