import { describe, expect, it } from 'vitest';
import { catalogHealth } from '@rebbehub/core';
import { checkLink, checkLinks, linksIn } from '../src/linkCheck.js';
import { add, freshCatalog, yudShvat } from '../../../packages/core/tests/helpers.js';

describe('dead links', () => {
  it("finds the addresses an item links to, and only those", () => {
    expect(
      linksIn({
        links: [{ kind: 'mugah', url: 'https://a.example/1.pdf', origin: 'https://drive.google.com/file/d/x' }],
        videos: [{ provider: 'youtube', url: 'https://youtu.be/y' }],
        note: 'https://not-a-link-field.example',
        url: 'ftp://old.example',
      }).sort(),
    ).toEqual(['https://a.example/1.pdf', 'https://drive.google.com/file/d/x', 'https://youtu.be/y']);
  });

  it('asks with HEAD, and with GET where a server will not answer HEAD', async () => {
    const calls: string[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method} ${url}`);
      const status = url.includes('gone') ? 404 : init?.method === 'HEAD' && url.includes('nohead') ? 405 : 200;
      return new Response(null, { status });
    }) as typeof fetch;
    expect(await checkLink('https://x.example/ok', { fetch: fake })).toEqual({ ok: true, status: 200, error: null });
    expect(await checkLink('https://x.example/nohead', { fetch: fake })).toEqual({ ok: true, status: 200, error: null });
    expect(await checkLink('https://x.example/gone', { fetch: fake })).toEqual({ ok: false, status: 404, error: 'answered 404' });
    expect(calls).toEqual(['HEAD https://x.example/ok', 'HEAD https://x.example/nohead', 'GET https://x.example/nohead', 'HEAD https://x.example/gone']);
    const failing = (async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }) as typeof fetch;
    expect(await checkLink('https://nowhere.example', { fetch: failing })).toEqual({ ok: false, status: null, error: 'getaddrinfo ENOTFOUND' });
  });

  it('records each answer for the health page, and keeps when a link first failed', async () => {
    const { catalog, set } = await freshCatalog();
    const event = await add(catalog, 'mendy', 'keeper', 'event', { ...yudShvat(set), links: [{ kind: 'mugah', label: { he: 'מוגה' }, url: 'https://files.example/gone.pdf' }] });
    await add(catalog, 'mendy', 'keeper', 'recording', { event, title: { he: 'חלק א' }, url: 'https://files.example/a.mp3', sets: [set] });
    let busy = true;
    const fake = (async (url: string) => new Response(null, { status: url.includes('gone') ? 404 : busy && url.endsWith('.mp3') ? 429 : 200 })) as typeof fetch;

    // A server that asks to slow down is not dead: its link keeps no answer yet.
    expect(await checkLinks(catalog, { fetch: fake })).toEqual({ links: 2, checked: 2, dead: 1 });
    expect((await catalogHealth(catalog)).links).toMatchObject({ checked: 1, dead: 1 });
    busy = false;
    expect(await checkLinks(catalog, { fetch: fake })).toEqual({ links: 2, checked: 2, dead: 1 });
    const first = await catalogHealth(catalog);
    expect(first.links).toMatchObject({ checked: 2, dead: 1 });
    expect(first.deadLinks).toHaveLength(1);
    expect(first.deadLinks).toMatchObject([{ url: 'https://files.example/gone.pdf', status: 404, entities: [event] }]);

    const since = first.deadLinks[0]!.failingSince;
    await checkLinks(catalog, { fetch: fake });
    expect((await catalogHealth(catalog)).deadLinks[0]!.failingSince).toBe(since);
  });
});
