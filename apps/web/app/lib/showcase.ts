/**
 * A showcase: one page Shmuly opens for the people he meets, at a secret
 * address of its own (`/show/<token>`), while the rest of RebbeHub is
 * private (server/lock.ts). He picks what it shows at `/showcase`: the
 * farbrengens whose transcripts play as lyrics, the sichos whose scans
 * sit beside their words, and the rest of what RebbeHub does (the day's
 * Hayom Yom as printed, the subject index, the models' scores, the
 * catalog in numbers).
 *
 * A guest gets that page and nothing else: its own reads are answered in
 * the site's Worker, and its recordings and scans are passed on by the
 * site only as the showcase lists them (`media`, fixed when it is saved),
 * so the link opens no other door (server/showcase.ts).
 */

/** Where a recording's or scan's bytes are, for a guest to be given them through the showcase. */
export type MediaSource =
  /** A file RebbeHub serves itself, from the public bucket (`objects/<sha256>`). */
  | { kind: 'object'; sha256: string }
  /** JEM's audio, from its CDN (what Sichos-Kodesh's media proxy passes on). */
  | { kind: 'jem'; file: string }
  /** A Google Drive file the catalog links to (a sicha's PDF). */
  | { kind: 'drive'; id: string; resourceKey: string | null };

export interface ShowcaseExtras {
  /** The day's Hayom Yom, set as the book prints it. */
  daily: boolean;
  /** Likkutei Sichos' subject index, searchable. */
  mafteach: boolean;
  /** RebbeHub's models and their scores (their scores only; the models are not released). */
  models: boolean;
  /** The catalog in numbers. */
  numbers: boolean;
}

export interface Showcase {
  token: string;
  title: string;
  /** A line under the title: who it is for, or what to look at. */
  note: string;
  lang: 'he' | 'en';
  created: string;
  updated: string;
  /** Farbrengens (event ids), in the order shown. */
  farbrengens: string[];
  /** Sichos (unit ids), in the order shown. */
  sichos: string[];
  extras: ShowcaseExtras;
  /** Every file a guest may be given, by its place in this list (`/show/<token>/m/<n>`). */
  media: MediaSource[];
  /** A recording's or sicha's file: the place in `media`. */
  mediaOf: Record<string, number>;
  /** Recordings whose transcripts a guest may read (`/show/<token>/t/<recording>`). */
  transcripts: string[];
}

export interface ShowcaseStore {
  get(token: string): Promise<Showcase | null>;
  put(showcase: Showcase): Promise<void>;
  remove(token: string): Promise<void>;
  /** Every showcase, the newest first. */
  list(): Promise<Showcase[]>;
}

/** A token's shape: twenty letters and digits of base32 (100 bits), so it is not guessed. */
export const TOKEN = /^[a-z2-7]{20}$/;

/** What a guest may ask for: the page, its data for the browser, a file, a transcript. */
export const GUEST_PATH = /^\/show\/([a-z2-7]{20})(?:\.data|\/m\/(\d{1,4})|\/t\/(rh-[0-9a-z]+))?$/;

/** The site's own built files a guest's page needs (scripts, styles, fonts, the PDF reader's parts, icons): code, never content. */
export const GUEST_FILES = /^\/(?:(?:assets|fonts|pdf-wasm|pdf-cmaps|pdf-standard-fonts)\/[\w./-]+|favicon\.svg|apple-touch-icon\.png|icon-[\w-]+\.png)$/;

export function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
  return [...bytes].map((b) => alphabet[b & 31]).join('');
}

export const NO_EXTRAS: ShowcaseExtras = { daily: false, mafteach: false, models: false, numbers: false };

const MEDIA_PROXY_JEM = /^https:\/\/sichos-kodesh-media-proxy\.[\w.-]+\/jem-audio\/([\w-]{1,64}\.(?:mp3|m4a|opus))$/;
const OBJECT_URL = /\/objects\/([0-9a-f]{64})$/;
const DRIVE_URL = /^https:\/\/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:[^#]*&)?id=)([\w-]{10,64})/;

/** Where a recording's or scan's address says its bytes are; null for what a showcase cannot pass on. */
export function mediaSourceOf(url: string | null | undefined): MediaSource | null {
  if (!url) return null;
  const jem = MEDIA_PROXY_JEM.exec(url);
  if (jem) return { kind: 'jem', file: jem[1]! };
  const object = OBJECT_URL.exec(url);
  if (object) return { kind: 'object', sha256: object[1]! };
  const drive = DRIVE_URL.exec(url);
  if (drive) return { kind: 'drive', id: drive[1]!, resourceKey: new URL(url).searchParams.get('resourcekey') };
  return null;
}

/** A guest's address of a showcase's file. */
export const mediaPath = (token: string, index: number) => `/show/${token}/m/${index}`;

/** A guest's address of a showcase's transcript. */
export const transcriptPath = (token: string, recording: string) => `/show/${token}/t/${recording}`;

/** A store kept in memory: for the site on Node (local work) and for tests. */
export function memoryShowcases(): ShowcaseStore {
  const kept = new Map<string, Showcase>();
  return {
    get: async (token) => kept.get(token) ?? null,
    put: async (showcase) => void kept.set(showcase.token, structuredClone(showcase)),
    remove: async (token) => void kept.delete(token),
    list: async () => [...kept.values()].sort((a, b) => b.created.localeCompare(a.created)),
  };
}
