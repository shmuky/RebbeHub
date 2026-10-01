import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type { Catalog } from '@rebbehub/core';
import { idForKey, runImport, sichosKodeshOccasionsImporter, sichosKodeshWorksImporter, type CatalogEntry, type SichosKodeshWorksInput } from '@rebbehub/importers';
import { createApp } from '../src/app.js';
import { appWorks, driveFileOf, occasionDateKey } from '../src/appCatalog.js';
import { add, freshCatalog } from '../../../packages/core/tests/helpers.js';

/**
 * The Sichos Kodesh apps' catalog, served from RebbeHub (appCatalog.ts).
 * A small catalog in Sichos-Kodesh's own format goes in through the
 * importers that read it, and comes back out at the apps' paths: the same
 * farbrengens, works and units, in the shapes their checks accept (the
 * checks below are Sichos-Kodesh's `parseCatalogManifest`,
 * `parseCatalogRelease`, `parseCatalogLibrary` and `parseCatalogWorks`, as
 * far as they go).
 */

const LETTER = '<article dir="rtl" lang="he"><h1>אגרת א</h1><p>ב״ה, <b>ה׳ ניסן</b></p><p>שלום וברכה!<br>נתקבל מכתבו.</p></article>';
const LETTER_SHA = createHash('sha256').update(LETTER).digest('hex');

/** Three farbrengens as the apps' catalog has them: two parts and two hanachos (the hanacha first, as in nearly all of theirs); a second one that day; one in Adar II. */
const farbrengens = (): CatalogEntry[] => [
  {
    occasionId: 11113014,
    hebrewYear: 5714,
    hebrewDate: '5714-03-19',
    occasionLabel: 'י"ט כסלו',
    occasionLabelEn: '19 Kislev',
    audio: [
      { workerFilename: 'AR0016657.mp3', durationMs: 359523, chapterName: 'Two Nigunim', chapterNameHe: 'שני ניגונים' },
      { workerFilename: 'AR0016658.mp3', durationMs: 610351, chapterName: 'Sicha 1' },
    ],
    pdfs: [
      { section: 'biltiMugah', label: 'תו"מ התוועדויות', driveFileId: '1tk7tznpZCW0cyFVuNPcwYZMaqzSIC9oO', resourceKey: '0-Xqz7bN0vTC1CZxMnwXcPeg' },
      { section: 'mugah', label: 'לקו"ש', driveFileId: '1KgxR1B-ab3l4kp_VMg-1WgudgSZpxfdJ' },
    ],
  },
  { occasionId: 11113015, hebrewYear: 5714, hebrewDate: '5714-03-19b', occasionLabel: 'י"ט כסלו, סעודה', audio: [], pdfs: [] },
  { occasionId: 11141001, hebrewYear: 5741, hebrewDate: '5741-06B-14', occasionLabel: 'פורים', audio: [{ workerFilename: 'AR1.mp3', durationMs: 1000, kind: 'shiur', chapterName: 'Shiur' }], pdfs: [] },
];

/** The works as the phone's catalog has them: an imported sefer in two levels, letters with their texts, and a collection's sefer. */
const works = (): SichosKodeshWorksInput => ({
  index: {
    authors: [
      { id: 'alter-rebbe', name: { he: 'אדמו״ר הזקן', en: 'The Alter Rebbe' }, rebbe: 1 },
      { id: 'the-rebbe', name: { he: 'הרבי', en: 'The Rebbe' }, rebbe: 7 },
    ],
    works: [
      {
        id: 'tanya',
        title: { he: 'תניא', en: 'Tanya' },
        authors: ['alter-rebbe'],
        genre: 'chassidus',
        levels: ['part', 'chapter'],
        sources: [
          { source: 'sefaria', sourceId: 'Tanya', kind: 'text', language: 'he', licence: 'cc-by-nc', rights: 'ship-with-credit', credit: 'Sefaria' },
          { source: 'chabadlibrary', sourceId: '3400000000', kind: 'text', language: 'he', licence: 'free-to-read', rights: 'link-only' },
        ],
      },
      {
        id: 'igros-kodesh-rebbe',
        title: { he: 'אגרות קודש', en: 'Igros Kodesh' },
        authors: ['the-rebbe'],
        genre: 'igros',
        levels: ['volume', 'letter'],
        sources: [{ source: 'igros-app', sourceId: 'igros', kind: 'text', language: 'he', licence: 'unknown', rights: 'ship' }],
      },
      {
        id: 'likkutei-sichos',
        title: { he: 'לקוטי שיחות', en: 'Likkutei Sichos' },
        authors: ['the-rebbe'],
        genre: 'sichos',
        levels: ['volume', 'sicha'],
        collection: 'likkuteiSichos',
        sources: [{ source: 'mafteiach', sourceId: 'likkutei-sichos', kind: 'pdf', licence: 'facts-and-links', rights: 'ship' }],
      },
    ],
  },
  contents: [
    {
      workId: 'tanya',
      contents: [
        { title: { he: 'ליקוטי אמרים', en: 'Likkutei Amarim' }, entries: [{ unitId: 'la-1' }, { unitId: 'la-2' }] },
        { title: { he: 'שער היחוד והאמונה', en: 'Shaar HaYichud VehaEmunah' }, entries: [{ unitId: 'shy-1' }] },
      ],
      units: [
        { id: 'la-1', label: 'ליקוטי אמרים, פרק א׳', labelEn: 'Likkutei Amarim, chapter 1', ref: 'Tanya, Part I; Likkutei Amarim 1', editions: [{ source: 0 }] },
        { id: 'la-2', label: 'ליקוטי אמרים, פרק ב׳', editions: [{ source: 0 }, { source: 1 }] },
        { id: 'shy-1', label: 'שער היחוד והאמונה, פרק א׳', editions: [{ source: 1 }] },
      ],
    },
    {
      workId: 'igros-kodesh-rebbe',
      contents: [{ title: { he: 'חלק א', en: 'Volume 1' }, entries: [{ unitId: '1-1' }] }],
      units: [{ id: '1-1', label: 'אגרת א', editions: [{ source: 0, sha256: LETTER_SHA }] }],
    },
  ],
  texts: new Map([[LETTER_SHA, LETTER]]),
});

// ------------------------------------------------------------------ Sichos-Kodesh's checks

const isRecord = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const optString = (v: unknown) => v === undefined || typeof v === 'string';
const VERSION = /^\d+\.\d+\.\d+$/;

/** `parseCatalogManifest`: what an app needs before it acts on a manifest. */
function isManifest(m: any): boolean {
  return isRecord(m) && typeof m.schemaVersion === 'number' && VERSION.test(m.version) && typeof m.releasedAt === 'string' && /^https?:\/\//.test(m.url) && typeof m.bytes === 'number' && typeof m.sha256 === 'string' && Array.isArray(m.years) && typeof m.occasions === 'number' && Array.isArray(m.changelog) && m.changelog.every((e: any) => VERSION.test(e.version) && typeof e.date === 'string' && Array.isArray(e.en) && Array.isArray(e.he));
}

/** `isCatalogEntry`. */
function isEntry(e: any): boolean {
  if (!isRecord(e) || typeof e.occasionId !== 'number' || typeof e.hebrewYear !== 'number' || typeof e.hebrewDate !== 'string' || typeof e.occasionLabel !== 'string') return false;
  if (!optString(e.occasionLabelEn) || !Array.isArray(e.audio) || !Array.isArray(e.pdfs)) return false;
  return e.audio.every((a: any) => isRecord(a) && typeof a.workerFilename === 'string' && typeof a.durationMs === 'number' && optString(a.chapterName) && optString(a.chapterNameHe)) && e.pdfs.every((p: any) => isRecord(p) && typeof p.section === 'string' && typeof p.label === 'string' && typeof p.driveFileId === 'string');
}

/** `parseCatalogRelease`. */
function isRelease(r: any, schema: number): boolean {
  if (!isRecord(r) || r.schemaVersion !== schema || !VERSION.test(r.version) || typeof r.releasedAt !== 'string' || !isRecord(r.byYear)) return false;
  return Object.entries(r.byYear).every(([year, entries]) => Number.isInteger(Number(year)) && Array.isArray(entries) && entries.every(isEntry));
}

const LIBRARY_IDS = ['likkuteiSichos', 'maamorim', 'yomanim', 'hadranim', 'michtavimKlolim', 'reshimos', 'jemEvents'];

/** `parseCatalogLibrary`. */
function isLibrary(l: any): boolean {
  if (!isRecord(l) || !isRecord(l.collections) || !Array.isArray(l.moadim) || !Array.isArray(l.parshiyos)) return false;
  if ('igros' in l.collections || 'maanos' in l.collections) return false;
  return LIBRARY_IDS.every((id) => isRecord(l.collections[id]) && Array.isArray(l.collections[id].items) && isRecord(l.collections[id].groups));
}

/** `parseCatalogWorks`: authors, works with their sources, and each contents part checked against its work. */
function isWorks(w: any): boolean {
  if (!isRecord(w) || !Array.isArray(w.authors) || !Array.isArray(w.works) || !isRecord(w.contents)) return false;
  const names = (n: any) => isRecord(n) && typeof n.he === 'string' && typeof n.en === 'string';
  if (!w.authors.every((a: any) => typeof a.id === 'string' && names(a.name) && (a.rebbe === undefined || typeof a.rebbe === 'number'))) return false;
  const source = (s: any) => typeof s.source === 'string' && typeof s.sourceId === 'string' && ['text', 'scan', 'pdf', 'audio', 'video'].includes(s.kind) && (s.language === undefined || ['he', 'en', 'yi'].includes(s.language)) && typeof s.licence === 'string' && ['ship', 'ship-with-credit', 'link-only', 'local-only'].includes(s.rights) && optString(s.credit) && optString(s.version);
  const work = (x: any) => typeof x.id === 'string' && x.id && names(x.title) && typeof x.genre === 'string' && x.authors.every((a: any) => typeof a === 'string') && x.levels.every((l: any) => typeof l === 'string') && optString(x.collection) && x.sources.every(source) && (x.units === undefined || typeof x.units === 'number');
  if (!w.works.every(work) || new Set(w.works.map((x: any) => x.id)).size !== w.works.length) return false;
  const byId = new Map(w.works.map((x: any) => [x.id, x]));
  return Object.entries(w.contents).every(([id, part]: [string, any]) => {
    const x: any = byId.get(id);
    if (!x || part.workId !== id || !Array.isArray(part.units) || !Array.isArray(part.contents)) return false;
    const unitOk = (u: any) => typeof u.id === 'string' && u.id && typeof u.label === 'string' && optString(u.labelEn) && optString(u.ref) && u.editions.every((e: any) => Number.isInteger(e.source) && e.source >= 0 && e.source < x.sources.length && (e.sha256 === undefined || /^[0-9a-f]{64}$/.test(e.sha256)));
    if (!part.units.every(unitOk)) return false;
    const ids = new Set(part.units.map((u: any) => u.id));
    if (ids.size !== part.units.length) return false;
    const entry = (e: any): boolean => (typeof e.unitId === 'string' ? ids.has(e.unitId) : names(e.title) && e.entries.every(entry));
    return part.contents.every(entry);
  });
}

// ------------------------------------------------------------------ the tests

let app: Hono;
let catalog: Catalog;

const get = async (path: string) => {
  const response = await app.request(`https://api.rebbehub.test${path}`);
  const text = await response.text();
  return { status: response.status, headers: response.headers, text, body: /json/.test(response.headers.get('Content-Type') ?? '') ? JSON.parse(text) : text };
};

beforeEach(async () => {
  ({ catalog } = await freshCatalog());
  await runImport(catalog, sichosKodeshOccasionsImporter(farbrengens()), { approveAs: 'shmuly' });
  await runImport(catalog, sichosKodeshWorksImporter(works()), { approveAs: 'shmuly' });
  const texts = new Map([[`texts/${LETTER_SHA}`, LETTER]]);
  const store = { get: async (key: string) => (texts.has(key) ? { body: new Response(texts.get(key)).body!, size: texts.get(key)!.length } : null) };
  app = createApp({ catalog, texts: { store, writer: { put: async () => {} } } });
});

describe("the apps' manifests", () => {
  it('describes each schema as the apps read it, and points at its own catalog.json', async () => {
    const head = await catalog.head();
    for (const schema of [1, 2, 3]) {
      const { status, body, headers } = await get(`/v1/app/v${schema}/catalog/manifest.json`);
      expect(status).toBe(200);
      expect(isManifest(body)).toBe(true);
      expect(body).toMatchObject({ schemaVersion: schema, years: [5714, 5741], occasions: 3 });
      expect(body.url).toBe(`https://api.rebbehub.test/v1/app/v${schema}/catalog/${body.version}/catalog.json`);
      expect(body.changelog[0].version).toBe(body.version);
      expect(headers.get('Cache-Control')).toBe('public, max-age=300, s-maxage=300');
      expect(headers.get('Access-Control-Allow-Origin')).toBe('*');
    }
    // The farbrengens are all there: numbered after the last commit, newer than any catalog Sichos-Kodesh made.
    expect((await get('/v1/app/v1/catalog/manifest.json')).body).toMatchObject({ version: `2.${head}.0` });
    expect((await get('/v1/app/v1/catalog/manifest.json')).body.missing).toBeUndefined();
    // RebbeHub holds no library yet: served empty, and numbered so no app takes it in place of its own.
    const v3 = (await get('/v1/app/v3/catalog/manifest.json')).body;
    expect(v3).toMatchObject({ version: `0.${head}.0`, missing: ['library'], works: { works: 3, units: 4 } });
    expect(v3.collections).toEqual(Object.fromEntries(LIBRARY_IDS.map((id) => [id, 0])));
  });

  it("gives the changelog alone, and sends 'latest' to the served version", async () => {
    const manifest = (await get('/v1/app/v2/catalog/manifest.json')).body;
    expect((await get('/v1/app/v2/catalog/changelog.json')).body).toEqual(manifest.changelog);
    const latest = await app.request('https://api.rebbehub.test/v1/app/v2/catalog/latest/catalog.json');
    expect(latest.status).toBe(302);
    expect(latest.headers.get('Location')).toBe(manifest.url);
    expect((await get('/v1/app/v4/catalog/manifest.json')).status).toBe(404);
  });

  it('moves to a new version when a farbrengen changes, and not for anything the apps do not show', async () => {
    const before = (await get('/v1/app/v1/catalog/manifest.json')).body.version;
    const set = (await catalog.resolvePath('/sets/farbrengens'))!.id;
    await add(catalog, 'mendy', 'shmuly', 'topic', { name: { he: 'אהבת ישראל' } });
    expect((await get('/v1/app/v1/catalog/manifest.json')).body.version).toBe(before);
    const id = await idForKey('mafteiach-occasion:11113015');
    const event = (await catalog.get(id))!;
    const cs = await catalog.createChangeset('mendy', { title: 'English name' });
    await catalog.putRevision(cs.id, 'mendy', { id, type: 'event', data: { ...(event.data as object), title: { he: 'י"ט כסלו, סעודה', en: '19 Kislev, the meal' }, sets: [set] }, path: event.path ?? undefined });
    await catalog.submit(cs.id, 'mendy');
    await catalog.merge(cs.id, 'shmuly');
    const after = (await get('/v1/app/v1/catalog/manifest.json')).body;
    expect(after.version).toBe(`2.${await catalog.head()}.0`);
    expect(after.version).not.toBe(before);
    const file = (await get(new URL(after.url).pathname)).body;
    expect(file.byYear[5714][1]).toMatchObject({ occasionId: 11113015, occasionLabelEn: '19 Kislev, the meal' });
  });
});

describe("the apps' catalog.json", () => {
  it('is byte for byte what the manifest describes, cached for good', async () => {
    for (const schema of [1, 2, 3]) {
      const manifest = (await get(`/v1/app/v${schema}/catalog/manifest.json`)).body;
      const { status, text, headers, body } = await get(new URL(manifest.url).pathname);
      expect(status).toBe(200);
      expect(createHash('sha256').update(text).digest('hex')).toBe(manifest.sha256);
      expect(Buffer.byteLength(text)).toBe(manifest.bytes);
      expect(headers.get('ETag')).toBe(`"${manifest.sha256}"`);
      expect(headers.get('Cache-Control')).toContain('immutable');
      expect(isRelease(body, schema)).toBe(true);
      expect(body).toMatchObject({ version: manifest.version, releasedAt: manifest.releasedAt });
      expect('library' in body).toBe(schema >= 2);
      expect('works' in body).toBe(schema >= 3);
      if (schema >= 2) expect(isLibrary(body.library)).toBe(true);
      if (schema >= 3) expect(isWorks(body.works)).toBe(true);
    }
    expect((await get('/v1/app/v1/catalog/9.9.9/catalog.json')).status).toBe(404);
  });

  it('gives back the farbrengens as the apps had them', async () => {
    const manifest = (await get('/v1/app/v1/catalog/manifest.json')).body;
    const { byYear } = (await get(new URL(manifest.url).pathname)).body;
    const expected = farbrengens();
    expect(byYear[5714]).toEqual([expected[0], expected[1]]);
    // Adar II's date key, and a shiur that keeps its kind.
    expect(byYear[5741]).toEqual([expected[2]]);
  });

  it('gives back the works, their authors, and each sefer its contents and units, with the texts the apps may fetch', async () => {
    const manifest = (await get('/v1/app/v3/catalog/manifest.json')).body;
    const { works: out } = (await get(new URL(manifest.url).pathname)).body;
    const expected = works();
    expect(out.authors).toEqual(expected.index.authors);
    expect(out.works.map((w: any) => w.id)).toEqual(['igros-kodesh-rebbe', 'likkutei-sichos', 'tanya']);
    const byId = Object.fromEntries(out.works.map((w: any) => [w.id, w]));
    for (const w of expected.index.works) {
      const units = expected.contents.find((c) => c.workId === w.id)?.units.length;
      expect(byId[w.id]).toEqual({ ...w, ...(units ? { units } : {}) });
    }
    // Only the imported sefarim have a contents part; the collection's sefer is read from the library.
    expect(Object.keys(out.contents).sort()).toEqual(['igros-kodesh-rebbe', 'tanya']);
    for (const part of expected.contents) expect(out.contents[part.workId]).toEqual({ workId: part.workId, contents: part.contents, units: part.units });
  });

  it('serves the texts where the apps look for them', async () => {
    const text = await get(`/v1/app/v3/texts/${LETTER_SHA}`);
    expect(text.status).toBe(200);
    expect(text.text).toBe(LETTER);
    expect(text.headers.get('Content-Security-Policy')).toBe('sandbox');
    expect((await get(`/v1/app/v3/texts/${'0'.repeat(64)}`)).status).toBe(404);
  });

  it("sends the phone's own updates on to Sichos-Kodesh's app server", async () => {
    const latest = await app.request('https://api.rebbehub.test/v1/app/v1/app/android/latest.json');
    expect(latest.status).toBe(307);
    expect(latest.headers.get('Location')).toBe('https://api.sk.shmuky.dev/v1/app/android/latest.json');
    const apk = await app.request('https://api.rebbehub.test/v1/app/v1/app/android/download/universal');
    expect(apk.headers.get('Location')).toBe('https://api.sk.shmuky.dev/v1/app/android/download/universal');
  });
});

describe('official sefarim and additions in the works', () => {
  it('lists the official sefarim first, then the additions, each naming the sefer it belongs to', () => {
    const work = (id: string, slug: string, extra: Record<string, unknown> = {}) => ({ id, path: `/${slug}`, data: { title: { he: slug }, slug, authors: [], genre: 'chassidus', levels: [], ...extra } as never });
    const out = appWorks([], [work('rh-a', 'biur', { addition: { kind: 'commentary', to: 'rh-t' } }), work('rh-l', 'loose', { addition: { kind: 'other' } }), work('rh-t', 'tanya', { externalIds: { 'sichos-kodesh-work': 'tanya' } })], []);
    expect(out.works.map((w) => [w.id, w.addition ?? null])).toEqual([
      ['tanya', null],
      ['biur', { kind: 'commentary', to: 'tanya' }],
      ['loose', { kind: 'other' }],
    ]);
  });
});

describe('reading dates and Drive links back', () => {
  it("rebuilds mafteiach's date key from the path, or else from the date and the order that day", () => {
    expect(occasionDateKey('/events/5741-06b-14', {})).toBe('5741-06B-14');
    expect(occasionDateKey('/events/5711-05-00', {})).toBe('5711-05-00');
    expect(occasionDateKey('/somewhere/else', { date: '5711-01-09', order: 1 })).toBe('5711-01-09b');
    expect(occasionDateKey(null, { date: '5721-12' })).toBe('5721-12-00');
    expect(occasionDateKey(null, { date: '5721' })).toBeNull();
  });

  it('reads Drive file ids and resource keys from each form of link', () => {
    expect(driveFileOf('https://drive.google.com/file/d/1tk7tznpZCW0cyFVuNPcwYZMaqzSIC9oO/view?resourcekey=0-X')).toEqual({ driveFileId: '1tk7tznpZCW0cyFVuNPcwYZMaqzSIC9oO', resourceKey: '0-X' });
    expect(driveFileOf('https://drive.google.com/open?id=1tk7tznpZCW0cyFVuNPcwYZMaqzSIC9oO')).toEqual({ driveFileId: '1tk7tznpZCW0cyFVuNPcwYZMaqzSIC9oO' });
    expect(driveFileOf('https://proxy.test/drive/1tk7tznpZCW0cyFVuNPcwYZMaqzSIC9oO?filename=x.pdf')).toEqual({ driveFileId: '1tk7tznpZCW0cyFVuNPcwYZMaqzSIC9oO' });
    expect(driveFileOf('https://hebrewbooks.org/1234')).toBeNull();
  });
});
