import type { Context, Hono } from 'hono';
import { knownDriveFile, type Catalog } from '@rebbehub/core';
import { callerAddress, type RateLimiter } from './platform.js';

/**
 * A Google Drive file the catalog links to, read for the site's reader and
 * player (docs/configuration.md, "Drive files"):
 *
 *   GET /v1/drive/<Drive file id>
 *
 * The catalog stores each PDF's own address on Drive (the mafteiach's and
 * Otzros HaRebbe's link); pdf.js and the audio player need the bytes from
 * an address that allows other sites' pages (CORS) and answers a part of
 * a file (Range), which Drive does not. This is RebbeHub's own way there,
 * as Sichos-Kodesh's media proxy was for its app, so the site depends on
 * no one else's server.
 *
 * - Only files an item on main links to (packages/core/src/driveFiles.ts),
 *   so it is not a way to fetch just any file from Drive. A file linked
 *   with a resource key is fetched with it.
 * - The whole file is kept at Cloudflare's edge for a week (a Drive file's
 *   bytes do not change under its id); a part of one (Range) is fetched
 *   fresh each time, as a file's parts from R2 are.
 * - A file larger than `maxBytes` is not passed on.
 * - Requests per address are counted against `limiter`, when set.
 */

export interface DriveOptions {
  /** How Drive is reached (tests pass their own). */
  fetch?: typeof fetch;
  /** The largest file passed on, in bytes. */
  maxBytes?: number;
  /** Requests per address a minute, on top of the API's own allowance (RATE_LIMIT_DRIVE on Workers). */
  limiter?: RateLimiter;
}

export const DRIVE_MAX_BYTES = 300 * 1024 * 1024;
const DRIVE_ID = /^[A-Za-z0-9_-]{10,64}$/;
/** A week at the edge and a day in browsers: the bytes behind a Drive id do not change. */
const CACHE = 'public, max-age=86400, s-maxage=604800, immutable';

/** Drive's download address for anyone with the link, past its virus-scan page for large files. */
export function driveDownloadUrl(fileId: string, resourceKey: string | null): string {
  const query = new URLSearchParams({ id: fileId, export: 'download', confirm: 't' });
  if (resourceKey) query.set('resourcekey', resourceKey);
  return `https://drive.usercontent.google.com/download?${query}`;
}

/** What a file is, from its first bytes, when Drive says only "octet-stream" (it says so for every file). */
export function sniffType(head: Uint8Array): string | null {
  const text = (from: number, n: number) => String.fromCharCode(...head.subarray(from, from + n));
  if (text(0, 5) === '%PDF-') return 'application/pdf';
  if (text(0, 3) === 'ID3' || (head[0] === 0xff && ((head[1] ?? 0) & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (text(4, 4) === 'ftyp') return 'audio/mp4';
  if (text(0, 4) === 'OggS') return 'audio/ogg';
  if (text(0, 4) === 'RIFF' && text(8, 4) === 'WAVE') return 'audio/wav';
  return null;
}

/** The total size an answer tells: Content-Range's for a part, else Content-Length. */
function totalSize(upstream: Response): number | null {
  const range = /\/(\d+)$/.exec(upstream.headers.get('content-range') ?? '')?.[1];
  const value = range ?? upstream.headers.get('content-length');
  return value ? Number(value) : null;
}

/** The body, cut off (as an error) past `max` bytes: for an answer that did not say its size. */
function capped(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > max) controller.error(new Error('the file is larger than RebbeHub passes on'));
        else controller.enqueue(chunk);
      },
    }),
  );
}

/** The body with its first chunk read, so its type can be told, then the rest as it comes. */
async function peek(body: ReadableStream<Uint8Array>): Promise<{ head: Uint8Array; body: ReadableStream<Uint8Array> }> {
  const reader = body.getReader();
  const first = await reader.read();
  const head = first.value ?? new Uint8Array();
  let sent = false;
  return {
    head,
    body: new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (!sent) {
          sent = true;
          if (first.done) return controller.close();
          controller.enqueue(head);
          return;
        }
        const next = await reader.read();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    }),
  };
}

export function driveRoutes(app: Hono, catalog: Catalog, options: DriveOptions = {}): void {
  const get = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const maxBytes = options.maxBytes ?? DRIVE_MAX_BYTES;
  const fail = (c: Context, status: 400 | 404 | 413 | 429 | 502, error: string, message: string) => c.json({ error, message }, status, { 'Cache-Control': 'no-store' });

  app.get('/v1/drive/:id', async (c) => {
    const fileId = c.req.param('id');
    if (!DRIVE_ID.test(fileId)) return fail(c, 400, 'bad-request', `"${fileId}" is not a Google Drive file id`);
    const ip = callerAddress(c);
    if (ip && options.limiter && !(await options.limiter.limit({ key: ip })).success) {
      c.header('Retry-After', '60');
      return fail(c, 429, 'rate-limited', 'too many files read from Drive; wait a minute');
    }
    const file = await knownDriveFile(catalog.db, fileId);
    if (!file) return fail(c, 404, 'not-found', 'no item in the catalog links to this Drive file');

    const range = c.req.header('Range');
    const upstream = await get(driveDownloadUrl(file.id, file.resourceKey), { redirect: 'follow', headers: range ? { Range: range } : {} }).catch(() => null);
    if (!upstream || (!upstream.ok && upstream.status !== 206)) {
      if (upstream?.status === 416) return new Response(null, { status: 416, headers: { 'Content-Range': upstream.headers.get('content-range') ?? '' } });
      return fail(c, 502, 'upstream', `Google Drive did not give the file${upstream ? ` (it answered ${upstream.status})` : ''}`);
    }
    const upstreamType = upstream.headers.get('content-type') ?? '';
    // Drive answers a file it will not give (too many downloads, no longer shared) with a page, not an error.
    if (upstreamType.includes('text/html')) {
      await upstream.body?.cancel();
      return fail(c, 502, 'upstream', 'Google Drive did not give the file (it answered with a page)');
    }
    const size = totalSize(upstream);
    if (size !== null && size > maxBytes) {
      await upstream.body?.cancel();
      return fail(c, 413, 'too-large', `the file is ${Math.round(size / 1048576)} MB; RebbeHub passes on files up to ${Math.round(maxBytes / 1048576)} MB`);
    }

    const headers = new Headers({ 'Cache-Control': CACHE, 'Accept-Ranges': 'bytes', 'Content-Disposition': 'inline' });
    for (const name of ['content-length', 'content-range']) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    let body: ReadableStream<Uint8Array> | null = upstream.body;
    let type = /octet-stream|binary/.test(upstreamType) || !upstreamType ? null : upstreamType;
    // The first bytes tell a PDF or a recording, when the answer starts at the file's start.
    if (!type && body && (upstream.status === 200 || /^bytes 0-/.test(upstream.headers.get('content-range') ?? ''))) {
      const peeked = await peek(body);
      type = sniffType(peeked.head);
      body = peeked.body;
    }
    headers.set('Content-Type', type ?? 'application/octet-stream');
    if (body && size === null) body = capped(body, maxBytes);
    return new Response(c.req.method === 'HEAD' ? null : body, { status: upstream.status, headers });
  });
}
