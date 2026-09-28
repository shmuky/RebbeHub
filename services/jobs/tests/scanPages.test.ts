import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { filePages, getDerivations, getFile, registerFile, similarFiles } from '@rebbehub/core';
import { decodeWav, fingerprintFiles, makePageImages, scansWithoutPageImages } from '../src/scanPages.js';
import type { ObjectStore } from '../src/readingCopies.js';
import { add, freshCatalog } from '../../../packages/core/tests/helpers.js';
import { drawPage } from '../../../packages/pdf-fix/tests/page.js';

/**
 * Page images of served scans, and fingerprints of every held file, with
 * real PDFs (made-up typewriter pages, drawn here) and made-up sound.
 */

/** A scanned PDF of made-up pages; `size` changes the bytes (the paper's size), not what is on the pages. */
async function scannedPdf(tilts: number[], size = 1): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const [i, tilt] of tilts.entries()) {
    const image = await doc.embedPng(drawPage({ width: 600, height: 800, tilt, shift: i * 40 - 40 }).png);
    const page = doc.addPage([300 * size, 400 * size]);
    page.drawImage(image, { x: 0, y: 0, width: 300 * size, height: 400 * size });
  }
  return doc.save();
}

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function memoryStore(): ObjectStore & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    get: async (key) => objects.get(key) ?? null,
    has: async (key) => objects.has(key),
    put: async (key, bytes) => void objects.set(key, bytes),
  };
}

/** A WAV file (16-bit PCM, mono) of speech-like tones. */
function wav(seed: number, seconds: number, rate = 8000): Uint8Array {
  const n = Math.round(seconds * rate);
  const bytes = new Uint8Array(44 + n * 2);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, n * 2, true);
  let s = seed;
  const random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let freq = 500;
  let amp = 0.5;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    if (i % Math.round(rate * 0.2) === 0) {
      freq = 300 + random() * 1500;
      amp = 0.1 + random() * 0.7;
    }
    phase += (2 * Math.PI * freq) / rate;
    view.setInt16(44 + i * 2, Math.round(amp * Math.sin(phase) * 30000), true);
  }
  return bytes;
}

describe('page images', () => {
  it('draws each page of a served scan once, into the public bucket, as derivations with its rights and hashes', async () => {
    const { catalog, set } = await freshCatalog();
    const pdf = await scannedPdf([0.5, -0.8]);
    const file = sha(pdf);
    await registerFile(catalog.db, { sha256: file, bytes: pdf.length, mime: 'application/pdf', source: 'contribution', licence: 'cc0', held: true });
    const publication = await add(catalog, 'mendy', 'keeper', 'publication', { kind: 'book-volume', title: { he: 'כרך' }, sets: [set] });
    const scan = await add(catalog, 'mendy', 'keeper', 'scan', { publication, file, completeness: 'complete' });
    const store = memoryStore();

    const done = await makePageImages(catalog, { fetchFile: async () => pdf, store });
    expect(done).toEqual([{ scan, file, pages: 2 }]);
    const pages = await filePages(catalog.db, file);
    expect(pages).toHaveLength(2);
    for (const page of pages) {
      expect(page).toMatchObject({ width_pt: 300, height_pt: 400, image_width: 1200, image_height: 1600, thumb_width: 240, thumb_height: 320 });
      expect(page.hash).toMatch(/^[0-9a-f]{64}$/);
      // JPEG bytes, kept by content.
      expect([...store.objects.get(`objects/${page.image_sha256}`)!.subarray(0, 2)]).toEqual([0xff, 0xd8]);
      expect(await getFile(catalog.db, page.thumb_sha256!)).toMatchObject({ mime: 'image/jpeg', rights_state: 'open', storage_tier: 'public' });
    }
    expect((await getDerivations(catalog.db, file)).map((d) => d.profile)).toEqual(['page-image/1', 'page-image/2', 'thumbnail/1', 'thumbnail/2']);
    // Done once.
    expect(await scansWithoutPageImages(catalog.db)).toEqual([]);
  }, 60_000);
});

describe('fingerprints', () => {
  it('finds a scan saved again in other bytes, kept privately, and the same recording at another rate', async () => {
    const { catalog } = await freshCatalog();
    const pdf = await scannedPdf([0.3, 1.2, -0.6]);
    const again = await scannedPdf([0.3, 1.2, -0.6], 1.25); // the same pages, drawn at another size: other bytes
    const other = await scannedPdf([4, -4, 3]);
    const sound = wav(3, 20);
    const soundAgain = wav(3, 20, 11025);
    const bytes = new Map([pdf, again, other, sound, soundAgain].map((b) => [sha(b), b]));
    const held = async (b: Uint8Array, mime: string, licence: 'cc0' | 'unknown') =>
      registerFile(catalog.db, { sha256: sha(b), bytes: b.length, mime, source: 'contribution', licence, held: true });
    await held(pdf, 'application/pdf', 'cc0');
    await held(other, 'application/pdf', 'cc0');
    await held(again, 'application/pdf', 'unknown'); // preserved
    await held(sound, 'audio/wav', 'cc0');
    await held(soundAgain, 'audio/wav', 'unknown');

    const withoutPreserved = await fingerprintFiles(catalog, { fetchPublic: async (s) => bytes.get(s)! });
    expect(withoutPreserved.map((d) => d.sha256).sort()).toEqual([sha(pdf), sha(other), sha(sound)].sort());

    const done = await fingerprintFiles(catalog, { fetchPublic: async (s) => bytes.get(s)!, fetchPreserved: async (s) => bytes.get(s) ?? null });
    expect(done.map((d) => d.sha256).sort()).toEqual([sha(again), sha(soundAgain)].sort());
    expect(await similarFiles(catalog.db, sha(again))).toEqual([{ sha256: sha(pdf), kind: 'same', matched: 3, of: 3 }]);
    expect(await similarFiles(catalog.db, sha(soundAgain))).toEqual([expect.objectContaining({ sha256: sha(sound), kind: 'same' })]);
    expect(await similarFiles(catalog.db, sha(other))).toEqual([]);
  }, 60_000);

  it('reads a WAV file without any tool', () => {
    const decoded = decodeWav(wav(1, 1, 8000))!;
    expect(decoded.rate).toBe(8000);
    expect(decoded.samples).toHaveLength(8000);
    expect(decodeWav(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
