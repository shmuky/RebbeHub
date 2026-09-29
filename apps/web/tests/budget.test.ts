import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ServerBuild } from 'react-router';
import { registerFile, type Catalog, type Json } from '@rebbehub/core';
import type { Db } from '@rebbehub/db';
import type { EntityId } from '@rebbehub/model';
import { createApp } from '../../../services/api/src/app.js';
import { add, freshCatalog, yudShvat } from '../../../packages/core/tests/helpers.js';
import { createSiteHandler } from '../server/handler.js';

/**
 * The statement budget (docs/operations.md, "What reaches Postgres"): what
 * each page costs, counted. Cloudflare counts every statement the API
 * sends through Hyperdrive against the free plan's day, and every request
 * the site makes to the API against the 50 a page may make, so a page
 * that quietly grows past its ceiling takes the site down. Each page is
 * rendered as in production, over a small catalog with the shapes that
 * matter (a sefer of thirty sichos, a farbrengen of six parts with a
 * synced hanacha, open suggestions of twenty items), and its statements,
 * API calls and size are counted. The counts are what a page needs today
 * with a little room; a PR that goes over any raises the ceiling on
 * purpose, saying why, or finds the batch route it should have used.
 *
 * Size is counted because a page carries what its loader returned to the
 * browser, hidden, for hydration: a volume of Igros Kodesh was 1.1 MB, of
 * which 1 MB was every letter's words, listed with each letter and read
 * by no one (lists now carry an item's facts, not its words). Each sicha
 * here has words of a few kilobytes, so a list that leaks them shows.
 */

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const SITE = 'https://rebbehub.test';
const sha = (c: string) => c.repeat(64);

let catalog: Catalog;
let api: ReturnType<typeof createApp>;
let handle: (request: Request) => Promise<Response>;
const ids = {} as Record<'set' | 'work' | 'unit' | 'pub' | 'scan' | 'event' | 'recording', EntityId>;
let suggestion = 0;
const counts = { statements: 0, calls: 0, shapes: new Map<string, number>(), routes: new Map<string, number>() };
const measured: Array<{ what: string; statements: number; calls: number; kB: number; status: number; routes: string[] }> = [];

/** A sicha's words as Sichos-Kodesh's import keeps them in the sicha itself (pageText.ts), about four kilobytes like a real one. */
const words = (i: number) => ({ profile: 'sichos-kodesh', versions: [{ id: 'he', language: 'he', credit: 'לדוגמה', segments: [{ id: 'p1', kind: 'paragraph', text: [{ text: `דברי שיחה ${i} `.repeat(300) }] }] }] });

const reset = () => {
  counts.statements = 0;
  counts.calls = 0;
  counts.shapes.clear();
  counts.routes.clear();
};

beforeAll(async () => {
  if (!existsSync(`${webRoot}/build/server/index.js`)) execFileSync('npx', ['react-router', 'build'], { cwd: webRoot, stdio: 'ignore' });
  const build = (await import(`${webRoot}/build/server/index.js`)) as ServerBuild;
  const fresh = await freshCatalog();
  catalog = fresh.catalog;
  const set = fresh.set;
  ids.set = set;

  // A sefer of two volumes, thirty sichos in the first, printed once with a scan we hold; the first sichos have
  // their words (an edition, one with its English), and the printing says where the first is.
  ids.work = await add(catalog, 'mendy', 'keeper', 'work', { title: { he: 'שיחות לדוגמה', en: 'Sample Sichos' }, slug: 'igros-sample', authors: [], genre: 'sichos', levels: ['volume', 'sicha'], sets: [set] }, '/igros-sample');
  const units: EntityId[] = [];
  const volume = (n: number) => ({ level: 'volume', value: String(n), label: { he: `חלק ${n}`, en: `Volume ${n}` } });
  for (let i = 1; i <= 30; i++) units.push(await add(catalog, 'mendy', 'keeper', 'unit', { work: ids.work, position: [volume(1), { level: 'sicha', value: String(i) }], order: `a${String(i).padStart(2, '0')}`, label: { he: `שיחה ${i}` }, body: words(i) }));
  for (let i = 1; i <= 3; i++) await add(catalog, 'mendy', 'keeper', 'unit', { work: ids.work, position: [volume(2), { level: 'sicha', value: String(i) }], order: `b${String(i).padStart(2, '0')}`, label: { he: `שיחה ${i}` } });
  ids.unit = units[0]!;
  for (const [i, u] of units.slice(0, 4).entries()) {
    const edition = await add(catalog, 'mendy', 'keeper', 'text', { kind: 'edition', unit: u, language: 'he' });
    for (let p = 0; p < 4; p++) await add(catalog, 'mendy', 'keeper', 'segment', { text: edition, order: `V${p}`, kind: 'paragraph', content: `פסקה ${p} של שיחה ${i + 1}`, proofread: p === 0 ? 1 : 0 });
    if (i === 0) {
      const english = await add(catalog, 'mendy', 'keeper', 'text', { kind: 'translation', unit: u, language: 'en', translationOf: edition });
      await add(catalog, 'mendy', 'keeper', 'segment', { text: english, order: 'V0', kind: 'paragraph', content: 'Paragraph 0 of sicha 1', proofread: 0 });
    }
  }
  ids.pub = await add(catalog, 'mendy', 'keeper', 'publication', { kind: 'book-volume', title: { he: 'דפוס ראשון' }, work: ids.work, volume: '1', sets: [set] });
  await registerFile(catalog.db, { sha256: sha('a'), bytes: 5000, mime: 'application/pdf', source: 'contribution', licence: 'cc0', held: true });
  ids.scan = await add(catalog, 'mendy', 'keeper', 'scan', { publication: ids.pub, file: sha('a'), completeness: 'complete' });
  await add(catalog, 'mendy', 'keeper', 'contents-map', { publication: ids.pub, pages: { from: 7, to: 12, scheme: 'printed' }, unit: ids.unit });

  // A farbrengen of six parts, three with files, two sichos said at it, and a hanacha synced to the first part.
  ids.event = await add(catalog, 'mendy', 'keeper', 'event', yudShvat(set), '/events/5742-05-10');
  const recordings: EntityId[] = [];
  for (let part = 1; part <= 6; part++) {
    const file = part <= 3 ? sha(String(part)) : null;
    if (file) await registerFile(catalog.db, { sha256: file, bytes: 900 * part, mime: 'audio/mpeg', source: 'jem', licence: 'unknown', fileClass: 'recording', held: true });
    recordings.push(await add(catalog, 'mendy', 'keeper', 'recording', { event: ids.event, title: { he: `חלק ${part}` }, part, ...(file ? { file } : {}), url: `https://example.org/${part}.mp3`, sets: [set] }));
  }
  ids.recording = recordings[0]!;
  for (const u of units.slice(0, 2)) await add(catalog, 'mendy', 'keeper', 'unit', { ...((await catalog.get(u))!.data as object), events: [ids.event] } as Json);
  const text = await add(catalog, 'mendy', 'keeper', 'text', { kind: 'hanacha', recording: ids.recording, language: 'he' });
  const alignment = await add(catalog, 'mendy', 'keeper', 'alignment', { recording: ids.recording, text, granularity: 'paragraph' });
  for (let i = 0; i < 5; i++) {
    const segment = await add(catalog, 'mendy', 'keeper', 'segment', { text, order: `V${i}`, kind: 'paragraph', content: `פסקה ${i} של ההנחה`, proofread: 1 });
    await add(catalog, 'mendy', 'keeper', 'alignment-span', { alignment, segment, startMs: 60_000 * i, endMs: 60_000 * i + 50_000 });
  }

  // Open suggestions of twenty items each: two people's, one bot import.
  for (const [author, kind] of [['chaim', 'suggestion'], ['mendy', 'suggestion'], ['bot:mafteiach', 'import']] as const) {
    const cs = await catalog.createChangeset(author, { title: `Relabel ${author}`, kind });
    for (const u of units.slice(5, 25)) {
      const data = (await catalog.get(u))!.data as { label: { he: string } };
      await catalog.putRevision(cs.id, author, { id: u, type: 'unit', data: { ...data, label: { he: `${data.label.he} (${author})` } } as Json });
    }
    const row = await catalog.submit(cs.id, author);
    if (author === 'chaim') suggestion = row.number!;
  }

  // Every statement the API sends is counted, whatever page asks.
  const db = catalog.db as Db & { query: Db['query'] };
  const query = db.query.bind(db);
  db.query = ((sql: string, params?: readonly unknown[]) => {
    counts.statements++;
    const shape = sql.replace(/\s+/g, ' ').trim().slice(0, 90);
    counts.shapes.set(shape, (counts.shapes.get(shape) ?? 0) + 1);
    return query(sql, params);
  }) as Db['query'];

  api = createApp({ catalog, reportSalt: 'test', filesBaseUrl: 'https://files.rebbehub.test', siteUrl: SITE });
  handle = createSiteHandler(build, {
    apiUrl: 'http://api.test',
    siteUrl: SITE,
    fetch: (input, init) => {
      counts.calls++;
      const route = input.replace(/^http:\/\/api\.test/, '').replace(/rh-[0-9a-z]+/g, 'rh-…').replace(/=[^&]*/g, '=…');
      counts.routes.set(route, (counts.routes.get(route) ?? 0) + 1);
      return Promise.resolve(api.request(input, init));
    },
  });
}, 180_000);

afterAll(() => {
  // What each cost, and what it asked, for whoever raises a ceiling (shown with --reporter=verbose --silent=false): the table docs/operations.md keeps.
  const rows = measured.map((m) => [`${String(m.statements).padStart(10)}  ${String(m.calls).padStart(5)}  ${String(m.kB).padStart(5)}  ${String(m.status).padStart(6)}  ${m.what}`, ...m.routes.map((r) => `${' '.repeat(35)}${r}`)].join('\n'));
  console.log(['', 'statements  calls     kB  status  page', ...rows].join('\n'));
});

/** An item's page: at its path, or at /<id> for one made without a path of its own (lib/links.ts itemPath). */
const pathOf = async (id: EntityId) => (await catalog.get(id))!.path ?? `/${id}`;

async function page(path: string) {
  reset();
  const response = await handle(new Request(`${SITE}${path}`));
  const kB = Math.round(new TextEncoder().encode(await response.text()).length / 1024);
  const routes = [...counts.routes.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${n} × GET ${r}`);
  const top = [...[...counts.shapes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s, n]) => `${n} × ${s}`), ...routes];
  measured.push({ what: path, statements: counts.statements, calls: counts.calls, kB, status: response.status, routes });
  return { status: response.status, statements: counts.statements, calls: counts.calls, kB, top };
}

async function route(path: string) {
  reset();
  const response = await api.request(path, { headers: { accept: 'application/json' } });
  const kB = Math.round(new TextEncoder().encode(await response.text()).length / 1024);
  measured.push({ what: `API ${path}`, statements: counts.statements, calls: 0, kB, status: response.status, routes: [] });
  return { status: response.status, statements: counts.statements, kB };
}

/** A page may cost this much (statements, API calls, kilobytes sent); a PR that needs more raises it here, on purpose. */
function within(got: { status: number; statements: number; calls?: number; kB: number; top?: string[] }, what: string, budget: { statements: number; calls?: number; kB?: number }) {
  expect(got.status, what).toBe(200);
  const note = `${what}: ${got.statements} statements (ceiling ${budget.statements})${got.calls === undefined ? '' : `, ${got.calls} API calls (ceiling ${budget.calls})`}, ${got.kB} kB (ceiling ${budget.kB})${got.top ? `\n  ${got.top.join('\n  ')}` : ''}`;
  expect(got.statements, note).toBeLessThanOrEqual(budget.statements);
  if (budget.calls !== undefined) expect(got.calls, note).toBeLessThanOrEqual(budget.calls);
  if (budget.kB !== undefined) expect(got.kB, note).toBeLessThanOrEqual(budget.kB);
}

describe("each page's statements and API calls stay within its ceiling", () => {
  it('the home page', async () => within(await page('/'), 'home', { statements: 55, calls: 18, kB: 60 }));
  it('the sets, and one set', async () => {
    within(await page('/sets'), '/sets', { statements: 12, calls: 7, kB: 30 });
    // A set lists its sefarim and the first sixty of each other kind in it, one request a kind: this one holds four kinds.
    within(await page('/farbrengens'), 'a set', { statements: 28, calls: 18, kB: 50 });
  });
  it('the calendar', async () => within(await page('/calendar'), '/calendar', { statements: 3, calls: 2, kB: 75 }));
  it('a sefer, one volume of it however many sichos, and a sicha in it', async () => {
    within(await page('/igros-sample'), 'a sefer', { statements: 40, calls: 22, kB: 60 });
    // A volume's page is the site's fullest: a request may pass through 32 Workers in all, so this stays well under;
    // and its thirty sichos' words (four kilobytes each) are listed with none of them, or it would be twice the size.
    within(await page('/igros-sample?part=1'), 'a volume', { statements: 45, calls: 28, kB: 100 });
    within(await page(await pathOf(ids.unit)), 'a sicha', { statements: 40, calls: 22, kB: 70 });
  });
  it('a printing and its scan', async () => {
    within(await page(await pathOf(ids.pub)), 'a printing', { statements: 40, calls: 20, kB: 60 });
    within(await page(await pathOf(ids.scan)), 'a scan', { statements: 40, calls: 20, kB: 40 });
  });
  it('a farbrengen, whatever its number of parts or sichos, and one part', async () => {
    within(await page('/events/5742-05-10'), 'a farbrengen', { statements: 45, calls: 24, kB: 65 });
    within(await page(await pathOf(ids.recording)), 'a recording', { statements: 40, calls: 20, kB: 45 });
  });
  it('search, suggestions and review', async () => {
    within(await page(`/search?q=${encodeURIComponent('שיחה')}`), 'search', { statements: 15, calls: 6, kB: 110 });
    within(await page('/suggestions'), '/suggestions', { statements: 8, calls: 3, kB: 35 });
    within(await page(`/suggestions/${suggestion}`), 'a suggestion', { statements: 18, calls: 8, kB: 45 });
    within(await page('/review'), '/review', { statements: 2, calls: 2, kB: 30 });
  });
  it('the sitemap', async () => within(await page('/sitemap.xml'), '/sitemap.xml', { statements: 2, calls: 2, kB: 5 }));
});

describe("the API's heaviest routes", () => {
  it('a page of commits is two or three statements, however many commits', async () => within(await route('/v1/commits?limit=12&changes=3'), 'commits', { statements: 3, kB: 100 }));
  it("a suggestion's page is read alone, not with all its items", async () => within(await route(`/v1/suggestions/${suggestion}?limit=25`), 'a suggestion page', { statements: 10, kB: 5 }));
  it("a farbrengen's parts' hanachos and files are one request each", async () => {
    const parts = (await catalog.children(ids.event, 'event', 'recording', { limit: 10 })).map((r) => r.id);
    within(await route(`/v1/recordings/batch/hanacha?ids=${parts.join(',')}`), 'hanachos', { statements: 4, kB: 5 });
    within(await route(`/v1/files/batch?ids=${[sha('1'), sha('2'), sha('3')].join(',')}`), 'files', { statements: 4, kB: 5 });
  });
  it("the apps' catalog is built once, then asked only whether anything changed", async () => {
    await route('/v1/app/v1/catalog/manifest.json');
    within(await route('/v1/app/v1/catalog/manifest.json'), 'the manifest again', { statements: 1, kB: 5 });
  });
});
