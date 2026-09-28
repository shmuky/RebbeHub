import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { getFile, recordDerivation, recordPdfPages, registerFile, teshurosSetId, TESHUROS_SET } from '@rebbehub/core';
import { PAGE_HASH_ENCODER, type EntityId } from '@rebbehub/model';
import { createApp } from '../src/app.js';
import { familiesOf, yearFields } from '../src/uploads.js';
import { add, freshCatalog } from '../../../packages/core/tests/helpers.js';

/**
 * Phase 3 over the API: IIIF manifests and page images of served scans,
 * "we already have this" before and after an upload, the three kinds of
 * scan upload, "Map a teshura", and a family's request.
 */

let app: Hono;
let catalog: Awaited<ReturnType<typeof freshCatalog>>['catalog'];
let set: EntityId;
let work: EntityId;
let printing: EntityId;
let scan: EntityId;
let teshuros: EntityId;
const pdf = 'a'.repeat(64);
const hash = (seed: number) => createHash('sha256').update(`page ${seed}`).digest('hex');
let buckets: { public: Map<string, number>; preservation: Map<string, number> };

beforeEach(async () => {
  const fresh = await freshCatalog();
  catalog = fresh.catalog;
  set = fresh.set;
  work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'לקוטי שיחות', en: 'Likkutei Sichos' }, slug: 'likkutei-sichos', authors: [], genre: 'sichos', levels: ['volume', 'sicha'], sets: [set] }, '/likkutei-sichos');
  printing = await add(catalog, 'mendy', 'keeper', 'publication', { kind: 'book-volume', title: { he: 'לקוטי שיחות חלק ד', en: 'Likkutei Sichos 4' }, work, publisher: 'קה"ת', date: '5742', printing: 2, sets: [set] }, '/likkutei-sichos/4/kehot-5742');
  await registerFile(catalog.db, { sha256: pdf, bytes: 5000, mime: 'application/pdf', source: 'contribution', licence: 'cc0', held: true, credit: 'Kehot' });
  scan = await add(catalog, 'mendy', 'keeper', 'scan', { publication: printing, file: pdf, completeness: 'complete', pageLabels: [{ pdfPage: 2, printed: 'א' }] });
  // Two pages with images, measured by the jobs.
  const pages = [];
  for (const page of [1, 2]) {
    const image = createHash('sha256').update(`image ${page}`).digest('hex');
    const thumb = createHash('sha256').update(`thumb ${page}`).digest('hex');
    await recordDerivation(catalog.db, { src: pdf, profile: `page-image/${page}`, sha256: image, bytes: 100, mime: 'image/jpeg', encoder: 'page-images@1' });
    await recordDerivation(catalog.db, { src: pdf, profile: `thumbnail/${page}`, sha256: thumb, bytes: 10, mime: 'image/jpeg', encoder: 'page-images@1' });
    pages.push({ page, widthPt: 300, heightPt: 400, hash: hash(page), image: { sha256: image, width: 1200, height: 1600 }, thumb: { sha256: thumb, width: 240, height: 320 } });
  }
  await recordPdfPages(catalog.db, { sha256: pdf, encoder: PAGE_HASH_ENCODER, pageCount: 2, pages });
  // The Teshuros set, as the rebbehub-sets importer makes it.
  const cs = await catalog.createChangeset('shmuly', { title: 'Teshuros' });
  teshuros = await catalog.putRevision(cs.id, 'shmuly', { id: await teshurosSetId(), type: 'set', path: TESHUROS_SET.path, data: { name: TESHUROS_SET.name, slug: 'teshuros', policy: 'moderated', keepers: ['keeper'] } });
  await catalog.submit(cs.id, 'shmuly');
  await catalog.merge(cs.id, 'shmuly');

  buckets = { public: new Map(), preservation: new Map() };
  const writer = (bucket: Map<string, number>) => ({ put: async (key: string, bytes: ArrayBuffer) => void bucket.set(key, bytes.byteLength) });
  app = createApp({
    catalog,
    authenticate: (c) => c.req.header('X-Test-Account') ?? null,
    filesBaseUrl: 'https://files.test',
    siteUrl: 'https://rebbehub.test',
    reportSalt: 'test',
    reportsPerHour: 3,
    uploads: { public: writer(buckets.public), preservation: writer(buckets.preservation), maxBytes: 1000 },
  });
});

const get = async (path: string) => {
  const response = await app.request(path);
  return { status: response.status, type: response.headers.get('content-type'), body: (await response.json()) as any };
};
const post = async (path: string, body: unknown, as: string | null = 'chaim', headers: Record<string, string> = {}) => {
  const response = await app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(as ? { 'X-Test-Account': as } : {}), ...headers }, body: JSON.stringify(body) });
  return { status: response.status, body: (await response.json()) as any };
};
const upload = async (query: string, bytes: Uint8Array<ArrayBuffer>, as = 'chaim') => {
  const response = await app.request(`/v1/uploads?${query}`, { method: 'POST', headers: { 'Content-Type': 'application/pdf', 'X-Test-Account': as }, body: bytes });
  return { status: response.status, body: (await response.json()) as any };
};

describe('IIIF and page images', () => {
  it('serves a scan as a IIIF Presentation 3 manifest: a canvas per page image, right to left, with its credit and PDF', async () => {
    const { status, type, body } = await get(`/manifests/iiif/${scan}.json`);
    expect(status).toBe(200);
    expect(type).toContain('application/ld+json');
    expect(body).toMatchObject({
      '@context': 'http://iiif.io/api/presentation/3/context.json',
      id: `http://localhost/manifests/iiif/${scan}.json`,
      type: 'Manifest',
      label: { he: ['לקוטי שיחות חלק ד'], en: ['Likkutei Sichos 4'] },
      viewingDirection: 'right-to-left',
      requiredStatement: { value: { none: ['Kehot'] } },
      rendering: [{ id: `https://files.test/objects/${pdf}`, format: 'application/pdf' }],
      homepage: [{ id: 'https://rebbehub.test/likkutei-sichos/4/kehot-5742' }],
    });
    expect(body.items).toHaveLength(2);
    const [first, second] = body.items;
    expect(first).toMatchObject({ type: 'Canvas', width: 1200, height: 1600, label: { none: ['1'] } });
    expect(second.label).toEqual({ none: ['2 (א)'] });
    const annotation = first.items[0].items[0];
    expect(annotation).toMatchObject({ motivation: 'painting', target: first.id, body: { type: 'Image', format: 'image/jpeg', width: 1200, height: 1600 } });
    expect(annotation.body.id).toMatch(/^https:\/\/files\.test\/objects\/[0-9a-f]{64}$/);
    expect(body.metadata).toEqual(expect.arrayContaining([{ label: { he: ['דפוס'], en: ['Printing'] }, value: { none: ['2'] } }]));
  });

  it("lists a scan's pages for the site's viewer, and keeps page images out of the file's own list", async () => {
    const pages = await get(`/v1/scans/${scan}/pages`);
    expect(pages.body.manifest).toBe(`http://localhost/manifests/iiif/${scan}.json`);
    expect(pages.body.pages).toEqual([
      expect.objectContaining({ page: 1, width: 1200, height: 1600, image: expect.stringMatching(/^https:\/\/files\.test\/objects\//), thumbnail: expect.any(String) }),
      expect.objectContaining({ page: 2 }),
    ]);
    const file = await get(`/v1/files/${pdf}`);
    expect(file.body).toMatchObject({ pageImages: 2, derivations: [] });
  });

  it('serves nothing of a scan whose rights keep it private, and follows a takedown', async () => {
    await catalog.db.query("UPDATE account SET is_steward = TRUE WHERE id = 'shmuly'");
    const { setRights } = await import('@rebbehub/core');
    await setRights(catalog.db, 'shmuly', pdf, 'preserved', 'test takedown');
    expect((await get(`/manifests/iiif/${scan}.json`)).status).toBe(404);
    expect((await get(`/v1/scans/${scan}/pages`)).status).toBe(404);
  });

  it('keeps the published manifests beside it', async () => {
    expect((await get('/manifests/reading-copies/sichos-kodesh.json')).status).toBe(404);
  });
});

describe('what an upload is, before and after', () => {
  it('says we already have the very file, or the same pages, and where', async () => {
    const same = await post('/v1/uploads/check', { for: work, sha256: pdf });
    expect(same.body.proposal).toMatchObject({ as: 'existing', usedBy: [{ id: scan, type: 'scan' }] });
    const pages = await post('/v1/uploads/check', { for: work, pageHashes: [hash(1), hash(2)] });
    expect(pages.body.proposal).toEqual({ as: 'duplicate', reason: 'same-pages', scan, publication: printing, matched: 2, of: 2 });
    expect(pages.body.machine).toBe(true);
    expect(pages.body.publications).toEqual([expect.objectContaining({ id: printing, publisher: 'קה"ת', printing: 2 })]);
  });

  it('guesses a scan of a printing by its year, a teshura on the Teshuros set, else a new printing', async () => {
    expect((await post('/v1/uploads/check', { for: work, title: 'לקוטי שיחות ד תשמ"ב' })).body.proposal).toEqual({ as: 'scan-of', reason: 'same-year', publication: printing });
    expect((await post('/v1/uploads/check', { for: teshuros })).body.proposal).toMatchObject({ as: 'teshura' });
    expect((await post('/v1/uploads/check', { for: work, title: 'דפוס חדש' })).body.proposal).toEqual({ as: 'printing', reason: 'new' });
    expect((await post('/v1/uploads/check', { for: work }, null)).status).toBe(401);
  });

  it('adds another scan of a printing', async () => {
    const sent = await upload(`what=scan&for=${work}&as=scan-of&publication=${printing}&rights=mine`, new Uint8Array([37, 80, 68, 70, 1]));
    expect(sent.body).toMatchObject({ as: 'scan-of', rights: 'open' });
    const review = await catalog.review(sent.body.suggestion);
    expect(review.entries).toEqual([expect.objectContaining({ type: 'scan', after: expect.objectContaining({ publication: printing, file: sent.body.sha256 }) })]);
  });

  it('adds a new printing with its publisher, year and number', async () => {
    const sent = await upload(`what=scan&for=${work}&as=printing&rights=public-domain&title=${encodeURIComponent('לקוטי שיחות ד')}&publisher=${encodeURIComponent('קה"ת')}&year=${encodeURIComponent('תשנ"ב')}&printing=3`, new Uint8Array([37, 80, 68, 70, 2]));
    const review = await catalog.review(sent.body.suggestion);
    expect(review.entries.find((e) => e.type === 'publication')?.after).toMatchObject({ kind: 'book-volume', work, publisher: 'קה"ת', date: '5752', printing: 3, sets: [set] });
  });

  it('adds a new teshura to the Teshuros set, served with credit to its families even when the uploader is unsure', async () => {
    const sent = await upload(`what=scan&for=${teshuros}&rights=unsure&families=${encodeURIComponent('כהן, לוי')}&date=5784-03-15`, new Uint8Array([37, 80, 68, 70, 3]));
    expect(sent.body).toMatchObject({ as: 'teshura', rights: 'credit', served: true });
    expect(await getFile(catalog.db, sent.body.sha256)).toMatchObject({ credit: 'משפחות כהן – לוי' });
    const review = await catalog.review(sent.body.suggestion);
    expect(review.entries.find((e) => e.type === 'publication')?.after).toMatchObject({ kind: 'teshura', title: { he: 'תשורה – כהן – לוי' }, simcha: { kind: 'wedding', families: ['כהן', 'לוי'], date: '5784-03-15' }, sets: [teshuros] });
    expect((await upload(`what=scan&for=${teshuros}&rights=mine`, new Uint8Array([37, 80, 68, 70, 4]))).status).toBe(400); // no families
  });

  it('reads years and families as people type them', () => {
    expect(yearFields('תשמ"ב')).toEqual({ date: '5742' });
    expect(yearFields('1982')).toEqual({ gregorianYear: 1982 });
    expect(yearFields('5742')).toEqual({ date: '5742' });
    expect(familiesOf('כהן – לוי')).toEqual(['כהן', 'לוי']);
    expect(familiesOf('Cohen, Levi')).toEqual(['Cohen', 'Levi']);
  });

  it('tells what a held file looks like, once measured', async () => {
    const other = 'b'.repeat(64);
    await registerFile(catalog.db, { sha256: other, bytes: 10, mime: 'application/pdf', source: 'contribution', licence: 'unknown', held: true });
    await recordPdfPages(catalog.db, { sha256: other, encoder: PAGE_HASH_ENCODER, pageCount: 2, pages: [1, 2].map((page) => ({ page, widthPt: 300, heightPt: 400, hash: hash(page) })) });
    const similar = await get(`/v1/files/${other}/similar`);
    expect(similar.body).toMatchObject({ machine: true, similar: [{ sha256: pdf, kind: 'same', matched: 2, of: 2, items: [{ id: scan, type: 'scan', publication: printing }] }] });
  });
});

describe('contents maps and family requests', () => {
  it('maps a teshura\'s pages to a new unit of a sefer, through a suggestion', async () => {
    const teshura = await add(catalog, 'mendy', 'keeper', 'publication', { kind: 'teshura', title: { he: 'תשורה' }, simcha: { kind: 'wedding', families: ['כהן'] }, sets: [teshuros] });
    const sent = await post('/v1/suggestions/contents-map', { publication: teshura, pages: { from: 3, to: 8, scheme: 'printed' }, newUnit: { work, label: { he: 'מכתב מתשי"ח' }, date: '5718' } });
    expect(sent.status).toBe(201);
    const review = await catalog.review(sent.body.suggestion);
    expect(review.entries.map((e) => e.type).sort()).toEqual(['contents-map', 'unit']);
    expect((await post('/v1/suggestions/contents-map', { publication: teshura, pages: { from: 3, to: 8, scheme: 'printed' } })).status).toBe(422);
    expect((await post('/v1/suggestions/contents-map', { publication: teshura, pages: { from: 3, to: 8, scheme: 'printed' }, label: { he: 'x' } }, null)).status).toBe(401);
  });

  it("takes a family's request with no account: the teshura's scans stop at once, and the stewards have a Report", async () => {
    const file = 'c'.repeat(64);
    await registerFile(catalog.db, { sha256: file, bytes: 10, mime: 'application/pdf', source: 'contribution', licence: 'unknown', fileClass: 'teshura-scan', held: true });
    const teshura = await add(catalog, 'mendy', 'keeper', 'publication', { kind: 'teshura', title: { he: 'תשורה' }, simcha: { kind: 'wedding', families: ['כהן'] }, sets: [teshuros] });
    await add(catalog, 'mendy', 'keeper', 'scan', { publication: teshura, file, completeness: 'complete' });
    const sent = await post(`/v1/teshuros/${teshura}/family-request`, { relation: 'the chosson', note: 'please', contact: 'x@y' }, null, { 'X-Forwarded-For': '1.2.3.4' });
    expect(sent).toMatchObject({ status: 201, body: { paused: 1 } });
    expect((await get(`/v1/files/${file}`)).body).toMatchObject({ rights: 'preserved', url: null });
    // Only on teshuros, and rate-limited like reports.
    expect((await post(`/v1/teshuros/${printing}/family-request`, {}, null, { 'X-Forwarded-For': '1.2.3.4' })).status).toBe(404);
    await post(`/v1/teshuros/${teshura}/family-request`, {}, null, { 'X-Forwarded-For': '1.2.3.4' });
    await post(`/v1/teshuros/${teshura}/family-request`, {}, null, { 'X-Forwarded-For': '1.2.3.4' });
    expect((await post(`/v1/teshuros/${teshura}/family-request`, {}, null, { 'X-Forwarded-For': '1.2.3.4' })).status).toBe(429);
  });
});
