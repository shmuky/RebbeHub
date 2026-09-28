/**
 * Fingerprints, so the same scan or recording is not taken twice
 * (docs/plans/rebbehub.md, sections 7 and 9: "perceptual page hashes and
 * audio fingerprints catch the same scan or recording uploaded twice").
 *
 * A file's sha256 catches the very same bytes. These catch the same pages
 * or the same sound in other bytes: a scan saved again, squeezed smaller,
 * or with a page more; a recording encoded again at another bitrate. They
 * are plain TypeScript with no dependencies, so the site (in the browser,
 * before an upload) and the jobs (on the server, for every held file)
 * compute exactly the same thing.
 *
 * What they say is a machine's guess, shown as one ("looks like"), never
 * a decision: a person confirms.
 */

// ---------------------------------------------------------------- pages

/** The page hash's version, as recorded with each file's hashes; bumped whenever a hash would come out differently. */
export const PAGE_HASH_ENCODER = 'dhash-256@1';

const COLS = 17;
const ROWS = 16;

/** How much lighter (of 255) a cell must be than the one before it to count: cells of plain paper differ by less, however the page was saved. */
const STEP = 3;

/** How far apart (in bits of 256) two hashes of the same page may be: a page saved again differs by a few. */
export const PAGE_HASH_NEAR = 24;

/** A greyscale picture of a page: one byte per pixel, 0 black to 255 white, row by row. */
export interface GreyImage {
  width: number;
  height: number;
  gray: Uint8Array | Uint8ClampedArray;
}

/**
 * A page's perceptual hash (a 256-bit difference hash, as 64 hex digits):
 * the page shrunk to 17 by 16 cells, each bit saying whether a cell is
 * darker than the one after it. The same page drawn at any size, or saved
 * again, gives nearly the same bits; another page gives about half of them
 * different. Null for a blank page, which would look like every other
 * blank page.
 */
export function pageHash(image: GreyImage): string | null {
  const { width, height, gray } = image;
  if (width < 1 || height < 1 || gray.length < width * height) throw new RangeError('a page image needs width × height grey values');
  const cells = new Float64Array(COLS * ROWS);
  for (let row = 0; row < ROWS; row++) {
    const y0 = Math.floor((row * height) / ROWS);
    const y1 = Math.max(y0 + 1, Math.floor(((row + 1) * height) / ROWS));
    for (let col = 0; col < COLS; col++) {
      const x0 = Math.floor((col * width) / COLS);
      const x1 = Math.max(x0 + 1, Math.floor(((col + 1) * width) / COLS));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < Math.min(y1, height); y++) {
        const at = y * width;
        for (let x = x0; x < Math.min(x1, width); x++) {
          sum += gray[at + x]!;
          n++;
        }
      }
      cells[row * COLS + col] = n ? sum / n : 255;
    }
  }
  // A page with nothing on it (its cells all but the same) has no hash worth comparing.
  let mean = 0;
  for (const c of cells) mean += c;
  mean /= cells.length;
  let variance = 0;
  for (const c of cells) variance += (c - mean) ** 2;
  if (Math.sqrt(variance / cells.length) < 1.5) return null;
  let hex = '';
  for (let row = 0; row < ROWS; row++) {
    for (let nibble = 0; nibble < 4; nibble++) {
      let value = 0;
      for (let bit = 0; bit < 4; bit++) {
        const col = nibble * 4 + bit;
        value = (value << 1) | (cells[row * COLS + col + 1]! - cells[row * COLS + col]! > STEP ? 1 : 0);
      }
      hex += value.toString(16);
    }
  }
  return hex;
}

const NIBBLE_BITS = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

/** How many of two page hashes' bits differ (0 to 256). */
export function hashDistance(a: string, b: string): number {
  if (a.length !== b.length) throw new RangeError('page hashes of different lengths');
  let bits = 0;
  for (let i = 0; i < a.length; i++) bits += NIBBLE_BITS[parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16)]!;
  return bits;
}

/**
 * A page hash cut in 16 bands of 16 bits, each tagged with its place
 * (`band × 65536 + value`), for finding near pages in the database: two
 * hashes fewer than 16 bits apart share at least one band exactly, so an
 * index on the bands finds them without comparing every page.
 */
export function hashBands(hash: string): number[] {
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new RangeError('a page hash is 64 hex digits');
  return Array.from({ length: 16 }, (_, band) => band * 65536 + parseInt(hash.slice(band * 4, band * 4 + 4), 16));
}

/** How much of one scan's pages are in another: its pages (not blank) that have a near page there, of how many. */
export function comparePages(pages: ReadonlyArray<string | null>, other: ReadonlyArray<string | null>, near = PAGE_HASH_NEAR): { matched: number; of: number } {
  const theirs = other.filter((h): h is string => h !== null);
  let matched = 0;
  let of = 0;
  for (const hash of pages) {
    if (hash === null) continue;
    of++;
    if (theirs.some((h) => hashDistance(hash, h) <= near)) matched++;
  }
  return { matched, of };
}

/** Whether a comparison says the same scan: four pages in five, or more, alike. */
export function looksSameScan(match: { matched: number; of: number }): boolean {
  return match.of > 0 && match.matched >= Math.ceil(match.of * 0.8);
}

/** Whether it says the scans share pages (a scan of the same printing with pages missing or added, a teshura reprinting part of it): two pages alike, or one of a very short scan. */
export function sharesPages(match: { matched: number; of: number }): boolean {
  return match.matched >= 2 || (match.matched === 1 && match.of <= 4);
}

/** Which pages of a long scan to hash before an upload: all of a short one, else an even spread (the first and last among them). */
export function samplePages(count: number, most = 12): number[] {
  if (count <= most) return Array.from({ length: count }, (_, i) => i + 1);
  return [...new Set(Array.from({ length: most }, (_, i) => 1 + Math.round((i * (count - 1)) / (most - 1))))];
}

// ---------------------------------------------------------------- sound

/** The audio fingerprint's version, recorded with each one. */
export const AUDIO_FINGERPRINT_ENCODER = 'rh-audio@1';

/** The rate sound is brought to before it is fingerprinted. */
export const AUDIO_RATE = 5512;
const FRAME = 2048;
const HOP = 512;
const BANDS = 33;

/** Sub-fingerprints per second of sound. */
export const AUDIO_FRAMES_PER_SECOND = AUDIO_RATE / HOP;

/** Mono sound at `rate`, brought to AUDIO_RATE: each new sample the mean of the old ones it covers. */
export function resample(samples: Float32Array, rate: number): Float32Array {
  if (rate === AUDIO_RATE) return samples;
  const ratio = rate / AUDIO_RATE;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    if (ratio >= 1) {
      const from = Math.floor(i * ratio);
      const to = Math.max(from + 1, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = from; j < to && j < samples.length; j++) sum += samples[j]!;
      out[i] = sum / (to - from);
    } else {
      const at = i * ratio;
      const j = Math.floor(at);
      const t = at - j;
      out[i] = (samples[j] ?? 0) * (1 - t) + (samples[j + 1] ?? samples[j] ?? 0) * t;
    }
  }
  return out;
}

/** An in-place radix-2 FFT of `re`/`im` (length a power of two). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b]! * cr - im[b]! * ci;
        const ti = re[b]! * ci + im[b]! * cr;
        re[b] = re[a]! - tr;
        im[b] = im[a]! - ti;
        re[a] = re[a]! + tr;
        im[a] = im[a]! + ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

/** The FFT bins that bound the 33 bands, spaced evenly in pitch from 300 to 2000 Hz, where speech carries. */
const BAND_EDGES = Array.from({ length: BANDS + 1 }, (_, i) => Math.round((300 * (2000 / 300) ** (i / BANDS) * FRAME) / AUDIO_RATE));
const WINDOW = Float64Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));

/**
 * A recording's fingerprint (the robust hash of Haitsma and Kalker): one
 * 32-bit number per 93 ms, each bit saying whether the loudness of one
 * band of pitch rose against the next band more than it did a moment
 * before. The same sound encoded again keeps nearly every bit; other
 * sound agrees on about half. `samples` is mono sound at `rate`.
 */
export function audioFingerprint(samples: Float32Array, rate: number): Int32Array {
  const sound = resample(samples, rate);
  const frames = sound.length < FRAME ? 0 : Math.floor((sound.length - FRAME) / HOP) + 1;
  const out = new Int32Array(Math.max(0, frames - 1));
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  let previous: Float64Array | null = null;
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < FRAME; i++) {
      re[i] = sound[f * HOP + i]! * WINDOW[i]!;
      im[i] = 0;
    }
    fft(re, im);
    const energy = new Float64Array(BANDS);
    for (let b = 0; b < BANDS; b++) {
      let sum = 0;
      for (let k = BAND_EDGES[b]!; k < BAND_EDGES[b + 1]!; k++) sum += re[k]! * re[k]! + im[k]! * im[k]!;
      energy[b] = sum;
    }
    if (previous) {
      let bits = 0;
      for (let m = 0; m < 32; m++) {
        const now = energy[m]! - energy[m + 1]!;
        const before = previous[m]! - previous[m + 1]!;
        if (now - before > 0) bits |= 1 << m;
      }
      out[f - 1] = bits;
    }
    previous = energy;
  }
  return out;
}

function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** How alike two fingerprints are at their best alignment: the share of bits that differ (0 the same, about 0.5 unrelated). */
export interface AudioMatch {
  /** Bit error rate over the frames compared. */
  errors: number;
  /** Frames `b` starts after `a` (negative: before). */
  offset: number;
  /** How many frames were compared. */
  overlap: number;
}

/**
 * Compares a stretch of `a` (two minutes from its tenth second, or all
 * of a shorter one) against `b` shifted by up to `maxShift` frames either
 * way (a minute, by default), so a copy with a little more or less at its
 * start is still found.
 */
export function compareAudio(a: ArrayLike<number>, b: ArrayLike<number>, maxShift = Math.round(60 * AUDIO_FRAMES_PER_SECOND)): AudioMatch {
  const skip = a.length > 20 * AUDIO_FRAMES_PER_SECOND ? Math.round(10 * AUDIO_FRAMES_PER_SECOND) : 0;
  const length = Math.min(a.length - skip, Math.round(120 * AUDIO_FRAMES_PER_SECOND));
  let best: AudioMatch = { errors: 1, offset: 0, overlap: 0 };
  for (let shift = -maxShift; shift <= maxShift; shift++) {
    let errors = 0;
    let overlap = 0;
    for (let i = 0; i < length; i++) {
      const j = skip + i + shift;
      if (j < 0 || j >= b.length) continue;
      errors += popcount((a[skip + i]! ^ b[j]!) >>> 0);
      overlap++;
    }
    if (overlap < Math.min(length, 20)) continue;
    const rate = errors / (overlap * 32);
    if (rate < best.errors) best = { errors: rate, offset: shift, overlap };
  }
  return best;
}

/** Whether a match says the same recording: fewer than a third of the bits differ, over at least four seconds. */
export function sameRecording(match: AudioMatch): boolean {
  return match.errors < 0.33 && match.overlap >= 40;
}
