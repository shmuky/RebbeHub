import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ServerBuild } from 'react-router';
import { Catalog, type Json } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';
import { createApp } from '../../../services/api/src/app.js';
import { add, freshCatalog } from '../../../packages/core/tests/helpers.js';
import { createSiteHandler } from '../server/handler.js';
import { guestRequest, r2Showcases, showcaseMedia, type ShowcaseBucket } from '../server/showcase.js';
import { mediaSourceOf, memoryShowcases, newToken, NO_EXTRAS, TOKEN, type Showcase } from '../app/lib/showcase.js';

/** Showcases (app/lib/showcase.ts): what a guest's link opens, where they are kept, and making one. */

const JEM = 'https://sichos-kodesh-media-proxy.shmuky.workers.dev/jem-audio/AR0020571.mp3';
const token = 'abcdefghijklmnopqrst';

describe("a guest's requests", () => {
  const as = (path: string, method = 'GET') => guestRequest(new Request(`https://rebbehub.org${path}`, { method }));

  it('lets in a showcase page, its data, files and transcripts, and the built files', () => {
    expect(as(`/show/${token}`)).toEqual({ kind: 'page', token });
    expect(as(`/show/${token}.data`)).toEqual({ kind: 'page', token });
    expect(as(`/show/${token}/m/3`)).toEqual({ kind: 'media', token, index: 3 });
    expect(as(`/show/${token}/t/rh-6k5yytx6`)).toEqual({ kind: 'transcript', token, recording: 'rh-6k5yytx6' });
    expect(as('/assets/root-abc123.js')).toEqual({ kind: 'file' });
    expect(as('/fonts/noto-sans-hebrew-400.woff2')).toEqual({ kind: 'file' });
  });

  it('lets in nothing else', () => {
    for (const path of ['/', '/showcase', '/show', `/show/${token}/x`, '/show/short', `/show/${token.toUpperCase()}`, '/likkutei-sichos', '/_/auth/me', '/assets/../showcase', '/sw.js']) expect(as(path), path).toBeNull();
    expect(as(`/show/${token}`, 'POST')).toBeNull();
  });

  it('is given tokens nobody guesses', () => {
    const a = newToken();
    expect(a).toMatch(TOKEN);
    expect(newToken()).not.toBe(a);
  });
});

describe('where a file comes from', () => {
  it('reads the addresses the catalog has', () => {
    expect(mediaSourceOf(JEM)).toEqual({ kind: 'jem', file: 'AR0020571.mp3' });
    expect(mediaSourceOf(`https://api.rebbehub.org/objects/${'a'.repeat(64)}`)).toEqual({ kind: 'object', sha256: 'a'.repeat(64) });
    expect(mediaSourceOf('https://drive.google.com/file/d/1d6kTkWIB1eAWCe5r7PnjP5nnQiIpOF9i/view')).toEqual({ kind: 'drive', id: '1d6kTkWIB1eAWCe5r7PnjP5nnQiIpOF9i', resourceKey: null });
    expect(mediaSourceOf('https://example.com/a.mp3')).toBeNull();
    expect(mediaSourceOf('https://sichos-kodesh-media-proxy.shmuky.workers.dev/jem-audio/../x.mp3')).toBeNull();
  });

  it("passes JEM's audio on with its part, trying the file's other types", async () => {
    const asked: Array<{ url: string; range: string | null }> = [];
    const send = (async (input: string, init?: RequestInit) => {
      asked.push({ url: input, range: new Headers(init?.headers).get('range') });
      if (input.endsWith('.mp3')) return new Response('missing', { status: 404 });
      return new Response('bytes', { status: 206, headers: { 'content-type': 'audio/mp4', 'content-range': 'bytes 0-4/100', 'set-cookie': 'x=1' } });
    }) as typeof fetch;
    const answer = await showcaseMedia({ kind: 'jem', file: 'AR1.mp3' }, new Request('https://rebbehub.org/show/x/m/0', { headers: { range: 'bytes=0-4' } }), { apiUrl: 'https://api.rebbehub.org', reader: null, fetch: send });
    expect(answer.status).toBe(206);
    expect(answer.headers.get('content-range')).toBe('bytes 0-4/100');
    expect(answer.headers.get('set-cookie')).toBeNull();
    expect(answer.headers.get('cache-control')).toContain('no-store');
    expect(asked.map((a) => a.url)).toEqual(['https://dtgj2yu3gmlic.cloudfront.net/AR1.mp3', 'https://dtgj2yu3gmlic.cloudfront.net/AR1.m4a']);
    expect(asked.every((a) => a.range === 'bytes=0-4')).toBe(true);
  });

  it("plays JEM's audio through the media proxy's binding when the site has it, as the site's player does", async () => {
    const proxied: Array<{ url: string; range: string | null }> = [];
    const media = { fetch: async (r: Request) => (proxied.push({ url: r.url, range: r.headers.get('range') }), new Response('bytes', { status: 206, headers: { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-4/100' } })) };
    const send = (async () => {
      throw new Error('not the CDN');
    }) as typeof fetch;
    const answer = await showcaseMedia({ kind: 'jem', file: 'AR1.mp3' }, new Request('https://rebbehub.org/show/x/m/0', { headers: { range: 'bytes=0-4' } }), { apiUrl: 'https://api.rebbehub.org', reader: null, fetch: send, media });
    expect(answer.status).toBe(206);
    expect(answer.headers.get('cache-control')).toContain('no-store');
    expect(proxied).toEqual([{ url: 'https://media/jem-audio/AR1.mp3', range: 'bytes=0-4' }]);
  });
});

describe('the store', () => {
  it('keeps showcases in the bucket by token, and lists the newest first', async () => {
    const kept = new Map<string, string>();
    const bucket: ShowcaseBucket = {
      get: async (key) => (kept.has(key) ? { text: async () => kept.get(key)! } : null),
      put: async (key, value) => void kept.set(key, value),
      delete: async (key) => void kept.delete(key),
      list: async ({ prefix }) => ({ objects: [...kept.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false }),
    };
    const store = r2Showcases(bucket);
    const one = (t: string, created: string): Showcase => ({ token: t, title: t, note: '', lang: 'he', created, updated: created, farbrengens: [], sichos: [], extras: NO_EXTRAS, media: [], mediaOf: {}, transcripts: [] });
    await store.put(one(token, '2026-10-01'));
    await store.put(one('bbbbbbbbbbbbbbbbbbbb', '2026-10-02'));
    expect([...kept.keys()]).toContain(`showcases/${token}.json`);
    expect((await store.get(token))?.title).toBe(token);
    expect(await store.get('../secret')).toBeNull();
    expect((await store.list()).map((s) => s.token)).toEqual(['bbbbbbbbbbbbbbbbbbbb', token]);
    await store.remove(token);
    expect(await store.get(token)).toBeNull();
  });
});

describe('making one and showing it', () => {
  const webRoot = fileURLToPath(new URL('..', import.meta.url));
  const SITE = 'https://rebbehub.test';
  const store = memoryShowcases();
  const ids: Record<string, EntityId> = {};
  let handle: ReturnType<typeof createSiteHandler>;

  beforeAll(async () => {
    if (!existsSync(`${webRoot}/build/server/index.js`)) execFileSync('npx', ['react-router', 'build'], { cwd: webRoot, stdio: 'ignore' });
    const build = (await import(`${webRoot}/build/server/index.js`)) as ServerBuild;
    const { catalog, set } = await freshCatalog();
    ids.event = await add(catalog, 'mendy', 'keeper', 'event', { kind: 'farbrengen', title: { he: 'התוועדות לדוגמה', en: 'Sample farbrengen' }, date: '5742-05-10', sets: [set] }, '/events/5742-05-10');
    ids.recording = await add(catalog, 'mendy', 'keeper', 'recording', { event: ids.event, title: { he: 'שיחה א׳', en: 'Sicha 1' }, url: JEM, part: 1, durationMs: 60_000 });
    // Its transcript, as the machine wrote it (invented words), the second paragraph timed word by word.
    await catalog.createAccount({ id: 'bot:transcribe', displayName: 'Machine transcription', isBot: true });
    const cs = await catalog.createChangeset('bot:transcribe', { title: 'Transcript' });
    const origin = { by: 'transcribe:fake@1' };
    const text = await catalog.putRevision(cs.id, 'bot:transcribe', { type: 'text', data: { kind: 'transcript', recording: ids.recording, language: 'yi' } as Json });
    const alignment = await catalog.putRevision(cs.id, 'bot:transcribe', { type: 'alignment', data: { recording: ids.recording, text, granularity: 'word' } as Json });
    for (const [i, p] of [
      { content: 'לחיים לחיים', startMs: 0, endMs: 4000, words: undefined },
      { content: 'עס שטייט אין פסוק', startMs: 4000, endMs: 8000, words: [{ from: 0, to: 2, startMs: 4000, endMs: 5000 }] },
    ].entries()) {
      const segment = await catalog.putRevision(cs.id, 'bot:transcribe', { type: 'segment', data: { text, order: `a${i}`, kind: 'paragraph', content: p.content, proofread: i, origin } as Json });
      await catalog.putRevision(cs.id, 'bot:transcribe', { type: 'alignment-span', data: { alignment, segment, startMs: p.startMs, endMs: p.endMs, ...(p.words ? { words: p.words } : {}), origin } as unknown as Json });
    }
    await catalog.submit(cs.id, 'bot:transcribe');
    await catalog.merge(cs.id, 'shmuly');
    ids.other = await add(catalog, 'mendy', 'keeper', 'event', { kind: 'farbrengen', title: { he: 'התוועדות אחרת', en: 'Another farbrengen' }, date: '5742-05-11', sets: [set] }, '/events/5742-05-11');
    const api = createApp({ catalog: new Catalog(catalog.db), reportSalt: 'test' });
    handle = createSiteHandler(build, { apiUrl: 'http://api.test', siteUrl: SITE, fetch: (input, init) => Promise.resolve(api.request(input, init)), showcases: store });
  }, 120_000);

  const DRIVE = 'https://drive.google.com/open?id=1Q9h_YYCSVLm_HbGTqHxYgc_8b2nY2fWD';
  const save = (key?: string) => {
    const form = new FormData();
    for (const [name, value] of Object.entries({ intent: 'save', title: 'פגישה', note: 'For a visit', farbrengens: `${ids.event},not-an-id`, sichos: '', numbers: 'on', [`original:${ids.event}`]: 'https://drive.google.com/file/d/1ThsZGqnrg8DH6ty3bmD6toWc6zaf_nU9/view' })) form.set(name, value);
    form.append('reading', new File([`scan: ${DRIVE}\n## {62}בהעלותך 2)\n### אות א\n⦃א.⦄ איתא בספרי[1] ⟨שמחה⟩\n---\n1) פרשתנו י, י.\n`], 'sicha-33_0062.txt', { type: 'text/plain' }));
    return handle(new Request(`${SITE}/showcase`, { method: 'POST', body: form }), undefined, key);
  };

  it('is made only by whoever opened the lock', async () => {
    expect((await save()).status).toBe(403);
    expect((await handle(new Request(`${SITE}/showcase`))).status).toBe(403);
    expect(await store.list()).toEqual([]);
  });

  it('saves what was picked, with the files a guest may be given, and gives its link', async () => {
    const saved = await save('a-key');
    expect(saved.status).toBe(302);
    const [showcase] = await store.list();
    expect(showcase!.farbrengens).toEqual([ids.event]);
    expect(showcase!.media).toEqual([
      { kind: 'jem', file: 'AR0020571.mp3' },
      { kind: 'drive', id: '1ThsZGqnrg8DH6ty3bmD6toWc6zaf_nU9', resourceKey: null },
      { kind: 'drive', id: '1Q9h_YYCSVLm_HbGTqHxYgc_8b2nY2fWD', resourceKey: null },
    ]);
    expect(showcase!.mediaOf).toEqual({ [ids.recording!]: 0 });
    expect(showcase!.originals).toEqual({ [ids.event!]: 1 });
    expect(showcase!.readings!.map((r) => [r.title, r.media])).toEqual([['בהעלותך ב', 2]]);
    expect(saved.headers.get('location')).toBe(`/showcase?edit=${showcase!.token}&saved=${showcase!.token}`);
    const page = await handle(new Request(`${SITE}${saved.headers.get('location')}`), undefined, 'a-key');
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(`${SITE}/show/${showcase!.token}`);
  });

  it("shows a guest the page, privately, with nothing leading into the rest of the site", async () => {
    const [showcase] = await store.list();
    const page = await handle(new Request(`${SITE}/show/${showcase!.token}`));
    expect(page.status).toBe(200);
    expect(page.headers.get('cache-control')).toContain('no-store');
    expect(page.headers.get('x-robots-tag')).toContain('noindex');
    const html = await page.text();
    expect(html).toContain('פגישה');
    expect(html).toContain('Sample farbrengen');
    expect(html).toContain(`/show/${showcase!.token}/m/0`);
    expect(html).not.toContain('התוועדות אחרת');
    // In English, with the page our reader read, its scan one of the showcase's own files.
    expect(html).toContain('lang="en"');
    expect(html).toContain('Read by our model');
    expect(html).toContain('איתא בספרי');
    expect(html).toContain('Side by side');
    // No menus: the header's links into the private site are not drawn.
    expect(html).not.toContain('href="/search"');
  });

  it("gives a guest the transcripts it lists, and only those", async () => {
    const [showcase] = await store.list();
    expect(showcase!.transcripts).toEqual([ids.recording]);
    const answer = await handle(new Request(`${SITE}/show/${showcase!.token}/t/${ids.recording}`));
    expect(answer.status).toBe(200);
    const transcript = (await answer.json()) as { paragraphs: Array<{ content: string; checked: boolean }>; pending?: unknown };
    expect(transcript.paragraphs.map((p) => [p.content, p.checked])).toEqual([
      ['לחיים לחיים', false],
      ['עס שטייט אין פסוק', true],
    ]);
    expect(transcript.pending).toBeUndefined();
    expect((await handle(new Request(`${SITE}/show/${showcase!.token}/t/${ids.other}`))).status).toBe(404);
    expect((await handle(new Request(`${SITE}/show/zzzzzzzzzzzzzzzzzzzz`))).status).toBe(404);
  });
});
