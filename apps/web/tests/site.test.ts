import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ServerBuild } from 'react-router';
import { registerFile } from '@rebbehub/core';
import type { EntityId } from '@rebbehub/model';
import { createApp } from '../../../services/api/src/app.js';
import { add, freshCatalog } from '../../../packages/core/tests/helpers.js';
import { createSiteHandler } from '../server/handler.js';

/**
 * The built site, rendered on the server exactly as in production, reading
 * a real API over a small made-up catalog (no real texts: these samples are
 * invented for the test).
 */

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://rebbehub.test';
let handle: (request: Request) => Promise<Response>;
const ids: Record<string, EntityId> = {};

beforeAll(async () => {
  // The site is tested as built; build it when this checkout has not yet.
  if (!existsSync(`${webRoot}/build/server/index.js`)) execFileSync('npx', ['react-router', 'build'], { cwd: webRoot, stdio: 'ignore' });
  const build = (await import(`${webRoot}/build/server/index.js`)) as ServerBuild;

  const { catalog, set } = await freshCatalog();
  ids.set = set;
  ids.author = await add(catalog, 'shmuly', 'shmuly', 'author', { name: { he: 'הרבי', en: 'The Rebbe' }, kind: 'rebbe', rebbe: 7, sets: [set] }, '/authors/the-rebbe');
  ids.work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'ספר לדוגמה', en: 'Sample Sefer' }, slug: 'sample', authors: [ids.author], genre: 'sichos', levels: ['volume', 'sicha'], sets: [set], sourceCopies: [{ source: 'sefaria', sourceId: 'Sample', kind: 'text', licence: 'cc-by-nc', language: 'he' }] }, '/sample');
  ids.event = await add(catalog, 'mendy', 'keeper', 'event', { kind: 'farbrengen', title: { he: 'התוועדות לדוגמה', en: 'Sample farbrengen' }, date: '5742-05-10', sets: [set] }, '/events/5742-05-10');
  ids.unit = await add(catalog, 'mendy', 'keeper', 'unit', {
    work: ids.work,
    position: [{ level: 'volume', value: '1', label: { he: 'חלק א', en: 'Volume 1' } }, { level: 'sicha', value: '1' }],
    order: 'V',
    label: { he: 'שיחה לדוגמה', en: 'Sample sicha' },
    date: '5742-05-10',
    events: [ids.event],
    editions: [{ source: 'sefaria', sourceId: 'Sample 1', kind: 'text', licence: 'cc-by-nc' }],
  }, '/sample/1/1');
  ids.text = await add(catalog, 'mendy', 'keeper', 'text', { kind: 'edition', unit: ids.unit, language: 'he' });
  ids.seg1 = await add(catalog, 'mendy', 'keeper', 'segment', { text: ids.text, order: 'V', kind: 'paragraph', content: 'פסקה ראשונה לדוגמה', proofread: 1 });
  ids.seg2 = await add(catalog, 'mendy', 'keeper', 'segment', { text: ids.text, order: 'k', kind: 'paragraph', content: 'פסקה שנייה ממוחשבת', proofread: 0, origin: { by: 'ocr:test@1' } });
  ids.closed = await add(catalog, 'mendy', 'keeper', 'text', { kind: 'hanacha', unit: ids.unit, language: 'he', licence: 'site-terms' });
  await add(catalog, 'mendy', 'keeper', 'segment', { text: ids.closed, order: 'V', kind: 'paragraph', content: 'מילים סגורות', proofread: 0 });
  const audio = 'a'.repeat(64);
  await registerFile(catalog.db, { sha256: audio, bytes: 1000, mime: 'audio/mpeg', source: 'contribution', licence: 'cc0', held: true });
  ids.recording = await add(catalog, 'mendy', 'keeper', 'recording', { event: ids.event, title: { he: 'הקלטה א', en: 'Recording 1' }, file: audio, part: 1, durationMs: 3_723_000, videos: [{ provider: 'youtube', url: 'https://www.youtube.com/watch?v=x', startMs: 60_000 }] });
  const pdf = 'b'.repeat(64);
  await registerFile(catalog.db, { sha256: pdf, bytes: 5000, mime: 'application/pdf', source: 'contribution', licence: 'unknown', fileClass: 'teshura-scan', held: true, credit: 'The families' });
  ids.teshura = await add(catalog, 'mendy', 'keeper', 'publication', { kind: 'teshura', title: { he: 'תשורה לדוגמה', en: 'Sample teshura' }, simcha: { kind: 'wedding', families: ['כהן', 'לוי'], date: '5784-03-15' }, sets: [set] }, '/teshuros/sample');
  ids.scan = await add(catalog, 'mendy', 'keeper', 'scan', { publication: ids.teshura, file: pdf, completeness: 'complete', preferred: true });
  await add(catalog, 'mendy', 'keeper', 'contents-map', { publication: ids.teshura, pages: { from: 3, to: 8, scheme: 'printed' }, unit: ids.unit });
  // A path that changed: the old one must keep working.
  const move = await catalog.createChangeset('mendy', { title: 'Better path' });
  const current = (await catalog.get(ids.teshura))!;
  await catalog.putRevision(move.id, 'mendy', { id: ids.teshura, type: 'publication', data: current.data, path: '/teshuros/5784-cohen-levi' });
  await catalog.submit(move.id, 'mendy');
  await catalog.merge(move.id, 'keeper');

  const api = createApp({ catalog, reportSalt: 'test', filesBaseUrl: 'https://files.rebbehub.test' });
  handle = createSiteHandler(build, { apiUrl: 'http://api.test', siteUrl: SITE, fetch: (input, init) => Promise.resolve(api.request(input, init)) });
}, 120_000);

const get = async (path: string) => {
  const response = await handle(new Request(`${SITE}${path}`));
  return { status: response.status, location: response.headers.get('location'), html: await response.text(), type: response.headers.get('content-type') };
};

describe('the public site', () => {
  it('renders the home page in Hebrew, right to left, with the week, the tabs and the community', async () => {
    const page = await get('/');
    expect(page.status).toBe(200);
    expect(page.html).toContain('<html lang="he" dir="rtl">');
    expect(page.html).toContain('class="home-parsha"');
    expect(page.html).toContain('התוועדויות'); // the farbrengens tab
    expect(page.html).toContain('class="needs"'); // what the community can help with
    expect(page.html).toContain('href="/help"');
  });

  it('renders the same pages in English at ?lang=en, with both languages linked for search engines', async () => {
    const page = await get('/sample?lang=en');
    expect(page.html).toContain('<html lang="en" dir="ltr">');
    expect(page.html).toContain('Sample Sefer');
    expect(page.html).toContain(`<link rel="canonical" href="${SITE}/sample?lang=en"/>`);
    expect(page.html).toContain(`hrefLang="he" href="${SITE}/sample"`);
    expect(page.html).toContain('"@type":"Book"');
  });

  it('shows a work with its author, sources and contents', async () => {
    const page = await get('/sample');
    expect(page.html).toContain('ספר לדוגמה');
    expect(page.html).toContain('href="/authors/the-rebbe"');
    expect(page.html).toContain('https://www.sefaria.org/Sample');
    expect(page.html).toContain('חלק א');
    expect(page.html).toContain('href="/sample/1/1"');
  });

  it('shows a unit with its text, anchored paragraphs, machine labels, and withholds closed words', async () => {
    const page = await get('/sample/1/1');
    expect(page.html).toContain(`id="${ids.seg1}"`);
    expect(page.html).toContain('פסקה ראשונה לדוגמה');
    expect(page.html).toContain('טקסט ממוחשב שטרם נבדק');
    expect(page.html).not.toContain('מילים סגורות');
    expect(page.html).toContain('אינן מוצגות כאן');
    expect(page.html).toContain('href="/teshuros/5784-cohen-levi"'); // printed in
    expect(page.html).toContain('י׳ שבט תשמ״ב');
  });

  it('shows an event with its date, recordings (served, with video at the moment) and what was said', async () => {
    const page = await get('/events/5742-05-10');
    expect(page.html).toContain('התוועדות לדוגמה');
    // The parts play in the site's player; the served file is its source.
    expect(page.html).toContain('class="part-list"');
    expect(page.html).toContain(`https://files.rebbehub.test/objects/${'a'.repeat(64)}`);
    expect(page.html).toContain('https://www.youtube.com/watch?v=x&amp;t=60');
    expect(page.html).toContain('1:02:03');
    expect(page.html).toContain('href="/sample/1/1"');
    expect(page.html).toContain('"@type":"Event"');
    expect(page.html).toContain('"startDate":"1982-02-03"');
  });

  it('shows a teshura with its simcha, its scan and what it reproduces', async () => {
    const page = await get('/teshuros/5784-cohen-levi');
    expect(page.html).toContain('כהן – לוי');
    expect(page.html).toContain(`https://files.rebbehub.test/objects/${'b'.repeat(64)}#page=1`);
    expect(page.html).toContain('© The families');
    expect(page.html).toContain('3–8');
  });

  it('keeps every link working: permanent ids and old paths redirect to the current path', async () => {
    expect(await get(`/${ids.teshura}`)).toMatchObject({ status: 301, location: '/teshuros/5784-cohen-levi' });
    expect(await get(`/${ids.teshura!.toUpperCase()}?lang=en`)).toMatchObject({ status: 301, location: '/teshuros/5784-cohen-levi?lang=en' });
    expect(await get('/teshuros/sample')).toMatchObject({ status: 301, location: '/teshuros/5784-cohen-levi' });
    expect((await get('/no/such/page')).status).toBe(404);
    expect((await get('/rh-zzzzzzzz')).status).toBe(404);
  });

  it('shows the calendar by year and month, Adar II and all', async () => {
    const year = await get('/calendar/5742');
    expect(year.html).toContain('שבט');
    expect(year.html).toContain('href="/events/5742-05-10"');
    // A leap year has Adar II; a year lists the months it has farbrengens in.
    const leap = await get('/calendar/5741/06B');
    expect(leap.status).toBe(200);
    expect(leap.html).toContain('אדר ב׳');
    expect((await get('/calendar/5742/05')).html).toContain('התוועדות לדוגמה');
    expect((await get('/calendar/5742/06B')).status).toBe(404); // 5742 is not a leap year
    expect((await get('/calendar/99999')).status).toBe(404);
  });

  it('searches by words and by dates written in Hebrew', async () => {
    const words = await get(`/search?q=${encodeURIComponent('לדוגמה')}`);
    expect(words.html).toContain('href="/sample"');
    const date = await get(`/search?q=${encodeURIComponent('יו"ד שבט תשמ"ב')}`);
    expect(date.html).toContain('href="/calendar/5742/05"');
    expect(date.html).toContain('href="/events/5742-05-10"');
  });

  it('keeps a history of every item', async () => {
    const page = await get(`/history/${ids.teshura}`);
    expect(page.html).toContain('Better path');
    expect(page.html).toContain('mendy');
  });

  it('takes a report with no account, without JavaScript', async () => {
    const body = new URLSearchParams({ intent: 'report', entityId: ids.event!, reason: 'wrong-fact', note: 'the date' });
    const response = await handle(new Request(`${SITE}/events/5742-05-10`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '10.0.0.1' } }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('תודה! הדיווח נשלח');
  });

  it('tells search engines what there is', async () => {
    const robots = await get('/robots.txt');
    expect(robots.html).toContain(`Sitemap: ${SITE}/sitemap.xml`);
    const index = await get('/sitemap.xml');
    expect(index.type).toContain('application/xml');
    expect(index.html).toContain(`${SITE}/sitemaps/work.xml`);
    const works = await get('/sitemaps/work.xml');
    expect(works.html).toContain(`<loc>${SITE}/sample</loc>`);
    expect(works.html).toContain(`hreflang="en" href="${SITE}/sample?lang=en"`);
    expect((await get('/sitemaps/schema.xml')).status).toBe(404);
  });
});
