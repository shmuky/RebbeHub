import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { recordAudioFingerprint, recordDerivation, recordPdfPages, similarFiles, type Catalog, type PageRecord } from '@rebbehub/core';
import type { Db } from '@rebbehub/db';
import { AUDIO_FINGERPRINT_ENCODER, AUDIO_RATE, PAGE_HASH_ENCODER, audioFingerprint, pageHash, type EntityId } from '@rebbehub/model';
import { PAGE_IMAGES_ENCODER, renderPageImages, renderPages, type PageImage } from '@rebbehub/pdf-fix';
import type { ObjectStore } from './readingCopies.js';

/**
 * Page images and fingerprints (the plan, section 8: "page images and
 * thumbnails", all regenerable from originals; section 9: perceptual page
 * hashes and audio fingerprints).
 *
 * `page-images` draws every page of each served scan as a JPEG page image
 * and a thumbnail, puts them in the public bucket by their sha256, and
 * records them as derivations of the PDF (so they follow its rights: a
 * takedown takes them down too) and as the PDF's pages, with each page's
 * perceptual hash. The scan's IIIF manifest and the site's scan viewer
 * are made of them.
 *
 * `fingerprints` measures every other held file once: a PDF kept but not
 * served gets its pages' hashes, a recording its audio fingerprint. Then
 * an upload of the same scan or recording in other bytes is found.
 */

const run = promisify(execFile);

const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Served scans whose PDF has no page images yet, oldest first. */
export async function scansWithoutPageImages(db: Db, options: { scan?: EntityId; limit?: number } = {}): Promise<Array<{ id: EntityId; file: string }>> {
  const params: unknown[] = [];
  const only = options.scan ? `AND e.id = $${params.push(options.scan)}` : '';
  const { rows } = await db.query<{ id: EntityId; file: string }>(
    `SELECT DISTINCT ON (r.data->>'file') e.id, r.data->>'file' AS file
     FROM entity e JOIN revision r ON r.id = e.main_rev JOIN file f ON f.sha256 = r.data->>'file'
     WHERE e.type = 'scan' AND NOT e.deleted AND f.storage_tier = 'public' AND f.rights_state IN ('open', 'credit') AND f.mime = 'application/pdf' ${only}
       AND NOT EXISTS (SELECT 1 FROM file_page p WHERE p.sha256 = f.sha256 AND p.image_sha256 IS NOT NULL)
     ORDER BY r.data->>'file', e.id LIMIT ${Math.min(options.limit ?? 10, 1000)}`,
    params,
  );
  return rows;
}

export interface PageImagesInput {
  /** A file's bytes by sha256 (the API's /objects/, in production). */
  fetchFile: (sha256: string) => Promise<Uint8Array>;
  /** The public bucket: images are put at `objects/<sha256>`. */
  store: ObjectStore;
  scan?: EntityId;
  limit?: number;
  /** Replaced in tests. */
  render?: (pdf: Uint8Array) => AsyncIterable<PageImage>;
  log?: (line: string) => void;
}

/** Makes the page images of served scans that have none; see above. */
export async function makePageImages(catalog: Catalog, input: PageImagesInput): Promise<Array<{ scan: EntityId; file: string; pages: number }>> {
  const log = input.log ?? (() => {});
  const render = input.render ?? ((pdf: Uint8Array) => renderPageImages(pdf));
  const done: Array<{ scan: EntityId; file: string; pages: number }> = [];
  for (const scan of await scansWithoutPageImages(catalog.db, { scan: input.scan, limit: input.limit })) {
    const pdf = await input.fetchFile(scan.file);
    const pages: PageRecord[] = [];
    for await (const page of render(pdf)) {
      const kept: Record<'image' | 'thumb', { sha256: string; width: number; height: number }> = {} as never;
      for (const which of ['image', 'thumb'] as const) {
        const picture = page[which];
        const sha256 = sha256Of(picture.bytes);
        if (!(await input.store.has(`objects/${sha256}`))) await input.store.put(`objects/${sha256}`, picture.bytes, 'image/jpeg');
        await recordDerivation(catalog.db, {
          src: scan.file,
          profile: `${which === 'image' ? 'page-image' : 'thumbnail'}/${page.number}`,
          sha256,
          bytes: picture.bytes.byteLength,
          mime: 'image/jpeg',
          encoder: PAGE_IMAGES_ENCODER,
        });
        kept[which] = { sha256, width: picture.width, height: picture.height };
      }
      pages.push({ page: page.number, widthPt: page.widthPt, heightPt: page.heightPt, hash: pageHash(page.bitmap), image: kept.image, thumb: kept.thumb });
    }
    await recordPdfPages(catalog.db, { sha256: scan.file, encoder: PAGE_HASH_ENCODER, pageCount: pages.length, pages });
    log(`${scan.id}: ${pages.length} page images`);
    for (const like of await similarFiles(catalog.db, scan.file)) log(`  looks like ${like.sha256} (${like.kind}, ${like.matched} of ${like.of} pages)`);
    done.push({ scan: scan.id, file: scan.file, pages: pages.length });
  }
  return done;
}

// ---------------------------------------------------------------- fingerprints

/** Held PDFs and recordings not measured yet (derivations, such as reading copies, left out), oldest first. */
export async function filesToFingerprint(db: Db, limit = 20): Promise<Array<{ sha256: string; mime: string; storage_tier: 'public' | 'preservation' }>> {
  const { rows } = await db.query<{ sha256: string; mime: string; storage_tier: 'public' | 'preservation' }>(
    `SELECT f.sha256, f.mime, f.storage_tier FROM file f
     WHERE f.storage_tier <> 'none' AND (f.mime = 'application/pdf' OR f.mime LIKE 'audio/%')
       AND NOT EXISTS (SELECT 1 FROM file_fingerprint p WHERE p.sha256 = f.sha256)
       AND NOT EXISTS (SELECT 1 FROM derivation d WHERE d.sha256 = f.sha256)
     ORDER BY f.created_at, f.sha256 LIMIT ${Math.min(Math.max(limit, 1), 1000)}`,
  );
  return rows;
}

/** Mono sound and its rate, from an audio file's bytes. */
export type AudioDecoder = (bytes: Uint8Array, mime: string) => Promise<{ samples: Float32Array; rate: number }>;

/** A WAV file's sound (16-bit PCM), mixed to mono: read without any tool. */
export function decodeWav(bytes: Uint8Array): { samples: Float32Array; rate: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (bytes.length < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let channels = 1;
  let rate = 0;
  let bits = 0;
  for (let at = 12; at + 8 <= bytes.length; ) {
    const size = view.getUint32(at + 4, true);
    if (tag(at) === 'fmt ') {
      if (view.getUint16(at + 8, true) !== 1) return null; // PCM only
      channels = view.getUint16(at + 10, true);
      rate = view.getUint32(at + 12, true);
      bits = view.getUint16(at + 22, true);
    } else if (tag(at) === 'data' && bits === 16 && rate > 0) {
      const frames = Math.floor(Math.min(size, bytes.length - at - 8) / (2 * channels));
      const samples = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += view.getInt16(at + 8 + (i * channels + c) * 2, true);
        samples[i] = sum / channels / 32768;
      }
      return { samples, rate };
    }
    at += 8 + size + (size % 2);
  }
  return null;
}

/** Any audio RebbeHub takes, decoded by ffmpeg (on the jobs' machine, never in the Worker) to mono at the fingerprint's rate. */
export const ffmpegDecoder: AudioDecoder = async (bytes, mime) => {
  if (mime === 'audio/wav' || mime === 'audio/x-wav') {
    const wav = decodeWav(bytes);
    if (wav) return wav;
  }
  const dir = await mkdtemp(join(tmpdir(), 'rebbehub-audio-'));
  try {
    const file = join(dir, 'in');
    await writeFile(file, bytes);
    const { stdout } = await run('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(AUDIO_RATE), '-f', 'f32le', '-'], { encoding: 'buffer', maxBuffer: 1 << 30 });
    const out = stdout as unknown as Buffer;
    return { samples: new Float32Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength - (out.byteLength % 4))), rate: AUDIO_RATE };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
};

export interface FingerprintInput {
  /** A served file's bytes (the API's /objects/). */
  fetchPublic: (sha256: string) => Promise<Uint8Array>;
  /** A preserved file's bytes (the preservation bucket, read with the jobs' own token); without it those files wait. */
  fetchPreserved?: (sha256: string) => Promise<Uint8Array | null>;
  decodeAudio?: AudioDecoder;
  limit?: number;
  log?: (line: string) => void;
}

/** Measures held files not measured yet; see above. */
export async function fingerprintFiles(catalog: Catalog, input: FingerprintInput): Promise<Array<{ sha256: string; kind: 'pdf-pages' | 'audio'; similar: number }>> {
  const log = input.log ?? (() => {});
  const decode = input.decodeAudio ?? ffmpegDecoder;
  const done: Array<{ sha256: string; kind: 'pdf-pages' | 'audio'; similar: number }> = [];
  for (const file of await filesToFingerprint(catalog.db, input.limit)) {
    const bytes = file.storage_tier === 'public' ? await input.fetchPublic(file.sha256) : ((await input.fetchPreserved?.(file.sha256)) ?? null);
    if (!bytes) {
      log(`${file.sha256}: kept privately; give the preservation bucket to measure it`);
      continue;
    }
    let kind: 'pdf-pages' | 'audio';
    if (file.mime === 'application/pdf') {
      kind = 'pdf-pages';
      const pages: PageRecord[] = [];
      // Small is enough: the hash looks at 17 by 16 cells.
      for await (const page of renderPages(bytes, { scale: 0.4 })) pages.push({ page: page.number, widthPt: page.widthPt, heightPt: page.heightPt, hash: pageHash(page.bitmap) });
      await recordPdfPages(catalog.db, { sha256: file.sha256, encoder: PAGE_HASH_ENCODER, pageCount: pages.length, pages });
    } else {
      kind = 'audio';
      const { samples, rate } = await decode(bytes, file.mime);
      await recordAudioFingerprint(catalog.db, { sha256: file.sha256, encoder: AUDIO_FINGERPRINT_ENCODER, durationMs: (samples.length / rate) * 1000, fingerprint: audioFingerprint(samples, rate) });
    }
    const similar = await similarFiles(catalog.db, file.sha256);
    log(`${file.sha256}: ${kind}${similar.length ? `, looks like ${similar.map((s) => s.sha256.slice(0, 12)).join(', ')}` : ''}`);
    done.push({ sha256: file.sha256, kind, similar: similar.length });
  }
  return done;
}
