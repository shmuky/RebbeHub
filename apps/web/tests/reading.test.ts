import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ServerBuild } from 'react-router';
import type { EntityId } from '@rebbehub/model';
import { createApp } from '../../../services/api/src/app.js';
import { add, freshCatalog } from '../../../packages/core/tests/helpers.js';
import { createSiteHandler } from '../server/handler.js';
import { mergePlaces, resumeFrom, type Place } from '../app/lib/places.js';
import { chooseText } from '../app/lib/texts.js';
import { parsePdfLook, pdfCssFilter, resolvedColors } from '../app/reader/look.js';

/**
 * Reading: the reader's page colours and places, the player's resume,
 * translations on a unit's page, the mirrors page and the installable app.
 * The texts here are invented for the test.
 */

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://rebbehub.test';
let handle: (request: Request) => Promise<Response>;
const ids: Record<string, EntityId> = {};

beforeAll(async () => {
  if (!existsSync(`${webRoot}/build/server/index.js`)) execFileSync('npx', ['react-router', 'build'], { cwd: webRoot, stdio: 'ignore' });
  const build = (await import(`${webRoot}/build/server/index.js`)) as ServerBuild;
  const { catalog, set } = await freshCatalog();
  ids.work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'ספר לדוגמה', en: 'Sample Sefer' }, slug: 'sample', authors: [], genre: 'sichos', levels: ['sicha'], sets: [set] }, '/sample');
  ids.unit = await add(catalog, 'mendy', 'keeper', 'unit', { work: ids.work, position: [{ level: 'sicha', value: '1' }], order: 'V', label: { he: 'שיחה לדוגמה', en: 'Sample sicha' } }, '/sample/1');
  ids.text = await add(catalog, 'mendy', 'keeper', 'text', { kind: 'edition', unit: ids.unit, language: 'he' });
  await add(catalog, 'mendy', 'keeper', 'segment', { text: ids.text, order: 'V', kind: 'paragraph', content: 'פסקה במקור', proofread: 1 });
  ids.translation = await add(catalog, 'mendy', 'shmuly', 'text', { kind: 'translation', unit: ids.unit, language: 'en', translationOf: ids.text, credit: 'Translated by a test' });
  await add(catalog, 'mendy', 'shmuly', 'segment', { text: ids.translation, order: 'V', kind: 'paragraph', content: 'A paragraph in English', proofread: 0, origin: { by: 'mt:test@1', checked: false } });
  const { tag, commit } = await catalog.tagEdition('shmuly', { tag: '2026.40' });
  await catalog.setEditionManifest(tag, { tag, commit, createdAt: '2026-09-28T12:00:00.000Z', files: [{ name: 'rebbehub-2026.40.sqlite', bytes: 2048, sha256: 'c'.repeat(64) }], signature: { alg: 'ed25519', keyId: '0123456789abcdef', sig: 'x' } });
  const api = createApp({ catalog, mirrors: { gitUrls: ['https://github.com/rebbehub/catalog.git'] } });
  handle = createSiteHandler(build, { apiUrl: 'http://api.test', siteUrl: SITE, fetch: (input, init) => Promise.resolve(api.request(input, init)) });
}, 120_000);

const get = async (path: string) => {
  const response = await handle(new Request(`${SITE}${path}`));
  return { status: response.status, html: await response.text() };
};

describe('translations on a unit page', () => {
  it('shows the original, with a link to each language', async () => {
    const page = await get('/sample/1');
    expect(page.html).toContain('</a>פסקה במקור');
    expect(page.html).not.toContain('</a>A paragraph in English');
    expect(page.html).toContain('href="/sample/1?tl=en"');
    expect(page.html).toContain('הוספת תרגום'); // Add a translation
  });

  it('shows a translation with its credit, labelled as a machine translation while unchecked', async () => {
    const page = await get('/sample/1?tl=en&lang=en');
    expect(page.html).toContain('</a>A paragraph in English');
    expect(page.html).toContain('Translated by a test');
    expect(page.html).toContain('Machine translation, not yet checked by a person');
    expect(page.html).toContain('lang="en" dir="ltr"');
    expect(page.html).not.toContain('</a>פסקה במקור');
  });

  it('picks the text the address asks for, else the original', () => {
    const texts = [{ id: 't', data: { kind: 'translation', language: 'en' } }, { id: 'o', data: { kind: 'edition', language: 'he' } }] as never[];
    expect((chooseText(texts, null) as { id: string }).id).toBe('o');
    expect((chooseText(texts, 'en') as { id: string }).id).toBe('t');
    expect((chooseText(texts, 'fr') as { id: string }).id).toBe('o');
  });
});

describe('download and mirror', () => {
  it('lists the git mirror and every edition with its files, sizes, checksums and key', async () => {
    const page = await get('/mirrors?lang=en');
    expect(page.status).toBe(200);
    expect(page.html).toContain('git clone https://github.com/rebbehub/catalog.git');
    expect(page.html).toContain('rebbehub-2026.40.sqlite');
    expect(page.html).toContain(`sha256 ${'c'.repeat(64)}`);
    expect(page.html).toContain('signed with key 0123456789abcdef');
    expect(page.html).toContain('http://api.test/v1/editions/2026.40/SHA256SUMS');
    expect(page.html).toContain('mirror-pull');
  });
});

describe('the installable app', () => {
  it('links its manifest, whose icons exist, and ships a service worker with an offline page', async () => {
    const page = await get('/');
    expect(page.html).toContain('rel="manifest" href="/manifest.webmanifest"');
    const manifest = JSON.parse(readFileSync(`${webRoot}/public/manifest.webmanifest`, 'utf8')) as { icons: Array<{ src: string; sizes: string }>; display: string; start_url: string };
    expect(manifest.display).toBe('standalone');
    for (const icon of manifest.icons) expect(existsSync(`${webRoot}/public${icon.src}`)).toBe(true);
    expect(manifest.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    const sw = readFileSync(`${webRoot}/public/sw.js`, 'utf8');
    expect(sw).toContain("'/offline.html'");
    expect(sw).toContain("url.pathname.startsWith('/_/')"); // nothing personal is kept
    expect(existsSync(`${webRoot}/public/offline.html`)).toBe(true);
  });
});

describe('the reader and the player', () => {
  it("draw pages dark, sepia, grey or as scanned, with Sichos-Kodesh's filters", () => {
    expect(parsePdfLook('{"colors":"sepia","contrast":true}')).toEqual({ colors: 'sepia', contrast: true });
    expect(parsePdfLook('not json')).toEqual({ colors: 'auto', contrast: false });
    expect(parsePdfLook('{"colors":"purple"}').colors).toBe('auto');
    expect(resolvedColors('auto', true)).toBe('dark');
    expect(resolvedColors('auto', false)).toBe('original');
    expect(pdfCssFilter('dark', false)).toBe('invert(1) hue-rotate(180deg)');
    expect(pdfCssFilter('sepia', true)).toBe('sepia(0.45) brightness(0.97) contrast(1.35)');
    expect(pdfCssFilter('original', false)).toBe('none');
  });

  it('keep the later place of two, one per thing', () => {
    const place = (key: string, at: string, page: number): Place => ({ kind: 'read', key, title: key, href: '/read', place: { page }, updatedAt: at });
    const merged = mergePlaces([place('a', '2026-09-01', 3), place('b', '2026-09-03', 1)], [place('a', '2026-09-02', 9)]);
    expect(merged.map((p) => [p.key, p.place.page])).toEqual([
      ['b', 1],
      ['a', 9],
    ]);
  });

  it('play on from where a farbrengen was stopped, the next part once one was heard to its end', () => {
    const track = (id: string) => ({ id, title: id, subtitle: 'התוועדות', url: `https://x/${id}`, href: '/events/5742-05-10' });
    const queue = [track('r1'), track('r2')];
    const saved = (index: number, time: number, duration = 3600, q = queue) => ({ place: { queue: q, index, time, duration } });
    expect(resumeFrom(queue, saved(1, 600))).toEqual({ index: 1, time: 600 });
    expect(resumeFrom(queue, saved(0, 3590))).toEqual({ index: 1, time: 0 });
    expect(resumeFrom(queue, saved(1, 3590))).toBeNull(); // all heard
    expect(resumeFrom(queue, saved(0, 4))).toBeNull(); // barely begun
    expect(resumeFrom(queue, saved(0, 600, 3600, [track('other')]))).toBeNull(); // another queue
    expect(resumeFrom(queue, null)).toBeNull();
  });
});
