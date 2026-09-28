import { describe, expect, it } from 'vitest';
import {
  AUDIO_RATE,
  audioFingerprint,
  compareAudio,
  comparePages,
  hashBands,
  hashDistance,
  looksSameScan,
  pageHash,
  sameRecording,
  samplePages,
  sharesPages,
  type GreyImage,
} from '@rebbehub/model';

/** A made-up page of "type": rows of dark blocks placed by `seed`, at any size. */
function page(seed: number, width = 340, height = 480, noise = 0): GreyImage {
  const gray = new Uint8Array(width * height).fill(250);
  let s = seed;
  const random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let line = 0; line < 22; line++) {
    const y0 = Math.floor(height * (0.1 + line * 0.037));
    let x = 0.1 + random() * 0.05;
    while (x < 0.9) {
      const w = 0.02 + random() * 0.08;
      for (let y = y0; y < y0 + height * 0.02; y++) for (let px = Math.floor(x * width); px < Math.min(width * 0.9, (x + w) * width); px++) gray[y * width + px] = 20;
      x += w + 0.015 + random() * 0.04;
    }
    if (random() < 0.3) line++; // a paragraph break
  }
  if (noise) for (let i = 0; i < gray.length; i++) gray[i] = Math.max(0, Math.min(255, gray[i]! + Math.round((random() - 0.5) * noise)));
  return { width, height, gray };
}

describe('page hashes', () => {
  it('gives the same page nearly the same hash at another size, or saved again with noise', () => {
    const a = pageHash(page(11))!;
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashDistance(a, pageHash(page(11, 850, 1200))!)).toBeLessThanOrEqual(12);
    expect(hashDistance(a, pageHash(page(11, 340, 480, 40))!)).toBeLessThanOrEqual(12);
  });

  it('tells other pages apart', () => {
    const hashes = [1, 2, 3, 4, 5, 6].map((seed) => pageHash(page(seed * 977))!);
    for (let i = 0; i < hashes.length; i++) for (let j = i + 1; j < hashes.length; j++) expect(hashDistance(hashes[i]!, hashes[j]!)).toBeGreaterThan(40);
  });

  it('gives a blank page no hash', () => {
    expect(pageHash({ width: 100, height: 140, gray: new Uint8Array(14000).fill(240) })).toBeNull();
  });

  it('cuts a hash in 16 tagged bands, so near hashes share one', () => {
    const a = pageHash(page(5))!;
    const bands = hashBands(a);
    expect(bands).toHaveLength(16);
    expect(bands[3]! >> 16).toBe(3);
    const b = pageHash(page(5, 700, 990, 30))!;
    expect(hashBands(b).some((band, i) => band === bands[i])).toBe(true);
  });

  it('compares scans: the same, sharing pages, or other', () => {
    const scan = [1, 2, 3, 4, 5].map((s) => pageHash(page(s * 31))!);
    const again = [1, 2, 3, 4, 5].map((s) => pageHash(page(s * 31, 500, 700, 20))!);
    const other = [6, 7, 8].map((s) => pageHash(page(s * 31))!);
    expect(comparePages(again, scan)).toEqual({ matched: 5, of: 5 });
    expect(looksSameScan(comparePages(again, scan))).toBe(true);
    const part = comparePages([...again.slice(0, 2), ...other], scan);
    expect(part).toEqual({ matched: 2, of: 5 });
    expect(looksSameScan(part)).toBe(false);
    expect(sharesPages(part)).toBe(true);
    expect(sharesPages(comparePages(other, scan))).toBe(false);
  });

  it('samples a long scan evenly, first and last page among them', () => {
    expect(samplePages(3)).toEqual([1, 2, 3]);
    const sample = samplePages(400);
    expect(sample).toHaveLength(12);
    expect(sample[0]).toBe(1);
    expect(sample.at(-1)).toBe(400);
  });
});

/** Speech-like made-up sound: tones that change pitch and loudness every few tenths of a second. */
function sound(seed: number, seconds: number, rate: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * rate));
  let s = seed;
  const random = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  let freq = 400;
  let amp = 0.5;
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    if (i % Math.round(rate * 0.2) === 0) {
      freq = 300 + random() * 1500;
      amp = 0.1 + random() * 0.8;
    }
    phase += (2 * Math.PI * freq) / rate;
    out[i] = amp * Math.sin(phase) + 0.3 * amp * Math.sin(phase * 2.01);
  }
  return out;
}

describe('audio fingerprints', () => {
  const original = sound(7, 30, 16000);

  it('finds the same recording at another rate, quieter, and with a few seconds cut from its start', () => {
    const a = audioFingerprint(original, 16000);
    expect(a.length).toBeGreaterThan(300);
    const resampled = audioFingerprint(sound(7, 30, 22050).map((x) => x * 0.6), 22050);
    expect(sameRecording(compareAudio(resampled, a))).toBe(true);
    const cut = audioFingerprint(original.slice(16000 * 3), 16000);
    const match = compareAudio(cut, a);
    expect(sameRecording(match)).toBe(true);
    expect(Math.abs(match.offset - 32)).toBeLessThanOrEqual(1); // three seconds, at 10.8 frames a second
  });

  it('tells another recording apart', () => {
    const match = compareAudio(audioFingerprint(sound(99, 30, AUDIO_RATE), AUDIO_RATE), audioFingerprint(original, 16000));
    expect(match.errors).toBeGreaterThan(0.38);
    expect(sameRecording(match)).toBe(false);
  });
});
