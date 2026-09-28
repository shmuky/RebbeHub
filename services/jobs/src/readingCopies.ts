import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { recordDerivation, recordPageFix, registerFile } from '@rebbehub/core';
import type { Db } from '@rebbehub/db';
import { checkFixed, fixPdf, PDF_FIX_ENCODER, type PagePlan } from '@rebbehub/pdf-fix';

/**
 * The Sichos Kodesh scans and their reading copies (docs/operations.md).
 *
 * Sichos-Kodesh's archive already holds every hanacha scan its catalog
 * links to, in its own R2 bucket by sha256. `make` copies each old
 * typewritten Sichos Kodesh hanacha (rights: open) into RebbeHub's public
 * bucket, makes its reading copy (@rebbehub/pdf-fix: pages turned level,
 * centred, cut free of the scanner's edges; the scan untouched), reads the
 * copy back to check every page came out level, and puts it next to the
 * original. A manifest lists what was done, with each page's measurements.
 * `register` records the manifest in the catalog - the originals as files,
 * the copies as their `reading-copy` derivations, each page's
 * measurements as the file's page fix - and runs with every import, so a
 * rebuilt catalog has them too.
 */

/** The Sichos Kodesh edition's labels in the catalog (Sichos-Kodesh's `pdfEdition`). */
export const SICHOS_KODESH_LABEL = /שיחו"?ק|שיחות קודש/;

/**
 * Labels naming another printing: the re-typed edition published since
 * 1998 (הוצאת תשנ"ח) and its Brooklyn 5776 volumes (ברוקלין תשע"ו),
 * booklets of other publishers (הוצאת …, הוצאות …), memoirs (זכרונות …).
 * Those are publisher scans (docs/rights.md), not the old typewritten set.
 */
const OTHER_PRINTING = /הוצא|תשע"ו|זכרונות/;

/** Whether a catalog label is a scan of the old typewritten Sichos Kodesh (open), not a later printing. */
export const isOldSichosKodesh = (label: string): boolean => SICHOS_KODESH_LABEL.test(label) && !OTHER_PRINTING.test(label);
export const READING_COPY = 'reading-copy';
/** Where the manifest is published in the public bucket, and served by the API. */
export const MANIFEST_KEY = 'manifests/reading-copies/sichos-kodesh.json';
export const MANIFEST_URL = `https://api.rebbehub.org/${MANIFEST_KEY}`;
/** Sichos-Kodesh's archive index: every object it holds, by sha256, with the Drive id it came from. */
export const ARCHIVE_OBJECTS_URL = 'https://sichos-kodesh-pack-api.shmuky.workers.dev/v1/objects.json';

export interface ScanRef {
  driveFileId: string;
  label: string;
  /** Where the catalog lists it: `5736/11114312`. */
  where: string;
}

/** Every old Sichos Kodesh hanacha the farbrengens of a Sichos-Kodesh checkout link to, once per Drive file. */
export async function sichosKodeshScans(checkout: string): Promise<ScanRef[]> {
  const dir = join(checkout, 'apps', 'web', 'src', 'catalog', 'data');
  const found = new Map<string, ScanRef>();
  for (const file of (await readdir(dir)).filter((name) => /^\d{4}\.json$/.test(name)).sort()) {
    const entries = JSON.parse(await readFile(join(dir, file), 'utf8')) as Array<{ occasionId: number; pdfs?: Array<{ driveFileId: string; label: string }> }>;
    for (const entry of entries) {
      for (const pdf of entry.pdfs ?? []) {
        if (isOldSichosKodesh(pdf.label) && !found.has(pdf.driveFileId)) found.set(pdf.driveFileId, { driveFileId: pdf.driveFileId, label: pdf.label, where: `${file.slice(0, 4)}/${entry.occasionId}` });
      }
    }
  }
  return [...found.values()];
}

/** The archive's PDFs by Drive id: its `objects.json` (a URL or a file). */
export async function archivePdfs(from: string): Promise<Map<string, { sha256: string; bytes: number }>> {
  const text = /^https?:\/\//.test(from) ? await (await fetchOk(from)).text() : await readFile(from, 'utf8');
  const index = JSON.parse(text) as { objects: Record<string, { kind: string; bytes: number; sourceId: string; aliases?: string[] }> };
  const byDrive = new Map<string, { sha256: string; bytes: number }>();
  for (const [sha256, object] of Object.entries(index.objects)) {
    if (object.kind !== 'pdf') continue;
    for (const id of [object.sourceId, ...(object.aliases ?? [])]) if (!byDrive.has(id)) byDrive.set(id, { sha256, bytes: object.bytes });
  }
  return byDrive;
}

async function fetchOk(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${url}: ${response.status}`);
  return response;
}

/** Bytes by key: an R2 bucket, or anything else in tests. */
export interface ObjectStore {
  get(key: string): Promise<Uint8Array | null>;
  has(key: string): Promise<boolean>;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
}

/** An R2 bucket through Cloudflare's REST API (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN with R2 edit rights). */
export class R2Store implements ObjectStore {
  private readonly base: string;

  constructor(accountId: string, bucket: string, private readonly token: string) {
    this.base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects`;
  }

  private async call(key: string, init: RequestInit = {}, query = ''): Promise<Response | null> {
    const url = key ? `${this.base}/${key.split('/').map(encodeURIComponent).join('/')}` : `${this.base}${query}`;
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${this.token}` } }).catch(() => null);
      if (response?.status === 404) return null;
      if (response?.ok) return response;
      if (attempt >= 3 || (response && response.status < 500 && response.status !== 429)) throw new Error(`R2 ${init.method ?? 'GET'} ${key}: ${response?.status ?? 'no answer'}`);
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    const response = await this.call(key);
    return response ? new Uint8Array(await response.arrayBuffer()) : null;
  }

  async has(key: string): Promise<boolean> {
    // The REST API has no HEAD: a listing of that one key.
    const response = await this.call('', {}, `?${new URLSearchParams({ prefix: key, per_page: '1' })}`);
    const body = (await response!.json()) as { result?: Array<{ key: string }> };
    return (body.result ?? []).some((object) => object.key === key);
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.call(key, { method: 'PUT', headers: { 'Content-Type': contentType }, body: Buffer.from(bytes) });
  }
}

/** One page of a reading copy, as the manifest keeps it: numbers rounded, the PDF operators left out. */
export type PageGeometry =
  | { page: number; angle: number; scale: number; box: [number, number, number, number]; transform: number[] }
  | { page: number; skipped: NonNullable<PagePlan['skipped']> };

export interface ManifestEntry extends ScanRef {
  /** The original, as the archive holds it. */
  sha256?: string;
  bytes?: number;
  pages?: number;
  readingCopy?: { sha256: string; bytes: number; encoder: string; pages: PageGeometry[] };
  /** Why there is no reading copy: not in the archive, not a PDF pdf.js reads, a page that did not come out level… */
  error?: string;
}

export interface ReadingCopiesManifest {
  format: 'rebbehub-reading-copies';
  formatVersion: 1;
  encoder: string;
  madeAt: string;
  files: ManifestEntry[];
}

const round = (n: number) => Math.round(n * 100) / 100;

export function pageGeometry(plan: PagePlan): PageGeometry {
  if (plan.skipped) return { page: plan.number, skipped: plan.skipped };
  const box = plan.box!;
  return { page: plan.number, angle: plan.angle!, scale: round(plan.scale!), box: [round(box.left), round(box.bottom), round(box.right), round(box.top)], transform: plan.transform! };
}

const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function writeAtomic(file: string, data: string): Promise<void> {
  await writeFile(`${file}.tmp`, data);
  await rename(`${file}.tmp`, file);
}

export interface MakeOptions {
  scans: ScanRef[];
  archive: Map<string, { sha256: string; bytes: number }>;
  /** Sichos-Kodesh's archive bucket: `objects/<sha256>`. */
  source: ObjectStore;
  /** RebbeHub's public bucket: the originals and their copies, `objects/<sha256>`. */
  target: ObjectStore;
  /** Where this run keeps its part of the manifest, so it can stop and go on. */
  work: string;
  /** This process's share, for several at once: [index, count]. */
  shard?: [number, number];
  limit?: number;
  log?: (line: string) => void;
}

export interface MakeResult {
  done: number;
  copies: number;
  failed: number;
  skipped: number;
}

/** Makes the reading copies of this shard's scans; a file done at this encoder in an earlier run is skipped. */
export async function makeReadingCopies(options: MakeOptions): Promise<MakeResult> {
  const log = options.log ?? (() => undefined);
  const [index, count] = options.shard ?? [0, 1];
  await mkdir(options.work, { recursive: true });
  const partFile = join(options.work, `part-${index}-of-${count}.json`);
  let done: Record<string, ManifestEntry> = {};
  try {
    const part = JSON.parse(await readFile(partFile, 'utf8')) as { encoder: string; files: Record<string, ManifestEntry> };
    if (part.encoder === PDF_FIX_ENCODER) done = part.files;
  } catch {
    // A first run.
  }
  const save = () => writeAtomic(partFile, JSON.stringify({ encoder: PDF_FIX_ENCODER, files: done }));
  const result: MakeResult = { done: 0, copies: 0, failed: 0, skipped: 0 };
  for (const [i, scan] of options.scans.entries()) {
    if (i % count !== index) continue;
    if (options.limit !== undefined && result.done >= options.limit) break;
    if (done[scan.driveFileId]) {
      result.skipped += 1;
      continue;
    }
    let entry: ManifestEntry = { ...scan };
    try {
      const held = options.archive.get(scan.driveFileId);
      if (!held) throw new Error('not in the archive');
      const original = await options.source.get(`objects/${held.sha256}`);
      if (!original) throw new Error('listed in the archive, but its bytes are missing');
      if (sha256Of(original) !== held.sha256) throw new Error('the archive copy does not match its sha256');
      entry = { ...entry, sha256: held.sha256, bytes: original.length };
      if (!(await options.target.has(`objects/${held.sha256}`))) await options.target.put(`objects/${held.sha256}`, original, 'application/pdf');
      const { pdf, report } = await fixPdf(original);
      entry.pages = report.pages.length;
      if (report.fixed === 0) throw new Error('no page to fix (blank, or turned)');
      const check = await checkFixed(pdf, report);
      if (!check.ok) throw new Error(`read back: ${check.problems.map((p) => `p${p.number} ${p.reason} ${p.angle}°`).join(', ')}`);
      const copySha = sha256Of(pdf);
      if (!(await options.target.has(`objects/${copySha}`))) await options.target.put(`objects/${copySha}`, pdf, 'application/pdf');
      entry.readingCopy = { sha256: copySha, bytes: pdf.length, encoder: PDF_FIX_ENCODER, pages: report.pages.map(pageGeometry) };
      result.copies += 1;
    } catch (error) {
      entry.error = error instanceof Error ? error.message : String(error);
      result.failed += 1;
    }
    done[scan.driveFileId] = entry;
    result.done += 1;
    log(`${scan.where} ${scan.driveFileId}: ${entry.readingCopy ? `${entry.readingCopy.pages.filter((p) => !('skipped' in p)).length}/${entry.pages} pages` : entry.error}`);
    if (result.done % 10 === 0) await save();
  }
  await save();
  return result;
}

/** The shards' parts as one manifest, in the catalog's order. */
export async function collectManifest(work: string, scans: ScanRef[], now = new Date()): Promise<ReadingCopiesManifest> {
  const files: Record<string, ManifestEntry> = {};
  for (const name of (await readdir(work)).filter((file) => /^part-\d+-of-\d+\.json$/.test(file))) {
    const part = JSON.parse(await readFile(join(work, name), 'utf8')) as { encoder: string; files: Record<string, ManifestEntry> };
    if (part.encoder === PDF_FIX_ENCODER) Object.assign(files, part.files);
  }
  return {
    format: 'rebbehub-reading-copies',
    formatVersion: 1,
    encoder: PDF_FIX_ENCODER,
    madeAt: now.toISOString(),
    files: scans.map((scan) => files[scan.driveFileId]).filter((entry): entry is ManifestEntry => entry !== undefined),
  };
}

export function parseManifest(value: unknown): ReadingCopiesManifest {
  const manifest = value as ReadingCopiesManifest;
  if (manifest?.format !== 'rebbehub-reading-copies' || manifest.formatVersion !== 1 || !Array.isArray(manifest.files)) throw new Error('not a reading-copies manifest');
  return manifest;
}

export interface RegisterResult {
  files: number;
  copies: number;
}

/**
 * Records a manifest in the catalog: each original a file (from mafteiach's
 * Drive link, class `sichos-kodesh-hanacha`, so open), each copy its
 * `reading-copy` derivation, and the pages' measurements as the original's
 * page fix (`failed`, with why, for a scan that has no copy). Run again, it
 * changes nothing that is already so.
 */
export async function registerReadingCopies(db: Db, manifest: ReadingCopiesManifest, log: (line: string) => void = () => undefined): Promise<RegisterResult> {
  const result: RegisterResult = { files: 0, copies: 0 };
  for (const entry of manifest.files) {
    if (!entry.sha256 || entry.bytes === undefined) continue;
    await registerFile(db, {
      sha256: entry.sha256,
      bytes: entry.bytes,
      mime: 'application/pdf',
      source: 'mafteiach',
      licence: 'unknown',
      fileClass: 'sichos-kodesh-hanacha',
      url: `https://drive.google.com/file/d/${entry.driveFileId}/view`,
      held: true,
    });
    result.files += 1;
    if (!entry.readingCopy) {
      await recordPageFix(db, { sha256: entry.sha256, encoder: manifest.encoder, verdict: 'failed', reason: entry.error ?? 'no reading copy' });
      continue;
    }
    await recordDerivation(db, {
      src: entry.sha256,
      profile: READING_COPY,
      sha256: entry.readingCopy.sha256,
      bytes: entry.readingCopy.bytes,
      mime: 'application/pdf',
      encoder: entry.readingCopy.encoder,
    });
    await recordPageFix(db, { sha256: entry.sha256, encoder: entry.readingCopy.encoder, verdict: 'fixed', pages: entry.readingCopy.pages });
    result.copies += 1;
  }
  log(`${result.files} Sichos Kodesh scans, ${result.copies} with a reading copy`);
  return result;
}

/** A manifest from a URL or a file; null when it is not published yet (a 404). */
export async function loadManifest(from: string): Promise<ReadingCopiesManifest | null> {
  if (/^https?:\/\//.test(from)) {
    const response = await fetch(from);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GET ${from}: ${response.status}`);
    return parseManifest(await response.json());
  }
  return parseManifest(JSON.parse(await readFile(from, 'utf8')));
}
