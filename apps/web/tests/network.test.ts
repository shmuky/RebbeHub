import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ServerBuild } from 'react-router';
import { EMBEDDING_DIMENSIONS, embedItems, registerFile, type Embedder } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';
import { createApp } from '../../../services/api/src/app.js';
import { add, freshCatalog } from '../../../packages/core/tests/helpers.js';
import { createSiteHandler } from '../server/handler.js';

/**
 * Phase 6 on the built site: search that lands on the moment and by
 * meaning, an item's links, and the health page. The words are invented
 * for the test.
 */

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://rebbehub.test';
const ids: Record<string, EntityId> = {};
let handle: (request: Request) => Promise<Response>;
let withMeaning: (request: Request) => Promise<Response>;

const fake: Embedder = {
  model: '@cf/baai/bge-m3',
  async embed(texts) {
    return texts.map((t) => {
      const v = new Array(EMBEDDING_DIMENSIONS).fill(0);
      for (const word of t.split(/\s+/)) v[[...word].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % EMBEDDING_DIMENSIONS, 7)] += 1;
      return v;
    });
  },
};

beforeAll(async () => {
  if (!existsSync(`${webRoot}/build/server/index.js`)) execFileSync('npx', ['react-router', 'build'], { cwd: webRoot, stdio: 'ignore' });
  const build = (await import(`${webRoot}/build/server/index.js`)) as ServerBuild;
  const { catalog, set } = await freshCatalog();
  ids.event = await add(catalog, 'mendy', 'keeper', 'event', { kind: 'farbrengen', title: { he: 'התוועדות לדוגמה' }, date: '5742-05-10', sets: [set] }, '/events/5742-05-10');
  ids.other = await add(catalog, 'mendy', 'keeper', 'event', { kind: 'farbrengen', title: { he: 'התוועדות אחרת' }, date: '5743-05-10', sets: [set] }, '/events/5743-05-10');
  await add(catalog, 'mendy', 'keeper', 'relation', { kind: 'based-on', from: ids.other, to: ids.event, note: 'משיחת יו״ד שבט תשמ״ב', origin: { by: 'citations@1' } });

  ids.recording = await add(catalog, 'mendy', 'keeper', 'recording', { event: ids.event, title: { he: 'הקלטה א' }, url: 'https://example.org/a.mp3' });
  ids.transcript = await add(catalog, 'mendy', 'keeper', 'text', { kind: 'transcript', recording: ids.recording, language: 'yi' });
  ids.para = await add(catalog, 'mendy', 'keeper', 'segment', { text: ids.transcript, order: 'V', kind: 'paragraph', content: 'דוגמה פון א ניגון', proofread: 0, origin: { by: 'transcribe:fake@1' } });
  const alignment = await add(catalog, 'mendy', 'keeper', 'alignment', { recording: ids.recording, text: ids.transcript, granularity: 'paragraph' });
  await add(catalog, 'mendy', 'keeper', 'alignment-span', { alignment, segment: ids.para, startMs: 125_000, endMs: 140_000 });

  await registerFile(catalog.db, { sha256: 'c'.repeat(64), bytes: 10, mime: 'application/pdf', source: 'contribution', licence: 'cc0', held: true });
  ids.publication = await add(catalog, 'mendy', 'keeper', 'publication', { kind: 'booklet', title: { he: 'קונטרס לדוגמה' }, sets: [set] });
  ids.scan = await add(catalog, 'mendy', 'keeper', 'scan', { publication: ids.publication, file: 'c'.repeat(64), completeness: 'complete' });
  const layer = await add(catalog, 'mendy', 'keeper', 'text-layer', { scan: ids.scan, kind: 'machine-ocr', engine: { name: 'fake', version: '1' } });
  await add(catalog, 'mendy', 'keeper', 'text-page', { layer, page: 4, proofread: 0, lines: [{ id: 'l1', text: 'כותרת' }, { id: 'l2', text: 'שורה של ניגון שמח' }] });

  handle = createSiteHandler(build, { apiUrl: 'http://api.test', siteUrl: SITE, fetch: (input, init) => Promise.resolve(createApp({ catalog }).request(input, init)) });
  await embedItems(catalog, fake);
  withMeaning = createSiteHandler(build, { apiUrl: 'http://api.test', siteUrl: SITE, fetch: (input, init) => Promise.resolve(createApp({ catalog, embedder: fake }).request(input, init)) });
}, 120_000);

const get = async (path: string, handler = () => handle) => {
  const response = await handler()(new Request(`${SITE}${path}`));
  return { status: response.status, html: await response.text() };
};

describe('phase 6 on the site', () => {
  it('finds words inside the texts and opens each at its moment, marked as machine output', async () => {
    const page = await get(`/search?q=${encodeURIComponent('ניגון')}`);
    expect(page.status).toBe(200);
    expect(page.html).toContain('בתוך הטקסטים');
    expect(page.html).toContain(`href="/text/${ids.scan}?page=4&amp;line=l2#line-l2"`);
    expect(page.html).toContain(`href="/events/5742-05-10?at=${ids.para}#p-${ids.para}"`);
    expect(page.html).toContain('<mark>ניגון</mark>');
    expect(page.html).toContain('נשמע ב־2:05');
    expect(page.html).toContain('תמלול מכונה, לא נבדק');
    // Search by meaning is not offered until it is set up.
    expect(page.html).not.toContain('לפי רעיון');
  });

  it('lights up the line a search found', async () => {
    const page = await get(`/text/${ids.scan}?page=4&line=l2`);
    expect(page.html).toContain('id="line-l2"');
    expect(page.html).toMatch(/class="text-line level-0 unchecked found"[^>]*>.*<mark>שורה של ניגון שמח<\/mark>/s);
  });

  it('searches by idea where it is set up, and says the machine chose', async () => {
    const page = await get(`/search?by=meaning&q=${encodeURIComponent('ניגון שמח')}`, () => withMeaning);
    expect(page.html).toContain('לפי רעיון');
    expect(page.html).toContain('נבחרו במכונה');
    expect(page.html).toContain('נמצא במכונה');
  });

  it('shows an item’s links both ways, marked when a machine found them', async () => {
    const page = await get('/events/5742-05-10');
    expect(page.html).toContain('מה שמיוסד על זה');
    expect(page.html).toContain('href="/events/5743-05-10"');
    expect(page.html).toContain('נמצא במכונה');
    const other = await get('/events/5743-05-10?lang=en');
    expect(other.html).toContain('Based on this farbrengen');
  });

  it('shows the health of the catalog', async () => {
    const page = await get('/health?lang=en');
    expect(page.status).toBe(200);
    expect(page.html).toContain('Health of the catalog');
    expect(page.html).toContain('class="health-table"');
    expect(page.html).toContain('Recordings not synced');
    expect(page.html).toContain('The links have not been checked yet.');
  });
});
