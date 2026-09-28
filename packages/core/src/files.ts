import { one, type Db } from '@rebbehub/db';
import { defaultRightsState, keepsPreservationCopy, mayServe, type CatalogSourceId, type FileClass, type Licence, type RightsState, type SetPolicy } from '@rebbehub/model';
import { forbidden, invalid, notFound } from './errors.js';

/**
 * Files, stored once by sha256, each with a rights state
 * (docs/plans/rebbehub.md, section 8). A file's bytes live in the public
 * bucket when they may be served, in the preservation bucket when they are
 * kept but not served, and nowhere when RebbeHub only links to them.
 */

export interface FileRow {
  sha256: string;
  bytes: number;
  mime: string;
  rights_state: RightsState;
  credit: string | null;
  storage_tier: 'public' | 'preservation' | 'none';
  created_at: string;
}

export interface NewFile {
  sha256: string;
  bytes: number;
  mime: string;
  source: CatalogSourceId;
  licence: Licence;
  fileClass?: FileClass;
  setPolicy?: SetPolicy;
  url?: string;
  etag?: string;
  uploadedBy?: string;
  /** The rights statement the uploader ticked. */
  attestation?: string;
  credit?: string;
  /** Whether RebbeHub holds the bytes (an upload) or only knows of them (a link). */
  held: boolean;
}

const ALLOWED_MIME = /^(application\/pdf|audio\/(mpeg|mp4|ogg|opus|wav|x-wav|flac|webm|aac)|image\/(jpeg|png|webp|tiff)|text\/plain|application\/json)$/;

export function storageTierFor(state: RightsState, held: boolean): FileRow['storage_tier'] {
  if (!held) return 'none';
  if (mayServe(state)) return 'public';
  return keepsPreservationCopy(state) ? 'preservation' : 'none';
}

/**
 * Records a file the first time it is seen, with its starting rights; a
 * file already known ("we already have this — here") only gains a source.
 */
export async function registerFile(db: Db, input: NewFile): Promise<{ file: FileRow; existed: boolean }> {
  if (!/^[0-9a-f]{64}$/.test(input.sha256)) throw invalid('sha256 must be 64 lower-case hex characters');
  if (!ALLOWED_MIME.test(input.mime)) throw invalid(`files of type ${input.mime} are not accepted`);
  if (input.bytes < 0 || !Number.isSafeInteger(input.bytes)) throw invalid('a file size is a whole number of bytes');
  return db.transaction(async (tx) => {
    const existing = await one<FileRow>(tx, 'SELECT * FROM file WHERE sha256 = $1', [input.sha256]);
    let file = existing;
    if (!file) {
      const state = defaultRightsState({ source: input.source, licence: input.licence, fileClass: input.fileClass, setPolicy: input.setPolicy });
      file = await one<FileRow>(
        tx,
        'INSERT INTO file (sha256, bytes, mime, rights_state, credit, storage_tier) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [input.sha256, input.bytes, input.mime, state, input.credit ?? null, storageTierFor(state, input.held)],
      );
    } else if (input.held && file.storage_tier === 'none' && keepsPreservationCopy(file.rights_state)) {
      // Known only as a link until now: the upload lets us preserve a copy.
      file = await one<FileRow>(tx, "UPDATE file SET storage_tier = 'preservation' WHERE sha256 = $1 RETURNING *", [input.sha256]);
    }
    await tx.query(
      `INSERT INTO file_source (sha256, source, url, etag, fetched_at, uploaded_by, attestation)
       VALUES ($1, $2, $3, $4, CASE WHEN $3::text IS NULL THEN NULL ELSE now() END, $5, $6)
       ON CONFLICT (source, url) WHERE url IS NOT NULL DO UPDATE SET etag = EXCLUDED.etag, fetched_at = EXCLUDED.fetched_at`,
      [input.sha256, input.source, input.url ?? null, input.etag ?? null, input.uploadedBy ?? null, input.attestation ?? null],
    );
    return { file: file!, existed: existing !== null };
  });
}

export async function getFile(db: Db, sha256: string): Promise<FileRow | null> {
  return one<FileRow>(db, 'SELECT * FROM file WHERE sha256 = $1', [sha256]);
}

/** A file made from another (a scan's reading copy, a web audio profile), regenerable from it. */
export interface DerivationRow {
  src_sha256: string;
  profile: string;
  sha256: string;
  bytes: number;
  encoder: string;
  params: unknown;
  created_at: string;
}

export interface NewDerivation {
  src: string;
  /** What it is for: `reading-copy`. One per source file and profile. */
  profile: string;
  sha256: string;
  bytes: number;
  mime: string;
  /** The tool and its version: `pdf-fix@1`. */
  encoder: string;
  /** What the tool measured or chose, kept so the work need not be done again. */
  params?: unknown;
}

/**
 * Records a derivation, and its bytes as a file with its source's rights:
 * a copy made from a file may be served exactly when the file may. Made
 * again (a new version of the tool), it replaces the old one.
 */
export async function recordDerivation(db: Db, input: NewDerivation): Promise<DerivationRow> {
  if (!/^[0-9a-f]{64}$/.test(input.sha256) || !/^[0-9a-f]{64}$/.test(input.src)) throw invalid('sha256 must be 64 lower-case hex characters');
  if (!ALLOWED_MIME.test(input.mime)) throw invalid(`files of type ${input.mime} are not accepted`);
  return db.transaction(async (tx) => {
    const source = await one<FileRow>(tx, 'SELECT * FROM file WHERE sha256 = $1', [input.src]);
    if (!source) throw notFound(`file ${input.src}`);
    await tx.query(
      `INSERT INTO file (sha256, bytes, mime, rights_state, credit, storage_tier) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (sha256) DO NOTHING`,
      [input.sha256, input.bytes, input.mime, source.rights_state, source.credit, source.storage_tier],
    );
    return (await one<DerivationRow>(
      tx,
      `INSERT INTO derivation (src_sha256, profile, sha256, bytes, encoder, params) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (src_sha256, profile) DO UPDATE SET sha256 = EXCLUDED.sha256, bytes = EXCLUDED.bytes, encoder = EXCLUDED.encoder, params = EXCLUDED.params, created_at = now()
       RETURNING *`,
      [input.src, input.profile, input.sha256, input.bytes, input.encoder, input.params === undefined ? null : JSON.stringify(input.params)],
    ))!;
  });
}

/** What was made from a file, by profile. */
export async function getDerivations(db: Db, src: string): Promise<DerivationRow[]> {
  const { rows } = await db.query<DerivationRow>('SELECT * FROM derivation WHERE src_sha256 = $1 ORDER BY profile', [src]);
  return rows;
}

/**
 * Changes a file's rights: stewards only, logged. A takedown is
 * `setRights(…, 'preserved')`: the file stops being served at once and
 * the private copy is kept.
 */
export async function setRights(db: Db, by: string, sha256: string, state: RightsState, note: string): Promise<FileRow> {
  return db.transaction(async (tx) => {
    const actor = await one<{ is_steward: boolean }>(tx, 'SELECT is_steward FROM account WHERE id = $1', [by]);
    if (!actor?.is_steward) throw forbidden('rights are changed by stewards');
    const file = await one<FileRow>(tx, 'SELECT * FROM file WHERE sha256 = $1', [sha256]);
    if (!file) throw notFound(`file ${sha256}`);
    const held = file.storage_tier !== 'none';
    const updated = await one<FileRow>(
      tx,
      'UPDATE file SET rights_state = $2, storage_tier = $3, rights_changed_at = now(), rights_changed_by = $4 WHERE sha256 = $1 RETURNING *',
      [sha256, state, storageTierFor(state, held), by],
    );
    // What was made from it follows it: a takedown takes its reading copy down too.
    await tx.query(
      `UPDATE file SET rights_state = $2, storage_tier = CASE WHEN storage_tier = 'none' THEN 'none' ELSE $3 END, rights_changed_at = now(), rights_changed_by = $4
       WHERE sha256 IN (SELECT sha256 FROM derivation WHERE src_sha256 = $1)`,
      [sha256, state, storageTierFor(state, true), by],
    );
    await tx.query("INSERT INTO audit_log (actor, action, target_kind, target_id, detail) VALUES ($1, 'file.rights', 'file', $2, $3)", [
      by,
      sha256,
      JSON.stringify({ from: file.rights_state, to: state, note }),
    ]);
    return updated!;
  });
}
