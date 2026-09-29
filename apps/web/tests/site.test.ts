import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ServerBuild } from 'react-router';
import { Catalog, createPerson, registerFile, setUsername } from '@rebbehub/core';
import { measured } from '@rebbehub/db';
import type { EntityId } from '@rebbehub/model';
import { createApp } from '../../../services/api/src/app.js';
import { add, freshCatalog } from '../../../packages/core/tests/helpers.js';
import { ITEM_PAGE, PUBLIC_PAGE, crawlBudget, crawlLater, edgeCacheable, forEdge } from '../server/cachePolicy.js';
import { createSiteHandler } from '../server/handler.js';

/**
 * The built site, rendered on the server exactly as in production, reading
 * a real API over a small made-up catalog (no real texts: these samples are
 * invented for the test).
 */

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://rebbehub.test';
let handle: ReturnType<typeof createSiteHandler>;
let api: ReturnType<typeof createApp>;
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
  // A handle that changed: the old address leads to the new one.
  const levi = await createPerson(catalog.db, 'Levi Yitzchak', 'levi');
  await setUsername(catalog.db, levi.id, 'levi-y');

  // The API as on Workers: its database counted, so each answer says what it cost.
  const db = measured(catalog.db);
  api = createApp({ catalog: new Catalog(db), cost: () => db.cost, reportSalt: 'test', filesBaseUrl: 'https://files.rebbehub.test' });
  handle = createSiteHandler(build, { apiUrl: 'http://api.test', siteUrl: SITE, fetch: (input, init) => Promise.resolve(api.request(input, init)) });
}, 120_000);

const get = async (path: string, headers: Record<string, string> = {}) => {
  const response = await handle(new Request(`${SITE}${path}`, { headers }));
  return { status: response.status, location: response.headers.get('location'), html: await response.text(), type: response.headers.get('content-type'), cache: response.headers.get('cache-control') };
};

describe('the public site', () => {
  it('renders the home page in Hebrew, right to left, with the week, the tabs and the community', async () => {
    const page = await get('/');
    expect(page.status).toBe(200);
    expect(page.html).toContain('<html lang="he" dir="rtl">');
    expect(page.html).toContain('class="daybar"'); // the day, its chag or the coming parsha
    expect(page.html).toContain('התוועדויות'); // the farbrengens tab
    expect(page.html).toContain('class="box needs"'); // what the community can help with
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
    // Read in the site's own reader; the file itself one tap away.
    expect(page.html).toContain(`href="https://files.rebbehub.test/objects/${'b'.repeat(64)}"`);
    expect(page.html).toContain(`href="/read?src=https%3A%2F%2Ffiles.rebbehub.test%2Fobjects%2F${'b'.repeat(64)}`);
    expect(page.html).toContain('© The families');
    // What it reproduces, from which page and on how many.
    expect(page.html).toContain('<span class="pg num">3</span>');
    expect(page.html).toContain('6 עמודים');
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

  it('takes a takedown request with no account, without JavaScript, and says when it will be answered', async () => {
    const form = await get('/takedown?lang=en');
    expect(form.html).toContain('Ask for a takedown');
    expect(form.html).toContain('A steward answers within two weeks');
    const body = new URLSearchParams({ target: `${SITE}/events/5742-05-10`, name: 'Rivka', email: 'rivka@example.org', relation: 'family', statement: 'Our family recording; please take it down.' });
    const response = await handle(new Request(`${SITE}/takedown?lang=en`, { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': '10.0.0.2' } }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Your request arrived');
  });

  it('tells search engines what there is: robots.txt, and sitemaps a page of items at a time in both languages', async () => {
    const robots = await get('/robots.txt');
    expect(robots.html).toContain('User-agent: *\nAllow: /\n');
    for (const path of ['/_/', '/account', '/inbox', '/admin', '/review', '/search', '/edit/', '/history/']) expect(robots.html).toContain(`Disallow: ${path}\n`);
    // Items, lists and the developer docs stay open to every crawler.
    expect(robots.html).not.toMatch(/Disallow: \/(developers|sets|calendar|events|sample)\b/);
    expect(robots.html).toContain(`Sitemap: ${SITE}/sitemap.xml`);

    const index = await get('/sitemap.xml');
    expect(index.type).toContain('application/xml');
    expect(index.cache).toMatch(/^public, .*s-maxage=3600/);
    expect(index.html).toContain(`<loc>${SITE}/sitemaps/pages.xml</loc>`);
    expect(index.html).toMatch(new RegExp(`<loc>${SITE}/sitemaps/work-1\\.xml</loc><lastmod>\\d{4}-\\d\\d-\\d\\dT`));
    expect(index.html).toContain(`${SITE}/sitemaps/event-1.xml`);
    expect(index.html).not.toContain('schema-1.xml');

    const works = await get('/sitemaps/work-1.xml');
    expect(works.html).toMatch(new RegExp(`<url><loc>${SITE}/sample</loc><lastmod>[^<]+</lastmod><xhtml:link rel="alternate" hreflang="he" href="${SITE}/sample"/><xhtml:link rel="alternate" hreflang="en" href="${SITE}/sample\\?lang=en"/><xhtml:link rel="alternate" hreflang="x-default" href="${SITE}/sample"/></url>`));
    expect(works.html).toContain(`<url><loc>${SITE}/sample?lang=en</loc>`);
    const pages = await get('/sitemaps/pages.xml');
    for (const path of ['/', '/sets', '/calendar', '/developers', '/developers/reference']) expect(pages.html).toContain(`<loc>${SITE}${path}</loc>`);
    // The first sitemaps' addresses still lead to their first page; what is not there is not found.
    expect(await get('/sitemaps/work.xml')).toMatchObject({ status: 301, location: '/sitemaps/work-1.xml' });
    expect((await get('/sitemaps/work-2.xml')).status).toBe(404);
    expect((await get('/sitemaps/schema.xml')).status).toBe(404);
    expect((await get('/sitemaps/segment-1.xml')).status).toBe(404);
  });

  it("gives every item's page its title, description, canonical address, languages, preview and structured data", async () => {
    const page = await get('/sample');
    expect(page.html).toContain('<title>ספר לדוגמה · RebbeHub</title>');
    expect(page.html).toMatch(/<meta name="description" content="[^"]*ספר לדוגמה/);
    expect(page.html).toContain(`<link rel="canonical" href="${SITE}/sample"/>`);
    expect(page.html).toContain(`hrefLang="he" href="${SITE}/sample"`);
    expect(page.html).toContain(`hrefLang="en" href="${SITE}/sample?lang=en"`);
    expect(page.html).toContain(`hrefLang="x-default" href="${SITE}/sample"`);
    expect(page.html).toContain('<meta property="og:type" content="book"/>');
    expect(page.html).toContain(`<meta property="og:url" content="${SITE}/sample"/>`);
    // Without a shaar drawn yet, the site's own picture.
    expect(page.html).toContain(`<meta property="og:image" content="${SITE}/icon-512.png"/>`);
    expect(page.html).toContain('<meta name="twitter:card" content="summary"/>');
    expect(page.html).not.toContain('name="robots"');
    const data = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(page.html)![1]!);
    const graph = data['@graph'] as Array<Record<string, any>>;
    expect(graph.find((x) => x['@type'] === 'Book')).toMatchObject({ name: 'ספר לדוגמה', url: `${SITE}/sample`, author: [{ '@type': 'Person', name: 'הרבי', url: `${SITE}/authors/the-rebbe` }] });
    const crumbs = graph.find((x) => x['@type'] === 'BreadcrumbList')!;
    expect(crumbs.itemListElement.map((c: { item: string }) => c.item)).toEqual([`${SITE}/sets`, `${SITE}/farbrengens`, `${SITE}/sample`]);

    // A farbrengen is an Event, its recordings the AudioObjects heard there, each with its file and length.
    const event = await get('/events/5742-05-10?lang=en');
    const eventData = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(event.html)![1]!)['@graph'] as Array<Record<string, any>>;
    expect(eventData[0]).toMatchObject({
      '@type': 'Event',
      name: 'Sample farbrengen',
      recordedIn: [{ '@type': 'AudioObject', name: 'Recording 1', contentUrl: `https://files.rebbehub.test/objects/${'a'.repeat(64)}`, encodingFormat: 'audio/mpeg', duration: 'PT1H2M3S' }],
    });
    expect(eventData[0]!.startDate).toMatch(/^19\d\d-\d\d-\d\d$/);
    expect(eventData[1]!.itemListElement[0]).toMatchObject({ name: 'Farbrengens', item: `${SITE}/calendar` });
    expect(event.html).toContain(`<link rel="canonical" href="${SITE}/events/5742-05-10?lang=en"/>`);
    expect(event.html).toContain('<meta property="og:locale" content="en_US"/>');

    // The home page says what the site is, and how to search it.
    const home = await get('/');
    const homeData = JSON.parse(/<script type="application\/ld\+json">(.*?)<\/script>/s.exec(home.html)![1]!)['@graph'] as Array<Record<string, any>>;
    expect(homeData[0]).toMatchObject({ '@type': 'WebSite', url: `${SITE}/`, publisher: { '@id': `${SITE}/#organization` }, potentialAction: { '@type': 'SearchAction' } });
    expect(homeData[1]).toMatchObject({ '@type': 'Organization', logo: { url: `${SITE}/icon-512.png` }, sameAs: ['https://github.com/shmuky/RebbeHub'] });
    // Every page offers the address bar a way to search the catalog.
    expect(home.html).toContain('<link rel="search" type="application/opensearchdescription+xml" title="RebbeHub" href="/opensearch.xml"/>');
    const openSearch = await get('/opensearch.xml');
    expect(openSearch.type).toContain('application/opensearchdescription+xml');
    expect(openSearch.html).toContain(`template="${SITE}/search?q={searchTerms}"`);
  });

  it('says on every page what it cost: the API calls, the statements behind them, and the whole (Server-Timing)', async () => {
    const page = await handle(new Request(`${SITE}/sample`));
    const timing = page.headers.get('Server-Timing')!;
    expect(timing).toMatch(/^api;dur=\d+(\.\d)?;desc="\d+ calls", db;dur=\d+(\.\d)?;desc="\d+ statements", total;dur=\d+(\.\d)?$/);
    const calls = Number(/"(\d+) calls"/.exec(timing)![1]);
    const statements = Number(/"(\d+) statements"/.exec(timing)![1]);
    expect(calls).toBeGreaterThan(3);
    expect(statements).toBeGreaterThan(calls);
    // A redirect asks nothing.
    expect((await handle(new Request(`${SITE}/sample/`))).headers.get('Server-Timing')).toMatch(/^api;dur=0\.0;desc="0 calls", db;dur=0\.0;desc="0 statements", total;dur=/);
  });

  it("makes a page through its own reader when the Worker has one, and counts what the reader's connection did, whole", async () => {
    // As on Workers: the reader answers every read of /v1 as nobody on the page's own connection (its cost counted there), and would send the rest on.
    const cost = { statements: 0, ms: 0 };
    const answered: string[] = [];
    const reader = {
      answers: (input: string) => input.startsWith('http://api.test/v1/'),
      answer: async (input: string, init?: RequestInit) => {
        answered.push(input);
        const response = await api.request(input, init);
        cost.statements += 3;
        cost.ms += 1.5;
        return response;
      },
      cost,
    };
    const page = await handle(new Request(`${SITE}/sample`), reader);
    expect(page.status).toBe(200);
    const timing = page.headers.get('Server-Timing')!;
    expect(timing).toMatch(/^api;dur=\d+(\.\d)?;desc="(\d+) calls, \2 answered here", db;dur=[\d.]+;desc="\d+ statements", total;dur=/);
    const calls = Number(/"(\d+) calls/.exec(timing)![1]);
    expect(answered).toHaveLength(calls);
    // The statements are the reader's, whole: three a read here, not what each answer's own Server-Timing said.
    expect(Number(/"(\d+) statements"/.exec(timing)![1])).toBe(calls * 3);
    expect(timing).toContain(`db;dur=${(calls * 1.5).toFixed(1)}`);
  });

  it('tells browsers to keep to HTTPS and not guess types, and says where to report a security problem', async () => {
    for (const path of ['/', '/sample', '/robots.txt', '/no/such/sefer', `/embed/${ids.event}`]) {
      const response = await handle(new Request(`${SITE}${path}`));
      expect(response.headers.get('x-content-type-options'), path).toBe('nosniff');
      expect(response.headers.get('strict-transport-security'), path).toMatch(/^max-age=\d{7,}/);
      expect(response.headers.get('referrer-policy'), path).toBe('strict-origin-when-cross-origin');
    }
    const security = await get('/.well-known/security.txt');
    expect(security.type).toContain('text/plain');
    expect(security.html).toContain('Contact: https://github.com/shmuky/RebbeHub/security/advisories/new\n');
    expect(security.html).toContain(`Canonical: ${SITE}/.well-known/security.txt\n`);
    const expires = new Date(/Expires: (\S+)/.exec(security.html)![1]!);
    expect(expires.getTime()).toBeGreaterThan(Date.now() + 90 * 86_400_000);
    expect(expires.getTime()).toBeLessThan(Date.now() + 365 * 86_400_000);
  });

  it("counts the pages crawlers make against a budget, each search engine its own, never people's or the guides", () => {
    const as = (agent: string, path = '/sample') => crawlBudget(new Request(`${SITE}${path}`, { headers: { 'user-agent': agent } }));
    const person = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    expect(as(person)).toBeNull();
    expect(as('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toEqual({ key: 'search:googlebot', searchEngine: true });
    expect(as('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)')).toEqual({ key: 'search:bingbot', searchEngine: true });
    // AI crawlers and every other bot share one budget.
    expect(as('Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)')).toEqual({ key: 'bots', searchEngine: false });
    expect(as('Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)')).toEqual({ key: 'bots', searchEngine: false });
    // What leads a crawler to the rest is never counted.
    for (const path of ['/robots.txt', '/sitemap.xml', '/sitemaps/unit-3.xml', '/llms.txt', '/llms-full.txt']) expect(as('Googlebot/2.1', path), path).toBeNull();
    const later = crawlLater();
    expect(later.status).toBe(503);
    expect(later.headers.get('retry-after')).toBe('120');
    expect(later.headers.get('cache-control')).toBe('no-store');
  });

  it('keeps search results, empty talk pages, histories and permanent-id copies out of search, and answers what is not there with 404', async () => {
    for (const path of ['/search?q=שבט', `/talk/${ids.work}`, `/history/${ids.work}`, '/account', '/inbox', `/embed/${ids.event}`]) {
      const page = await get(path);
      expect(page.status, path).toBe(200);
      expect(page.html, path).toMatch(/<meta name="robots" content="noindex/);
    }
    // One address per page: a permanent id and a trailing slash lead to it in one permanent redirect.
    expect(await get(`/${ids.work}`)).toMatchObject({ status: 301, location: '/sample' });
    expect(await get('/sample/?lang=en')).toMatchObject({ status: 301, location: '/sample?lang=en' });
    const missing = await get('/no/such/sefer');
    expect(missing.status).toBe(404);
    expect(missing.html).toContain('<html lang="he" dir="rtl">');
  });

  it("lets Cloudflare's edge keep pages for anyone, never for someone signed in, and never what failed or is personal", async () => {
    // An item's page is kept an hour (it changes only when a Suggestion is approved); other pages five minutes.
    const anyone = await get('/sample');
    expect(anyone.cache).toBe(ITEM_PAGE);
    expect(anyone.cache).toMatch(/s-maxage=3600/);
    expect((await get('/sets')).cache).toBe(PUBLIC_PAGE);
    // The data React Router fetches for the next page is kept the same way.
    expect((await get('/sample.data')).cache).toBe(ITEM_PAGE);
    const signedIn = await get('/sample', { cookie: '__Host-rh_session=abc; theme=dark' });
    expect(signedIn.status).toBe(200);
    expect(signedIn.cache).toBe('private, no-cache');
    // A page that is not there is kept too (crawlers ask again and again), briefly.
    expect((await get('/no/such/sefer')).cache).toBe(PUBLIC_PAGE);
    // What passes a person's requests on to the API never is.
    expect((await get('/_/threads/people?q=lev')).cache).toBe('no-store');
    expect((await get('/robots.txt')).cache).toMatch(/^public, .*s-maxage=/);

    // What the Worker sends to the cached entrypoint (server/worker.ts).
    const request = (path: string, init: RequestInit = {}) => new Request(`${SITE}${path}`, init);
    expect(edgeCacheable(request('/sample'))).toBe(true);
    expect(edgeCacheable(request('/sample', { headers: { cookie: 'theme=dark' } }))).toBe(true);
    expect(edgeCacheable(request('/sample', { headers: { cookie: 'rh_session=abc' } }))).toBe(false);
    expect(edgeCacheable(request('/sample', { method: 'POST' }))).toBe(false);
    expect(edgeCacheable(request('/_/auth/me'))).toBe(false);
    const cleaned = forEdge(request('/sample?utm_source=x&fbclid=y&lang=en', { headers: { cookie: 'theme=dark' } }));
    expect(cleaned.url).toBe(`${SITE}/sample?lang=en`);
    expect(cleaned.headers.get('cookie')).toBeNull();
  });

  it('shows a person by their handle, and an old handle leads to the new one', async () => {
    const page = await get('/u/levi-y?lang=en');
    expect(page.status).toBe(200);
    expect(page.html).toContain('@levi-y');
    expect(page.html).toContain('Levi Yitzchak');
    expect(page.html).toContain('Activity');
    const moved = await get('/u/levi');
    expect(moved.status).toBe(301);
    expect(moved.location).toBe('/u/levi-y');
    expect((await get('/u/nobody-has-this')).status).toBe(404);
  });

  it('has pages for suggestions, issues and the inbox, filled in by the browser', async () => {
    for (const path of ['/suggestions', '/suggestions/1', '/issues', '/issues/new', '/inbox']) expect((await get(path)).status).toBe(200);
    // Suggestions and reports share one numbering: a suggestion's number asked for as a report goes to its own page.
    expect(await get('/issues/1')).toMatchObject({ status: 302, location: '/suggestions/1' });
    expect((await get('/issues/not-a-number')).status).toBe(404);
  });

  it('splits the account into its own pages, as GitHub settings are, and answers a part that is not there with 404', async () => {
    for (const path of ['/account', '/account/security', '/account/emails', '/account/following', '/account/apps', '/account/developers']) {
      const page = await get(path);
      expect(page.status, path).toBe(200);
      expect(page.html, path).toMatch(/<meta name="robots" content="noindex/);
    }
    expect((await get('/account/nothing-here')).status).toBe(404);
  });

  it('shows anyone how to connect Claude, ChatGPT and other AI apps: one address to copy, one-click links where the app takes them', async () => {
    const page = await get('/connect?lang=en');
    expect(page.status).toBe(200);
    expect(page.html).toContain('http://api.test/mcp');
    expect(page.html).toContain('https://claude.ai/settings/connectors');
    expect(page.html).not.toMatch(/<meta name="robots" content="noindex/);
    expect((await get('/sitemaps/pages.xml')).html).toContain(`${SITE}/connect`);
  });

  it('passes people and conversations through to the API, and only those', async () => {
    const people = await get('/_/threads/people?q=lev');
    expect(people.status).toBe(200);
    expect(JSON.parse(people.html).people.map((p: { username: string }) => p.username)).toContain('levi-y');
    expect((await get('/_/threads/issues/templates')).status).toBe(200);
    expect((await get('/_/threads/admin/people')).status).toBe(404);
  });
});
