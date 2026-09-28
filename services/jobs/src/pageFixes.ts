import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { recordPageFix, registerFile } from '@rebbehub/core';
import type { Db } from '@rebbehub/db';
import { driveViewUrl, type DriveFolder } from '@rebbehub/importers';
import { inspectPdf, levelPdf, measureAngles, PDF_LEVEL_ENCODER, spread, type PageTurn } from '@rebbehub/pdf-fix';

/**
 * Page fixes for the PDFs RebbeHub links to but does not hold
 * (docs/operations.md): Otzros HaRebbe's library of Lubavitch seforim
 * first, some 5,400 files on Google Drive. Nothing is copied: each file
 * is read once, measured, and let go, and what it needs is kept.
 *
 * Most need nothing, and are told apart cheaply:
 * - a book set in type (its letters are text) is passed over from a
 *   glance at six pages, without drawing anything;
 * - a scanned book is drawn at eight pages spread through it, and if none
 *   leans it is left as it is;
 * - only a scan with a leaning page is measured page by page, and only its
 *   leaning pages are turned, each about its middle (@rebbehub/pdf-fix's
 *   level.ts): no centring, enlarging or cutting, since a printed book's
 *   layout is its publisher's. Each turn is tried and read back level
 *   before it is kept.
 *
 * The turns are a matrix per page, so the site's reader draws the linked
 * file through them. A run skips every file an earlier run finished at
 * this encoder: after an import adds files, the next run reads only those.
 */

/** A sampled page leaning at least this much sends a scan to be measured page by page. */
export const SAMPLE_LEAN = 0.4;

export const OTZROS_COLLECTION = 'otzros';
/** Where a collection's manifest is published in the public bucket, and served by the API. */
export const pageFixesKey = (collection: string) => `manifests/page-fixes/${collection}.json`;
export const pageFixesUrl = (collection: string) => `https://api.rebbehub.org/${pageFixesKey(collection)}`;

export interface LinkedPdf {
  driveFileId: string;
  resourceKey?: string;
  /** Its file name, and the folders it sits in. */
  label: string;
  where: string;
}

/** Every PDF of the Otzros library's folder tree (as its importer lists it), once per Drive file. */
export function otzrosPdfs(root: DriveFolder): LinkedPdf[] {
  const found = new Map<string, LinkedPdf>();
  const walk = (folder: DriveFolder, trail: string[]) => {
    for (const file of folder.files) {
      if (/\.pdf$/i.test(file.title) && !found.has(file.id)) {
        found.set(file.id, { driveFileId: file.id, ...(file.resourceKey ? { resourceKey: file.resourceKey } : {}), label: file.title, where: [...trail, folder.title].slice(1).join(' / ') });
      }
    }
    for (const sub of folder.folders) walk(sub, [...trail, folder.title]);
  };
  walk(root, []);
  return [...found.values()];
}

export type PageFixVerdict = 'fixed' | 'as-is' | 'failed';

export interface PageFixEntry extends LinkedPdf {
  sha256?: string;
  bytes?: number;
  pages?: number;
  verdict?: PageFixVerdict;
  /** `born-digital`, `level`, or what went wrong. */
  reason?: string;
  turns?: PageTurn[];
}

export interface PageFixesManifest {
  format: 'rebbehub-page-fixes';
  formatVersion: 1;
  collection: string;
  encoder: string;
  madeAt: string;
  files: PageFixEntry[];
}

/** What one PDF needs, told as cheaply as the file allows (see above). */
export async function pageFixFor(pdf: Uint8Array): Promise<Pick<PageFixEntry, 'pages' | 'verdict' | 'reason' | 'turns'>> {
  const kind = await inspectPdf(pdf);
  if (kind.kind === 'born-digital') return { pages: kind.pages, verdict: 'as-is', reason: 'born-digital' };
  const sample = await measureAngles(pdf, { pages: spread(kind.pages, 8) });
  if (!sample.some((page) => !page.blank && Math.abs(page.angle) >= SAMPLE_LEAN)) return { pages: kind.pages, verdict: 'as-is', reason: 'level' };
  const { report } = await levelPdf(pdf);
  if (report.turned.length) return { pages: kind.pages, verdict: 'fixed', turns: report.turned };
  if (report.dropped.length) return { pages: kind.pages, verdict: 'failed', reason: `did not read back level: ${report.dropped.map((d) => `p${d.page}`).join(', ')}` };
  return { pages: kind.pages, verdict: 'as-is', reason: 'level' };
}

/** A public Drive file's bytes, as Drive gives them to anyone with the link (large files past the virus-scan page). */
export async function downloadDrive(file: Pick<LinkedPdf, 'driveFileId' | 'resourceKey'>, fetchFn: typeof fetch = fetch): Promise<Uint8Array> {
  const query = new URLSearchParams({ id: file.driveFileId, export: 'download', confirm: 't' });
  if (file.resourceKey) query.set('resourcekey', file.resourceKey);
  const url = `https://drive.usercontent.google.com/download?${query}`;
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetchFn(url);
      if (!response.ok) throw new Error(`Drive answered ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      // Drive answers a file it will not give (too many downloads, not shared) with a page, not an error.
      if (new TextDecoder().decode(bytes.subarray(0, 1024)).indexOf('%PDF') === -1) throw new Error('Drive did not give the file (not a PDF)');
      return bytes;
    } catch (error) {
      if (attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attempt));
    }
  }
}

const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function writeAtomic(file: string, data: string): Promise<void> {
  await writeFile(`${file}.tmp`, data);
  await rename(`${file}.tmp`, file);
}

export interface MakePageFixesOptions {
  pdfs: LinkedPdf[];
  /** Where this run keeps its part of the manifest, so it can stop and go on. */
  work: string;
  /** Gets a file's bytes: from Drive, or anything else in tests. */
  fetchPdf?: (pdf: LinkedPdf) => Promise<Uint8Array>;
  /** This process's share, for several at once: [index, count]. */
  shard?: [number, number];
  limit?: number;
  log?: (line: string) => void;
}

export interface MakePageFixesResult {
  done: number;
  fixed: number;
  asIs: number;
  failed: number;
  /** Not read this time (Drive would not give them): tried again next run. */
  unread: number;
  skipped: number;
}

/** Measures this shard's PDFs; a file finished at this encoder in an earlier run is skipped. */
export async function makePageFixes(options: MakePageFixesOptions): Promise<MakePageFixesResult> {
  const log = options.log ?? (() => undefined);
  const fetchPdf = options.fetchPdf ?? ((pdf: LinkedPdf) => downloadDrive(pdf));
  const [index, count] = options.shard ?? [0, 1];
  await mkdir(options.work, { recursive: true });
  const partFile = join(options.work, `part-${index}-of-${count}.json`);
  let done: Record<string, PageFixEntry> = {};
  try {
    const part = JSON.parse(await readFile(partFile, 'utf8')) as { encoder: string; files: Record<string, PageFixEntry> };
    if (part.encoder === PDF_LEVEL_ENCODER) done = part.files;
  } catch {
    // A first run.
  }
  const save = () => writeAtomic(partFile, JSON.stringify({ encoder: PDF_LEVEL_ENCODER, files: done }));
  const result: MakePageFixesResult = { done: 0, fixed: 0, asIs: 0, failed: 0, unread: 0, skipped: 0 };
  for (const [i, pdf] of options.pdfs.entries()) {
    if (i % count !== index) continue;
    if (options.limit !== undefined && result.done + result.unread >= options.limit) break;
    if (done[pdf.driveFileId]?.verdict) {
      result.skipped += 1;
      continue;
    }
    let bytes: Uint8Array;
    try {
      bytes = await fetchPdf(pdf);
    } catch (error) {
      result.unread += 1;
      log(`${pdf.driveFileId}: not read (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const entry: PageFixEntry = { ...pdf, sha256: sha256Of(bytes), bytes: bytes.length };
    try {
      Object.assign(entry, await pageFixFor(bytes));
    } catch (error) {
      entry.verdict = 'failed';
      entry.reason = error instanceof Error ? error.message : String(error);
    }
    done[pdf.driveFileId] = entry;
    result.done += 1;
    if (entry.verdict === 'fixed') result.fixed += 1;
    else if (entry.verdict === 'as-is') result.asIs += 1;
    else result.failed += 1;
    log(`${pdf.where} / ${pdf.label}: ${entry.verdict}${entry.turns ? ` (${entry.turns.length} of ${entry.pages} pages turned)` : entry.reason ? ` (${entry.reason})` : ''}`);
    if (result.done % 10 === 0) await save();
  }
  await save();
  return result;
}

/** The shards' parts as one manifest, in the collection's order. */
export async function collectPageFixes(work: string, collection: string, pdfs: LinkedPdf[], now = new Date()): Promise<PageFixesManifest> {
  const files: Record<string, PageFixEntry> = {};
  for (const name of (await readdir(work)).filter((file) => /^part-\d+-of-\d+\.json$/.test(file))) {
    const part = JSON.parse(await readFile(join(work, name), 'utf8')) as { encoder: string; files: Record<string, PageFixEntry> };
    if (part.encoder === PDF_LEVEL_ENCODER) Object.assign(files, part.files);
  }
  return {
    format: 'rebbehub-page-fixes',
    formatVersion: 1,
    collection,
    encoder: PDF_LEVEL_ENCODER,
    madeAt: now.toISOString(),
    files: pdfs.map((pdf) => files[pdf.driveFileId]).filter((entry): entry is PageFixEntry => entry?.verdict !== undefined),
  };
}

export function parsePageFixes(value: unknown): PageFixesManifest {
  const manifest = value as PageFixesManifest;
  if (manifest?.format !== 'rebbehub-page-fixes' || manifest.formatVersion !== 1 || !Array.isArray(manifest.files)) throw new Error('not a page-fixes manifest');
  return manifest;
}

/** A manifest from a URL or a file; null when it is not published yet (a 404). */
export async function loadPageFixes(from: string): Promise<PageFixesManifest | null> {
  if (/^https?:\/\//.test(from)) {
    const response = await fetch(from);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GET ${from}: ${response.status}`);
    return parsePageFixes(await response.json());
  }
  return parsePageFixes(JSON.parse(await readFile(from, 'utf8')));
}

/**
 * Records a manifest in the catalog: each PDF a file RebbeHub knows but
 * does not hold (a publisher's scan on Drive: link only), with its page
 * fix. Run again, it changes nothing that is already so.
 */
export async function registerPageFixes(db: Db, manifest: PageFixesManifest, log: (line: string) => void = () => undefined): Promise<{ files: number; fixed: number }> {
  const result = { files: 0, fixed: 0 };
  for (const entry of manifest.files) {
    if (!entry.sha256 || entry.bytes === undefined || !entry.verdict) continue;
    await registerFile(db, {
      sha256: entry.sha256,
      bytes: entry.bytes,
      mime: 'application/pdf',
      source: 'other',
      licence: 'free-to-read',
      fileClass: 'publisher-scan',
      credit: 'אוצרות הרבי',
      url: driveViewUrl({ id: entry.driveFileId, title: entry.label, ...(entry.resourceKey ? { resourceKey: entry.resourceKey } : {}) }),
      held: false,
    });
    await recordPageFix(db, { sha256: entry.sha256, encoder: manifest.encoder, verdict: entry.verdict, ...(entry.reason ? { reason: entry.reason } : {}), pages: entry.turns ?? [] });
    result.files += 1;
    if (entry.verdict === 'fixed') result.fixed += 1;
  }
  log(`${result.files} ${manifest.collection} PDFs, ${result.fixed} with pages to turn`);
  return result;
}
