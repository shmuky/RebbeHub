import { one, type Db } from '@rebbehub/db';
import type { EntityId } from '@rebbehub/model';
import { getFile, type FileRow } from './files.js';

/**
 * A file's own page (the plan: "one permanent page per item"): a file is
 * stored once by its sha256, so its page says what it is, what its rights
 * let RebbeHub do with it, where it came from, what was made from it (a
 * reading copy, page images, a cover), what the jobs measured in it, and
 * every catalog item that uses it. Who uploaded it is not said: an
 * uploader's account is theirs.
 */
export interface FileAbout {
  file: FileRow;
  /** Where it came from: the source, its address there, when it was read, and the rights statement its uploader gave. */
  sources: Array<{ source: string; url: string | null; fetchedAt: string | null; attestation: string | null; uploaded: boolean; at: string }>;
  /** What was made from it. */
  derivations: Array<{ profile: string; sha256: string; bytes: number; encoder: string }>;
  /** What it was made from, when it is itself a derivation. */
  derivedFrom: Array<{ profile: string; sha256: string }>;
  /** What the jobs measured: a PDF's pages, a recording's length. */
  measured: { kind: 'pdf-pages' | 'audio'; pages: number | null; durationMs: number | null; encoder: string } | null;
  pageImages: number;
  pageFix: { verdict: string; reason: string | null; encoder: string } | null;
  /** The items whose cover was drawn from it, and on which page. */
  covers: Array<{ entity: EntityId; page: number; machine: boolean }>;
  /** How many items on main use it, and the first of them. */
  usedBy: { total: number; items: Array<{ id: EntityId; type: string; path: string | null; data: Record<string, unknown> }> };
}

export async function fileAbout(db: Db, sha256: string, options: { limit?: number } = {}): Promise<FileAbout | null> {
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
  const file = await getFile(db, sha256);
  if (!file) return null;
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const [sources, derivations, derivedFrom, measured, images, fix, covers, used, total] = await Promise.all([
    db.query<{ source: string; url: string | null; fetched_at: string | null; attestation: string | null; uploaded: boolean; created_at: string }>(
      'SELECT source, url, fetched_at, attestation, (uploaded_by IS NOT NULL) AS uploaded, created_at FROM file_source WHERE sha256 = $1 ORDER BY created_at',
      [sha256],
    ),
    db.query<{ profile: string; sha256: string; bytes: number; encoder: string }>('SELECT profile, sha256, bytes::int AS bytes, encoder FROM derivation WHERE src_sha256 = $1 ORDER BY profile', [sha256]),
    db.query<{ profile: string; sha256: string }>('SELECT profile, src_sha256 AS sha256 FROM derivation WHERE sha256 = $1 ORDER BY profile', [sha256]),
    one<{ kind: 'pdf-pages' | 'audio'; pages: number | null; duration_ms: string | number | null; encoder: string }>(db, 'SELECT kind, pages, duration_ms, encoder FROM file_fingerprint WHERE sha256 = $1', [sha256]),
    one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM file_page WHERE sha256 = $1 AND image_sha256 IS NOT NULL', [sha256]),
    one<{ verdict: string; reason: string | null; encoder: string }>(db, 'SELECT verdict, reason, encoder FROM page_fix WHERE sha256 = $1', [sha256]),
    db.query<{ entity_id: EntityId; page: number; chosen_by: string }>('SELECT entity_id, page, chosen_by FROM cover WHERE src_sha256 = $1 ORDER BY entity_id', [sha256]),
    db.query<{ id: EntityId; type: string; path: string | null; data: Record<string, unknown> }>(
      `SELECT e.id, e.type, e.path, r.data FROM entity e JOIN revision r ON r.id = e.main_rev WHERE r.data->>'file' = $1 AND NOT e.deleted ORDER BY coalesce(e.path, '') || e.id LIMIT ${limit}`,
      [sha256],
    ),
    one<{ n: number }>(db, "SELECT count(*)::int AS n FROM entity e JOIN revision r ON r.id = e.main_rev WHERE r.data->>'file' = $1 AND NOT e.deleted", [sha256]),
  ]);
  return {
    file,
    sources: sources.rows.map((s) => ({
      source: s.source,
      url: s.url,
      fetchedAt: s.fetched_at ? new Date(s.fetched_at).toISOString() : null,
      attestation: s.attestation,
      uploaded: s.uploaded,
      at: new Date(s.created_at).toISOString(),
    })),
    derivations: derivations.rows,
    derivedFrom: derivedFrom.rows,
    measured: measured ? { kind: measured.kind, pages: measured.pages, durationMs: measured.duration_ms === null ? null : Number(measured.duration_ms), encoder: measured.encoder } : null,
    pageImages: images?.n ?? 0,
    pageFix: fix,
    covers: covers.rows.map((c) => ({ entity: c.entity_id, page: c.page, machine: c.chosen_by !== 'person' })),
    usedBy: { total: total?.n ?? 0, items: used.rows },
  };
}
