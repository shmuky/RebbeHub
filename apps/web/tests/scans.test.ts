import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ServerBuild } from 'react-router';
import { getFile, recordDerivation, recordPdfPages, registerFile, teshurosSetId, TESHUROS_SET } from '@rebbehub/core';
import { PAGE_HASH_ENCODER, type EntityId } from '@rebbehub/model';
import { createApp } from '../../../services/api/src/app.js';
import { add, freshCatalog } from '../../../packages/core/tests/helpers.js';
import { createSiteHandler } from '../server/handler.js';

/**
 * The site's scans-and-files pages, rendered as in production over a small
 * made-up catalog: page images and IIIF, a sefer's printings, the
 * Teshuros set, the forms for mapping pages and a family's request.
 */

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://rebbehub.test';
let handle: (request: Request) => Promise<Response>;
const ids: Record<string, EntityId> = {};
const pdf = 'd'.repeat(64);
const teshuraPdf = 'e'.repeat(64);
let catalog: Awaited<ReturnType<typeof freshCatalog>>['catalog'];

beforeAll(async () => {
  if (!existsSync(`${webRoot}/build/server/index.js`)) execFileSync('npx', ['react-router', 'build'], { cwd: webRoot, stdio: 'ignore' });
  const build = (await import(`${webRoot}/build/server/index.js`)) as ServerBuild;
  const fresh = await freshCatalog();
  catalog = fresh.catalog;
  const set = fresh.set;
  ids.work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'ספר הדפוסים', en: 'Book of printings' }, slug: 'printings-sample', authors: [], genre: 'sichos', levels: ['sicha'], sets: [set] }, '/printings-sample');
  ids.later = await add(catalog, 'mendy', 'keeper', 'publication', { kind: 'book-volume', title: { he: 'דפוס שני' }, work: ids.work, publisher: 'קה"ת', date: '5752', printing: 2, sets: [set] });
  ids.first = await add(catalog, 'mendy', 'keeper', 'publication', { kind: 'book-volume', title: { he: 'דפוס ראשון' }, work: ids.work, publisher: 'קה"ת', date: '5742', printing: 1, sets: [set] });
  await registerFile(catalog.db, { sha256: pdf, bytes: 5000, mime: 'application/pdf', source: 'contribution', licence: 'cc0', held: true });
  ids.scan = await add(catalog, 'mendy', 'keeper', 'scan', { publication: ids.first, file: pdf, completeness: 'complete' });
  const pages = [];
  for (const page of [1, 2, 3]) {
    const image = createHash('sha256').update(`image ${page}`).digest('hex');
    const thumb = createHash('sha256').update(`thumb ${page}`).digest('hex');
    await recordDerivation(catalog.db, { src: pdf, profile: `page-image/${page}`, sha256: image, bytes: 100, mime: 'image/jpeg', encoder: 'page-images@1' });
    await recordDerivation(catalog.db, { src: pdf, profile: `thumbnail/${page}`, sha256: thumb, bytes: 10, mime: 'image/jpeg', encoder: 'page-images@1' });
    pages.push({ page, widthPt: 300, heightPt: 400, hash: null, image: { sha256: image, width: 1200, height: 1600 }, thumb: { sha256: thumb, width: 240, height: 320 } });
  }
  await recordPdfPages(catalog.db, { sha256: pdf, encoder: PAGE_HASH_ENCODER, pageCount: 3, pages });

  const cs = await catalog.createChangeset('shmuly', { title: 'Teshuros' });
  ids.teshuros = await catalog.putRevision(cs.id, 'shmuly', { id: await teshurosSetId(), type: 'set', path: TESHUROS_SET.path, data: { name: TESHUROS_SET.name, slug: 'teshuros', description: TESHUROS_SET.description, policy: 'moderated', keepers: ['keeper'] } });
  await catalog.submit(cs.id, 'shmuly');
  await catalog.merge(cs.id, 'shmuly');
  await registerFile(catalog.db, { sha256: teshuraPdf, bytes: 500, mime: 'application/pdf', source: 'contribution', licence: 'unknown', fileClass: 'teshura-scan', held: true, credit: 'משפחות כהן – לוי' });
  ids.teshura = await add(catalog, 'mendy', 'keeper', 'publication', { kind: 'teshura', title: { he: 'תשורה משמחת כהן–לוי' }, simcha: { kind: 'wedding', families: ['כהן', 'לוי'] }, sets: [ids.teshuros] });
  await add(catalog, 'mendy', 'keeper', 'scan', { publication: ids.teshura, file: teshuraPdf, completeness: 'complete' });

  const api = createApp({ catalog, reportSalt: 'test', filesBaseUrl: 'https://files.rebbehub.test', siteUrl: SITE });
  handle = createSiteHandler(build, { apiUrl: 'http://api.test', siteUrl: SITE, fetch: (input, init) => Promise.resolve(api.request(input, init)) });
}, 120_000);

const get = async (path: string) => {
  const response = await handle(new Request(`${SITE}${path}`));
  return { status: response.status, html: await response.text(), type: response.headers.get('content-type') };
};

describe('scans and printings on the site', () => {
  it("shows a scan's page images, a strip of its pages and its IIIF manifest", async () => {
    const page = await get(`/${ids.first}`);
    expect(page.status).toBe(200);
    expect(page.html).toContain('class="scan-page"');
    expect(page.html).toContain(`https://files.rebbehub.test/objects/${createHash('sha256').update('image 1').digest('hex')}`);
    expect(page.html).toContain('class="scan-thumbs"');
    expect(page.html).toContain(`/manifests/iiif/${ids.scan}.json`);
    // The sefer's other printing, and the forms for adding a scan and mapping pages.
    expect(page.html).toContain('דפוס שני');
    expect(page.html).toContain('id="map-pages"');
    expect(page.html).toContain('id="upload"');
  });

  it("lists a sefer's printings in the order they came out, with their scans", async () => {
    const page = await get('/printings-sample?tab=printings');
    expect(page.html).toContain('class="printings"');
    expect(page.html.indexOf('דפוס ראשון')).toBeLessThan(page.html.indexOf('דפוס שני'));
    expect(page.html).toContain('אין סריקה עדיין'); // the second printing
  });

  it('offers the Teshuros set a new teshura, and a teshura a family request', async () => {
    const set = await get('/teshuros');
    expect(set.html).toContain('הוספת תשורה');
    const teshura = await get(`/${ids.teshura}`);
    expect(teshura.html).toContain('id="family-request"');
    expect(teshura.html).toContain('© משפחות כהן – לוי');
  });

  it("takes a family's request without JavaScript, and the scan stops being shown", async () => {
    const body = new URLSearchParams({ intent: 'family-request', teshura: ids.teshura!, relation: 'אבי הכלה', note: 'נא להסיר' });
    const response = await handle(new Request(`${SITE}/${ids.teshura}`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '10.0.0.9' } }));
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('הבקשה התקבלה');
    expect(html).not.toContain('הדיווח לא נשלח');
    expect((await getFile(catalog.db, teshuraPdf))?.rights_state).toBe('preserved');
    expect((await get(`/${ids.teshura}`)).html).toContain('מוצגת באתר המקור בלבד');
  });

  it('looks items up by name for the forms', async () => {
    const response = await handle(new Request(`${SITE}/_/lookup?q=${encodeURIComponent('ספר הדפוסים')}&type=work`));
    expect(((await response.json()) as { items: Array<{ id: string }> }).items.map((i) => i.id)).toContain(ids.work);
  });
});
