import { GUEST_FILES, GUEST_PATH, TOKEN, type MediaSource, type Showcase, type ShowcaseStore } from '../app/lib/showcase.js';
import type { PageReader } from './handler.js';

/** Drive's download address for anyone with the link (services/api/src/drive.ts does the same). */
const driveDownloadUrl = (id: string, resourceKey: string | null) => {
  const query = new URLSearchParams({ id, export: 'download', confirm: 't' });
  if (resourceKey) query.set('resourcekey', resourceKey);
  return `https://drive.usercontent.google.com/download?${query}`;
};

/**
 * The showcases' side of the site's door (app/lib/showcase.ts, and the
 * lock in lock.ts): what a guest with a showcase's link may have, and
 * where showcases are kept.
 *
 * A guest's request comes here before the lock. A showcase's page, its
 * data and its transcripts go on to be made like any page; its files are
 * passed on from where they are kept, only those the showcase lists. A
 * token that is no showcase is answered as if it were any other address:
 * by the lock. The site's built files (scripts, styles, fonts) are given
 * to anyone, since a guest's page needs them and they are code, not
 * content.
 */

/** The little of an R2 bucket the store uses. */
export interface ShowcaseBucket {
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<{ objects: Array<{ key: string }>; truncated: boolean; cursor?: string }>;
}

const PREFIX = 'showcases/';

/** Showcases kept in the public bucket, one JSON file each (`showcases/<token>.json`), named by a token nobody can guess. */
export function r2Showcases(bucket: ShowcaseBucket): ShowcaseStore {
  const get = async (token: string): Promise<Showcase | null> => {
    if (!TOKEN.test(token)) return null;
    const object = await bucket.get(`${PREFIX}${token}.json`);
    return object ? (JSON.parse(await object.text()) as Showcase) : null;
  };
  return {
    get,
    put: async (showcase) => void (await bucket.put(`${PREFIX}${showcase.token}.json`, JSON.stringify(showcase), { httpMetadata: { contentType: 'application/json' } })),
    remove: (token) => bucket.delete(`${PREFIX}${token}.json`),
    async list() {
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await bucket.list({ prefix: PREFIX, cursor });
        keys.push(...page.objects.map((o) => o.key));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      const all = await Promise.all(keys.map((key) => get(key.slice(PREFIX.length).replace(/\.json$/, ''))));
      return all.filter((s): s is Showcase => s !== null).sort((a, b) => b.created.localeCompare(a.created));
    },
  };
}

export type GuestRequest =
  | { kind: 'file' }
  | { kind: 'page'; token: string }
  | { kind: 'media'; token: string; index: number }
  | { kind: 'transcript'; token: string; recording: string };

/** What a request is, as a guest's: null for everything a guest may not ask. */
export function guestRequest(request: Request): GuestRequest | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const { pathname } = new URL(request.url);
  if (GUEST_FILES.test(pathname)) return { kind: 'file' };
  const show = GUEST_PATH.exec(pathname);
  if (!show) return null;
  const token = show[1]!;
  if (show[2] !== undefined) return { kind: 'media', token, index: Number(show[2]) };
  if (show[3] !== undefined) return { kind: 'transcript', token, recording: show[3] };
  return { kind: 'page', token };
}

/** JEM's audio files, where Sichos-Kodesh's media proxy fetches them (services/media-proxy there): the way round it when it is not bound. */
const JEM_CDN = 'https://dtgj2yu3gmlic.cloudfront.net';
const AUDIO_TYPES = ['mp3', 'm4a', 'opus'];

const NOT_KEPT = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' };

/** What a file's answer keeps of the upstream's: its type, size and part, and nothing for shared caches or search engines. */
function passed(upstream: Response, type?: string): Response {
  const headers = new Headers(NOT_KEPT);
  headers.set('Content-Type', type ?? upstream.headers.get('content-type') ?? 'application/octet-stream');
  for (const name of ['content-length', 'content-range', 'accept-ranges', 'etag']) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has('accept-ranges')) headers.set('Accept-Ranges', 'bytes');
  return new Response(upstream.body, { status: upstream.status, headers });
}

/** JEM's file by its name, trying its other audio types as the media proxy does when the named one is not there. */
async function jemAudio(file: string, range: string | null, send: typeof fetch): Promise<Response> {
  const init = range ? { headers: { Range: range } } : undefined;
  const dot = file.lastIndexOf('.');
  const names = [file, ...AUDIO_TYPES.filter((t) => t !== file.slice(dot + 1)).map((t) => `${file.slice(0, dot)}.${t}`)];
  for (const name of names) {
    const answer = await send(`${JEM_CDN}/${name}`, init);
    if (answer.ok || answer.status === 206) return passed(answer);
    await answer.body?.cancel();
  }
  return new Response('The recording could not be fetched.', { status: 502, headers: NOT_KEPT });
}

/**
 * One of a showcase's files, by its place in the list: a recording or a
 * scan, from where it is kept. Files RebbeHub serves and Drive files go
 * through the API answering in this Worker (`reader`), so their rights and
 * takedowns hold here as everywhere. A Drive file no catalog item links
 * to yet (a farbrengen's written transcript Shmuly set beside it) is
 * fetched from Drive itself: the owner named it when saving, and only he
 * saves showcases.
 */
export async function showcaseMedia(
  source: MediaSource,
  request: Request,
  options: { apiUrl: string; reader: PageReader | null; fetch?: typeof fetch; media?: { fetch(request: Request): Promise<Response> } },
): Promise<Response> {
  const send = options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const range = request.headers.get('range');
  if (source.kind === 'jem') {
    // Through Sichos-Kodesh's media proxy, as the site's own player plays it (its service binding, never its public address);
    // straight from JEM's CDN when the proxy is not bound or does not answer.
    if (options.media) {
      const answer = await options.media.fetch(new Request(`https://media/jem-audio/${source.file}`, { headers: range ? { Range: range } : {} })).catch(() => null);
      if (answer && (answer.ok || answer.status === 206)) return passed(answer);
      await answer?.body?.cancel();
    }
    return jemAudio(source.file, range, send);
  }
  if (!options.reader) return new Response('Not here.', { status: 404, headers: NOT_KEPT });
  const base = options.apiUrl.replace(/\/$/, '');
  const path = source.kind === 'object' ? `/objects/${source.sha256}` : `/v1/drive/${source.id}`;
  let answer = await options.reader.answer(`${base}${path}`, { headers: range ? { Range: range } : {} });
  if (answer.status === 404 && source.kind === 'drive') {
    await answer.body?.cancel();
    answer = await send(driveDownloadUrl(source.id, source.resourceKey), { redirect: 'follow', headers: range ? { Range: range } : {} });
    // Drive answers a file it will not give with a page, not an error.
    if ((answer.ok || answer.status === 206) && (answer.headers.get('content-type') ?? '').includes('text/html')) {
      await answer.body?.cancel();
      return new Response('The file could not be fetched.', { status: 502, headers: NOT_KEPT });
    }
    if (answer.ok || answer.status === 206) return passed(answer, 'application/pdf');
  }
  if (!answer.ok && answer.status !== 206) {
    await answer.body?.cancel();
    return new Response('The file could not be fetched.', { status: answer.status === 404 ? 404 : 502, headers: NOT_KEPT });
  }
  return passed(answer);
}

/** Whether a showcase lets a guest read this recording's transcript. */
export const mayReadTranscript = (showcase: Showcase, recording: string) => showcase.transcripts.includes(recording);
