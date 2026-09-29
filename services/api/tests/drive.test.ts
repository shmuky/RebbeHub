import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type { Catalog } from '@rebbehub/core';
import { createApp } from '../src/app.js';
import { sniffType } from '../src/drive.js';
import { memoryRateLimiter, mayUseEdgeCache } from '../src/platform.js';
import { add, freshCatalog, yudShvat } from '../../../packages/core/tests/helpers.js';

/**
 * GET /v1/drive/<id>: a Google Drive file the catalog links to, read for
 * the site's reader and player, with CORS and Range; never any other file.
 */

const PDF = new TextEncoder().encode('%PDF-1.4\n' + 'x'.repeat(200));
const KEYED = '1tk7tznpZCW0cyFVuNPcwYZMaqzSIC9oO';
const OLD = '1KgxR1B-ab3l4kp_VMg-1WgudgSZpxfdJ';

let app: Hono;
let catalog: Catalog;
let asked: Array<{ url: string; range: string | null }>;
let answer: (url: URL, range: string | null) => Response;

beforeEach(async () => {
  const fresh = await freshCatalog();
  catalog = fresh.catalog;
  // One farbrengen's hanachos: one at its Drive address (with a resource key), one still on the old media proxy.
  await add(catalog, 'mendy', 'keeper', 'event', {
    ...yudShvat(fresh.set),
    links: [
      { kind: 'bilti-mugah', label: { he: 'הנחה' }, url: `https://drive.google.com/file/d/${KEYED}/view?resourcekey=0-Xqz7bN0vTC1CZxMnwXcPeg`, source: 'mafteiach' },
      { kind: 'mugah', label: { he: 'לקו"ש' }, url: `https://sichos-kodesh-media-proxy.shmuky.workers.dev/drive/${OLD}?filename=${OLD}.pdf`, source: 'mafteiach' },
    ],
  }, '/events/5742-05-10');
  asked = [];
  answer = (_url, range) => {
    if (!range) return new Response(PDF, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(PDF.byteLength) } });
    const [, from, to] = /bytes=(\d+)-(\d+)/.exec(range)!;
    const part = PDF.subarray(Number(from), Number(to) + 1);
    return new Response(part, { status: 206, headers: { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${from}-${to}/${PDF.byteLength}`, 'Content-Length': String(part.byteLength) } });
  };
  const fetch = (async (input: string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('Range');
    asked.push({ url: input, range });
    return answer(new URL(input), range);
  }) as unknown as typeof globalThis.fetch;
  app = createApp({ catalog, drive: { fetch, maxBytes: 1000, limiter: memoryRateLimiter(3, 60, () => 0) } });
});

describe('GET /v1/drive/<id>', () => {
  it("reads a file the catalog links to, with its resource key, as a PDF anyone's page may read", async () => {
    const response = await app.request(`/v1/drive/${KEYED}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf'); // Drive says octet-stream for everything
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(response.headers.get('accept-ranges')).toBe('bytes');
    expect(response.headers.get('cache-control')).toContain('s-maxage=604800');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF);
    const url = new URL(asked[0]!.url);
    expect(url.hostname).toBe('drive.usercontent.google.com');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ id: KEYED, export: 'download', confirm: 't', resourcekey: '0-Xqz7bN0vTC1CZxMnwXcPeg' });
  });

  it('passes a Range on and answers the part', async () => {
    const response = await app.request(`/v1/drive/${KEYED}`, { headers: { Range: 'bytes=5-9' } });
    expect(response.status).toBe(206);
    expect(response.headers.get('content-range')).toBe(`bytes 5-9/${PDF.byteLength}`);
    expect(new TextDecoder().decode(await response.arrayBuffer())).toBe('1.4\nx');
    expect(asked[0]!.range).toBe('bytes=5-9');
  });

  it('reads a file linked only through the old media proxy too', async () => {
    expect((await app.request(`/v1/drive/${OLD}`)).status).toBe(200);
  });

  it('reads no file the catalog does not link to, and nothing that is not a Drive id', async () => {
    const unknown = await app.request('/v1/drive/1SomeoneElsesFileAltogether');
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toMatchObject({ error: 'not-found' });
    expect((await app.request('/v1/drive/short')).status).toBe(400);
    expect(asked).toEqual([]); // Drive was never asked
  });

  it('passes on no file over the size cap', async () => {
    answer = () => new Response('%PDF-', { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': '5000' } });
    const response = await app.request(`/v1/drive/${KEYED}`);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: 'too-large' });
  });

  it("says so when Drive will not give the file", async () => {
    answer = () => new Response('<html>Quota exceeded</html>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    const response = await app.request(`/v1/drive/${KEYED}`);
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: 'upstream' });
  });

  it('counts files read per address', async () => {
    const from = { headers: { 'CF-Connecting-IP': '203.0.113.9' } };
    for (let i = 0; i < 3; i++) expect((await app.request(`/v1/drive/${KEYED}`, from)).status).toBe(200);
    const fourth = await app.request(`/v1/drive/${KEYED}`, from);
    expect(fourth.status).toBe(429);
    expect(fourth.headers.get('retry-after')).toBe('60');
  });

  it('keeps whole files at the edge, not parts', () => {
    const request = (headers: Record<string, string> = {}) => new Request(`https://api.rebbehub.org/v1/drive/${KEYED}`, { headers });
    expect(mayUseEdgeCache(request())).toBe(true);
    expect(mayUseEdgeCache(request({ Range: 'bytes=0-99' }))).toBe(false);
  });

  it('tells a PDF and recordings from their first bytes', () => {
    const bytes = (text: string) => new TextEncoder().encode(text);
    expect(sniffType(bytes('%PDF-1.7'))).toBe('application/pdf');
    expect(sniffType(bytes('ID3\u0004'))).toBe('audio/mpeg');
    expect(sniffType(bytes('\u0000\u0000\u0000\u0018ftypM4A '))).toBe('audio/mp4');
    expect(sniffType(bytes('OggS'))).toBe('audio/ogg');
    expect(sniffType(bytes('<html>'))).toBeNull();
  });
});
