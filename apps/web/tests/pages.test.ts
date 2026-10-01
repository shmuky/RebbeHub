import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ServerBuild } from 'react-router';
import { recordCover, registerFile } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';
import { createApp } from '../../../services/api/src/app.js';
import { add, freshCatalog, yudShvat } from '../../../packages/core/tests/helpers.js';
import { createSiteHandler } from '../server/handler.js';

/**
 * Every item's own page, rendered as in production over a small made-up
 * catalog: a sefer's cover from its title page, all that belongs to an
 * item counted and listed a page at a time, a recording's and a file's own
 * pages, and the guided "Add something new".
 */

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://rebbehub.test';
let handle: (request: Request) => Promise<Response>;
const ids: Record<string, EntityId> = {};
const sha = (c: string) => c.repeat(64);

beforeAll(async () => {
  if (!existsSync(`${webRoot}/build/server/index.js`)) execFileSync('npx', ['react-router', 'build'], { cwd: webRoot, stdio: 'ignore' });
  const build = (await import(`${webRoot}/build/server/index.js`)) as ServerBuild;
  const { catalog, set } = await freshCatalog();
  ids.set = set;
  ids.work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'ספר השער' }, slug: 'shaar-sample', authors: [], genre: 'sichos', levels: ['sicha'], sets: [set] }, '/shaar-sample');
  ids.pub = await add(catalog, 'mendy', 'keeper', 'publication', { kind: 'book-volume', title: { he: 'דפוס' }, work: ids.work, sets: [set] });
  await registerFile(catalog.db, { sha256: sha('a'), bytes: 5000, mime: 'application/pdf', source: 'contribution', licence: 'cc0', held: true });
  ids.scan = await add(catalog, 'mendy', 'keeper', 'scan', { publication: ids.pub, file: sha('a'), completeness: 'complete' });
  const picture = (c: string) => ({ sha256: sha(c), bytes: 5, width: 480, height: 672 });
  await recordCover(catalog.db, { entity: ids.work, src: sha('a'), page: 2, chosenBy: 'machine', score: 4, reasons: ['sparse'], image: picture('b'), thumb: picture('c') });
  for (let i = 0; i < 3; i++) ids[`unit${i + 1}`] = await add(catalog, 'mendy', 'keeper', 'unit', { work: ids.work, position: [{ level: 'sicha', value: String(i + 1) }], order: `a${i}`, label: { he: `שיחה ${i + 1}` } });

  ids.event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set), '/events/5742-05-10');
  await registerFile(catalog.db, { sha256: sha('d'), bytes: 900, mime: 'audio/mpeg', source: 'jem', licence: 'unknown', fileClass: 'recording', held: true });
  ids.rec1 = await add(catalog, 'mendy', 'keeper', 'recording', { event: ids.event, title: { he: 'חלק א' }, part: 1, file: sha('d'), durationMs: 3_725_000, sources: [{ source: 'jem', sourceId: '12345', url: 'https://www.chabad.org/multimedia/media_cdo/aid/12345' }] });
  ids.rec2 = await add(catalog, 'mendy', 'keeper', 'recording', { event: ids.event, title: { he: 'חלק ב' }, part: 2 });
  // An addition to the sefer (a commentary on it), and one that belongs to no sefer, both on the sefer's shelf.
  ids.biur = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'ביאור לספר השער' }, slug: 'biur-sample', authors: [], genre: 'sichos', levels: [], sets: [set], addition: { kind: 'commentary', to: ids.work } }, '/biur-sample');
  ids.likkut = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'ליקוט לדוגמה' }, slug: 'likkut-sample', authors: [], genre: 'sichos', levels: [], sets: [set], addition: { kind: 'collection' } }, '/likkut-sample');
  ids.tanya = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'תניא' }, slug: 'tanya-sample', authors: [], genre: 'chassidus', levels: [], sets: [set] }, '/tanya-sample');
  ids.tanyaIndex = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'תניא - מפתח' }, slug: 'tanya-index-sample', authors: [], genre: 'chassidus', levels: [], sets: [set], addition: { kind: 'index', to: ids.tanya } }, '/tanya-index-sample');
  ids.person = await add(catalog, 'mendy', 'keeper', 'person', { name: { he: 'ר׳ יואל כהן' }, externalIds: { wikidata: 'Q1' }, sets: [set] });

  const api = createApp({ catalog, reportSalt: 'test', filesBaseUrl: 'https://files.rebbehub.test', siteUrl: SITE });
  handle = createSiteHandler(build, { apiUrl: 'http://api.test', siteUrl: SITE, fetch: (input, init) => Promise.resolve(api.request(input, init)) });
}, 120_000);

const get = async (path: string) => {
  const response = await handle(new Request(`${SITE}${path}`));
  return { status: response.status, html: await response.text() };
};

describe("every item's own page", () => {
  it("shows a sefer's title page as its cover, where it came from, and lets a keeper choose another", async () => {
    const page = await get('/shaar-sample');
    expect(page.status).toBe(200);
    expect(page.html).toContain(`https://files.rebbehub.test/objects/${sha('b')}`);
    expect(page.html).toContain('class="shaar-img"');
    expect(page.html).toContain('נבחר על ידי מחשב');
    expect(page.html).toContain('id="cover"');
    // The set's shelf shows the cover's thumbnail.
    const moved = await handle(new Request(`${SITE}/${ids.set}`));
    const shelf = await get(new URL(moved.headers.get('location') ?? `/${ids.set}`, SITE).pathname);
    expect(shelf.status).toBe(200);
    expect(shelf.html).toContain(`https://files.rebbehub.test/objects/${sha('c')}`);
  });

  it("lists a sefer's additions on its page, not on its shelf, and leads from an addition back to its sefer", async () => {
    const sefer = (await get('/shaar-sample')).html;
    expect(sefer).toContain('הוספות');
    expect(sefer).toMatch(/ביאורים.*?href="\/biur-sample".*?ביאור לספר השער/s);
    const moved = await handle(new Request(`${SITE}/${ids.set}`));
    const shelf = (await get(new URL(moved.headers.get('location') ?? `/${ids.set}`, SITE).pathname)).html;
    expect(shelf).not.toContain('ביאור לספר השער');
    // The addition that belongs to no sefer is apart, closed, after the sefarim.
    expect(shelf).toMatch(/<details[^>]*><summary[^>]*>הוספות \(1\)<\/summary>.*?ליקוט לדוגמה/s);
    // The library lists it only inside its sefer's open card, with the other editions.
    const library = (await get('/sets')).html;
    expect(library).toMatch(/class="lb-with".*?ביאור לספר השער/s);
    const biur = (await get('/biur-sample')).html;
    expect(biur).toMatch(/הוספה ל.*?href="\/shaar-sample"/s);
  });

  it('finds a sefer by its title even where the title reads as a date, before its additions, which say what they are', async () => {
    // `תניא` is also the year 5461, and names the sefer: the sefer is found first, and its index after it, labelled an addition to it.
    const found = (await get(`/search?q=${encodeURIComponent('תניא')}`)).html;
    expect(found).toMatch(/href="\/tanya-sample".*?href="\/tanya-index-sample"/s);
    // Above its name, where it is from: what it is, and that it is an addition to the sefer.
    expect(found).toMatch(/href="\/tanya-index-sample".*?class="row-kicker">.*?הוספה ל: תניא/s);
  });

  it("goes back and forth between a sefer's sichos, above the text and below it", async () => {
    const around = (await get(`/${ids.unit2}`)).html;
    // Hebrew first: "previous" at the line's start, the right, its chevron pointing there.
    expect(around.match(/class="chapter-nav chapter-nav-(top|bottom)"/g)).toEqual(['class="chapter-nav chapter-nav-top"', 'class="chapter-nav chapter-nav-bottom"']);
    expect(around).toMatch(new RegExp(`rel="prev" href="/${ids.unit1}".*?הקודם.*?שיחה 1`));
    expect(around).toMatch(new RegExp(`rel="next" href="/${ids.unit3}".*?הבא.*?שיחה 3`));
    const english = (await get(`/${ids.unit2}?lang=en`)).html;
    expect(english).toMatch(/rel="prev"[^>]*>.*?Previous/);
    expect(english).toMatch(/rel="next"[^>]*>.*?Next/);
    // The first has no previous, the last no next.
    expect((await get(`/${ids.unit1}`)).html).not.toContain('rel="prev"');
    expect((await get(`/${ids.unit3}`)).html).not.toContain('rel="next"');
  });

  it('counts all that belongs to an item, and lists it a page at a time', async () => {
    const page = await get('/shaar-sample');
    expect(page.html).toContain('כל מה ששייך לכאן');
    expect(page.html).toContain(`/all/${ids.work}?field=work&amp;type=unit`);
    const all = await get(`/all/${ids.work}?field=work&type=unit`);
    expect(all.status).toBe(200);
    expect(all.html).toContain('1–3 מתוך 3');
    expect(all.html).toContain('שיחה 3');
    const kinds = await get(`/all/${ids.work}`);
    expect(kinds.html).toContain(`field=work&amp;type=publication`);
    expect((await get('/all/rh-zzzzzzzz')).status).toBe(404);
  });

  it("gives a recording its own page: its farbrengen, part, length, source and other parts", async () => {
    const page = await get(`/${ids.rec1}`);
    expect(page.status).toBe(200);
    expect(page.html).toContain('1:02:05');
    expect(page.html).toContain('חלק ב');
    expect(page.html).toContain('https://www.chabad.org/multimedia/media_cdo/aid/12345');
    expect(page.html).toContain(`/files/${sha('d')}`);
    // Anyone may follow it.
    expect(page.html).toContain('class="phead-acts"');
  });

  it("gives a person a page of facts, not raw data", async () => {
    const page = await get(`/${ids.person}`);
    expect(page.html).toContain('ר׳ יואל כהן');
    expect(page.html).not.toContain('class="json"');
    expect(page.html).toContain('wikidata');
  });

  it("gives a file its own page: its rights, what uses it and what was made from it", async () => {
    const page = await get(`/files/${sha('a')}`);
    expect(page.status).toBe(200);
    expect(page.html).toContain(`https://files.rebbehub.test/objects/${sha('a')}`);
    expect(page.html).toContain('cover/2');
    expect(page.html).toContain('ספר השער');
    const kept = await get(`/files/${sha('d')}`);
    expect(kept.html).toContain('אינו מוצג');
    expect((await get(`/files/${sha('0')}`)).status).toBe(404);
  });

  it('offers "Add a hanacha" on a farbrengen, leading to the guided flow', async () => {
    const page = await get('/events/5742-05-10');
    expect(page.html).toContain(`/add?what=hanacha&amp;for=${ids.event}`);
    const add = await get(`/add?what=hanacha&for=${ids.event}`);
    expect(add.status).toBe(200);
    expect(add.html).toContain('הוספת חומר חדש');
  });
});
