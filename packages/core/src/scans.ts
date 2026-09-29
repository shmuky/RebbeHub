import { one, type Db } from '@rebbehub/db';
import { comparePages, compareAudio, hashBands, looksSameScan, sameRecording, sharesPages, AUDIO_FRAMES_PER_SECOND, type EntityId } from '@rebbehub/model';
import { invalid, notFound } from './errors.js';

/**
 * What the jobs measure in a held file, once (migration 0012): a PDF's
 * pages - each one's size, perceptual hash and, for a served scan, its
 * page image and thumbnail - and a recording's audio fingerprint. From
 * these RebbeHub finds the same scan or recording in other bytes ("we
 * already have this — here"), and serves a scan's pages as IIIF.
 */

export interface PageRecord {
  page: number;
  widthPt: number;
  heightPt: number;
  /** The page's perceptual hash (@rebbehub/model's `pageHash`); null for a blank page. */
  hash: string | null;
  /** Its page image and thumbnail, when made (files already recorded as derivations of the PDF). */
  image?: { sha256: string; width: number; height: number };
  thumb?: { sha256: string; width: number; height: number };
}

export interface FilePageRow {
  sha256: string;
  page: number;
  width_pt: number;
  height_pt: number;
  hash: string | null;
  image_sha256: string | null;
  image_width: number | null;
  image_height: number | null;
  thumb_sha256: string | null;
  thumb_width: number | null;
  thumb_height: number | null;
}

export interface FingerprintRow {
  sha256: string;
  kind: 'pdf-pages' | 'audio';
  encoder: string;
  pages: number | null;
  duration_ms: number | null;
  made_at: string;
}

const SHA = /^[0-9a-f]{64}$/;

async function requireFile(db: Db, sha256: string): Promise<void> {
  if (!SHA.test(sha256)) throw invalid('sha256 must be 64 lower-case hex characters');
  if (!(await one(db, 'SELECT 1 FROM file WHERE sha256 = $1', [sha256]))) throw notFound(`file ${sha256}`);
}

/**
 * Records a PDF's pages: measured again, a page's row is replaced, and a
 * page image already made is kept when the new measurement brings none.
 */
export async function recordPdfPages(db: Db, input: { sha256: string; encoder: string; pageCount: number; pages: readonly PageRecord[] }): Promise<void> {
  await requireFile(db, input.sha256);
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO file_fingerprint (sha256, kind, encoder, pages) VALUES ($1, 'pdf-pages', $2, $3)
       ON CONFLICT (sha256) DO UPDATE SET encoder = EXCLUDED.encoder, pages = EXCLUDED.pages, made_at = now()`,
      [input.sha256, input.encoder, input.pageCount],
    );
    for (const p of input.pages) {
      if (!Number.isInteger(p.page) || p.page < 1) throw invalid('pages are numbered from 1');
      if (p.hash !== null && !SHA.test(p.hash)) throw invalid('a page hash is 64 hex digits');
      await tx.query(
        `INSERT INTO file_page (sha256, page, width_pt, height_pt, hash, bands, image_sha256, image_width, image_height, thumb_sha256, thumb_width, thumb_height)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (sha256, page) DO UPDATE SET width_pt = EXCLUDED.width_pt, height_pt = EXCLUDED.height_pt, hash = EXCLUDED.hash, bands = EXCLUDED.bands,
           image_sha256 = coalesce(EXCLUDED.image_sha256, file_page.image_sha256), image_width = coalesce(EXCLUDED.image_width, file_page.image_width),
           image_height = coalesce(EXCLUDED.image_height, file_page.image_height), thumb_sha256 = coalesce(EXCLUDED.thumb_sha256, file_page.thumb_sha256),
           thumb_width = coalesce(EXCLUDED.thumb_width, file_page.thumb_width), thumb_height = coalesce(EXCLUDED.thumb_height, file_page.thumb_height)`,
        [
          input.sha256,
          p.page,
          p.widthPt,
          p.heightPt,
          p.hash,
          p.hash ? hashBands(p.hash) : null,
          p.image?.sha256 ?? null,
          p.image?.width ?? null,
          p.image?.height ?? null,
          p.thumb?.sha256 ?? null,
          p.thumb?.width ?? null,
          p.thumb?.height ?? null,
        ],
      );
    }
  });
}

/** Records a recording's fingerprint (@rebbehub/model's `audioFingerprint`) and length. */
export async function recordAudioFingerprint(db: Db, input: { sha256: string; encoder: string; durationMs: number; fingerprint: ArrayLike<number> }): Promise<void> {
  await requireFile(db, input.sha256);
  await db.query(
    `INSERT INTO file_fingerprint (sha256, kind, encoder, duration_ms, audio) VALUES ($1, 'audio', $2, $3, $4)
     ON CONFLICT (sha256) DO UPDATE SET encoder = EXCLUDED.encoder, duration_ms = EXCLUDED.duration_ms, audio = EXCLUDED.audio, pages = NULL, made_at = now()`,
    [input.sha256, input.encoder, Math.round(input.durationMs), Array.from(input.fingerprint, (x) => x | 0)],
  );
}

export async function getFingerprint(db: Db, sha256: string): Promise<FingerprintRow | null> {
  return one<FingerprintRow>(db, 'SELECT sha256, kind, encoder, pages, duration_ms, made_at FROM file_fingerprint WHERE sha256 = $1', [sha256]);
}

/** A PDF's pages as measured, in order. */
export async function filePages(db: Db, sha256: string): Promise<FilePageRow[]> {
  const { rows } = await db.query<FilePageRow>(
    `SELECT sha256, page, width_pt, height_pt, hash, image_sha256, image_width, image_height, thumb_sha256, thumb_width, thumb_height
     FROM file_page WHERE sha256 = $1 ORDER BY page`,
    [sha256],
  );
  return rows;
}

/** How many of a PDF's pages have a page image. */
export async function pageImageCount(db: Db, sha256: string): Promise<number> {
  return (await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM file_page WHERE sha256 = $1 AND image_sha256 IS NOT NULL', [sha256]))?.n ?? 0;
}

/** The same for several PDFs in one statement, by sha256 (0 for one with no page images). */
export async function pageImageCounts(db: Db, sha256s: readonly string[]): Promise<Map<string, number>> {
  if (sha256s.length === 0) return new Map();
  const { rows } = await db.query<{ sha256: string; n: number }>('SELECT sha256, count(*)::int AS n FROM file_page WHERE sha256 = ANY($1::text[]) AND image_sha256 IS NOT NULL GROUP BY sha256', [[...new Set(sha256s)]]);
  return new Map(rows.map((r) => [r.sha256, r.n]));
}

/** A file already held whose pages or sound look like another's. */
export interface SimilarFile {
  sha256: string;
  /** `same`: the same scan or recording in other bytes. `shares`: a scan with pages in common. */
  kind: 'same' | 'shares';
  /** For scans: pages alike, of the pages compared. */
  matched?: number;
  of?: number;
  /** For recordings: the share of fingerprint bits that differ, and where one starts in the other (ms). */
  errors?: number;
  offsetMs?: number;
}

/**
 * Held scans with pages like `hashes`: candidates found through the
 * hashes' bands, then compared page by page. Best first.
 */
export async function similarScans(db: Db, hashes: ReadonlyArray<string | null>, options: { exclude?: string; limit?: number } = {}): Promise<SimilarFile[]> {
  const bands = [...new Set(hashes.filter((h): h is string => typeof h === 'string' && SHA.test(h)).flatMap(hashBands))];
  if (bands.length === 0) return [];
  const { rows: candidates } = await db.query<{ sha256: string }>(
    'SELECT DISTINCT sha256 FROM file_page WHERE bands && $1::int[] AND sha256 <> $2 LIMIT 50',
    [bands, options.exclude ?? ''],
  );
  const found: SimilarFile[] = [];
  for (const { sha256 } of candidates) {
    const { rows } = await db.query<{ hash: string | null }>('SELECT hash FROM file_page WHERE sha256 = $1 ORDER BY page', [sha256]);
    const match = comparePages(hashes, rows.map((r) => r.hash));
    if (!sharesPages(match)) continue;
    found.push({ sha256, kind: looksSameScan(match) ? 'same' : 'shares', matched: match.matched, of: match.of });
  }
  return found.sort((a, b) => b.matched! - a.matched!).slice(0, options.limit ?? 10);
}

/**
 * Held recordings that sound like `fingerprint`: those of about the same
 * length (a tenth, or a minute, either way), compared bit by bit.
 */
export async function similarRecordings(db: Db, fingerprint: ArrayLike<number>, durationMs: number, options: { exclude?: string; limit?: number } = {}): Promise<SimilarFile[]> {
  const slack = Math.max(durationMs * 0.1, 60_000);
  const { rows } = await db.query<{ sha256: string; audio: number[] }>(
    "SELECT sha256, audio FROM file_fingerprint WHERE kind = 'audio' AND duration_ms BETWEEN $1 AND $2 AND sha256 <> $3 LIMIT 50",
    [Math.round(durationMs - slack), Math.round(durationMs + slack), options.exclude ?? ''],
  );
  const found: SimilarFile[] = [];
  for (const row of rows) {
    const match = compareAudio(fingerprint, row.audio ?? []);
    if (sameRecording(match)) found.push({ sha256: row.sha256, kind: 'same', errors: Math.round(match.errors * 1000) / 1000, offsetMs: Math.round((match.offset / AUDIO_FRAMES_PER_SECOND) * 1000) });
  }
  return found.sort((a, b) => a.errors! - b.errors!).slice(0, options.limit ?? 10);
}

/** Files that look like a held file, from its own measurements; empty until the jobs have measured it. */
export async function similarFiles(db: Db, sha256: string): Promise<SimilarFile[]> {
  const print = await one<{ kind: string; duration_ms: number | null; audio: number[] | null }>(db, 'SELECT kind, duration_ms, audio FROM file_fingerprint WHERE sha256 = $1', [sha256]);
  if (!print) return [];
  if (print.kind === 'audio') return similarRecordings(db, print.audio ?? [], Number(print.duration_ms ?? 0), { exclude: sha256 });
  const { rows } = await db.query<{ hash: string | null }>('SELECT hash FROM file_page WHERE sha256 = $1 ORDER BY page', [sha256]);
  return similarScans(db, rows.map((r) => r.hash), { exclude: sha256 });
}

/** The catalog items (on main) whose `file` is this file: "we already have this — here". */
export async function itemsUsingFile(db: Db, sha256: string): Promise<Array<{ id: EntityId; type: string; path: string | null; data: Record<string, unknown> }>> {
  const { rows } = await db.query<{ id: EntityId; type: string; path: string | null; data: Record<string, unknown> }>(
    "SELECT e.id, e.type, e.path, r.data FROM entity e JOIN revision r ON r.id = e.main_rev WHERE r.data->>'file' = $1 AND NOT e.deleted LIMIT 10",
    [sha256],
  );
  return rows;
}
