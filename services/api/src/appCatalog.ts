import type { Context, Hono } from 'hono';
import { CatalogError, type Catalog } from '@rebbehub/core';
import { parseDateKey } from '@rebbehub/hebrew';
import { defaultRightsState, jemAudioFile, decisionFromRightsState, type CatalogSourceId, type EditionData, type EventData, type Licence, type LocalName, type RecordingData, type RightsState, type UnitData, type WorkData } from '@rebbehub/model';

/**
 * The Sichos Kodesh apps' catalog, served from RebbeHub (docs/sichos-kodesh.md,
 * "The apps' catalog address"). The apps fetch their catalog from one
 * address (app-core's `CATALOG_API_BASE_URL`, today api.sk.shmuky.dev):
 * a small manifest under `/v<schema>/catalog/manifest.json` once a day,
 * and the `catalog.json` it points at when it names a newer version. Here
 * the same paths sit under `/v1/app`, in the same shapes, built from
 * RebbeHub's own items, so switching the apps over is changing that one
 * address:
 *
 *   /v1/app/v1/catalog/...   schema 1: the farbrengens by year (the web app)
 *   /v1/app/v2/catalog/...   schema 2: the same, plus the library
 *   /v1/app/v3/catalog/...   schema 3: the same, plus the works (the phone)
 *   /v1/app/v3/texts/<sha256>              a sefer's text, as /v1/texts gives it
 *   /v1/app/v1/app/android/...             the phone's own updates, sent on to Sichos-Kodesh
 *
 * The shapes are Sichos-Kodesh's (its packages/catalog/src/release.ts,
 * types.ts, library/types.ts and works/types.ts), checked there by
 * `parseCatalogManifest` and `parseCatalogReleaseFile`: one malformed entry
 * and the app keeps what it has, so every field here is what those checks
 * ask for.
 *
 * The version is RebbeHub's: `2.<commit>.0`, the last commit that changed
 * a farbrengen, recording, sefer, unit or author, so the apps download a
 * new catalog only when something they show has changed, and every one is
 * newer than any catalog Sichos-Kodesh made itself (1.x). A part the app
 * needs that RebbeHub does not hold yet - the library, today - is served
 * empty, and the release is then numbered `0.<commit>.0`: older than what
 * every app already has, so no app ever swaps its own library for an
 * empty one. The manifest says which parts are missing (`missing`).
 */

// ------------------------------------------------------------------ the app's shapes

/** One recording part of a farbrengen (its `CatalogAudio`). */
export interface AppAudio {
  workerFilename: string;
  durationMs: number;
  kind?: 'shiur' | 'chazara';
  chapterName?: string;
  chapterNameHe?: string;
}

export type AppPdfSection = 'mugah' | 'biltiMugah' | 'maamorim' | 'hagahos' | 'hosofos';

/** One hanacha or edition of a farbrengen, on Google Drive (its `CatalogPdf`). */
export interface AppPdf {
  section: AppPdfSection;
  label: string;
  driveFileId: string;
  resourceKey?: string;
}

/** One farbrengen (its `CatalogEntry`). */
export interface AppEntry {
  occasionId: number;
  hebrewYear: number;
  hebrewDate: string;
  occasionLabel: string;
  occasionLabelEn?: string;
  audio: AppAudio[];
  pdfs: AppPdf[];
}

export interface AppNames {
  he: string;
  en: string;
}

export type AppRights = 'ship' | 'ship-with-credit' | 'link-only' | 'local-only';

export interface AppWorkSource {
  source: string;
  sourceId: string;
  kind: 'text' | 'scan' | 'pdf' | 'audio' | 'video';
  language?: 'he' | 'en' | 'yi';
  licence: string;
  rights: AppRights;
  credit?: string;
  version?: string;
}

export interface AppWork {
  id: string;
  title: AppNames;
  authors: string[];
  genre: string;
  levels: string[];
  collection?: string;
  sources: AppWorkSource[];
  units?: number;
}

export interface AppUnit {
  id: string;
  label: string;
  labelEn?: string;
  ref?: string;
  editions: Array<{ source: number; sha256?: string }>;
}

export type AppContentsEntry = { unitId: string } | { title: AppNames; entries: AppContentsEntry[] };

export interface AppWorks {
  authors: Array<{ id: string; name: AppNames; rebbe?: number }>;
  works: AppWork[];
  contents: Record<string, { workId: string; contents: AppContentsEntry[]; units: AppUnit[] }>;
}

/** The library's collections (its `LIBRARY_COLLECTION_IDS`), which RebbeHub does not hold yet. */
export const LIBRARY_COLLECTION_IDS = ['likkuteiSichos', 'maamorim', 'yomanim', 'hadranim', 'michtavimKlolim', 'reshimos', 'jemEvents'] as const;

export interface AppLibrary {
  moadim: Array<{ slug: string; name: string; nameEn?: string; occasionIds: number[] }>;
  parshiyos: Array<{ slug: string; name: string; nameEn?: string; occasionIds: number[] }>;
  collections: Record<(typeof LIBRARY_COLLECTION_IDS)[number], { items: unknown[]; groups: Record<string, unknown[]> }>;
}

export interface AppChangelogEntry {
  version: string;
  date: string;
  en: string[];
  he: string[];
}

export interface AppManifest {
  schemaVersion: number;
  version: string;
  releasedAt: string;
  url: string;
  bytes: number;
  sha256: string;
  years: number[];
  occasions: number;
  changelog: AppChangelogEntry[];
  collections?: Record<string, number>;
  works?: { works: number; units: number };
  /** RebbeHub's own: the parts this release lacks, which keep it from being offered to the apps (see the top). */
  missing?: string[];
}

export const APP_SCHEMAS = [1, 2, 3] as const;
export type AppSchema = (typeof APP_SCHEMAS)[number];

/** A complete release's major version: newer than every catalog Sichos-Kodesh numbered itself (1.x). */
export const APP_CATALOG_MAJOR = 2;

/** Where the phone's own updates (the APKs) are, until RebbeHub serves them. */
export const SICHOS_KODESH_APP_SERVER = 'https://api.sk.shmuky.dev';

// ------------------------------------------------------------------ from RebbeHub's items

interface Row<T> {
  id: string;
  path: string | null;
  data: T;
}

const SECTIONS: Partial<Record<string, AppPdfSection>> = { mugah: 'mugah', 'bilti-mugah': 'biltiMugah', maamar: 'maamorim', hagahos: 'hagahos', hosofos: 'hosofos' };
const EVENT_PATH = /^\/events\/(\d{4})-(0[1-9]|1[0-2]|06a|06b)-(\d{2})([a-z]?)$/;
const KINDS = new Set(['text', 'scan', 'pdf', 'audio', 'video']);
const LANGUAGES = new Set(['he', 'en', 'yi']);

/** The Drive file a link names, and its resource key: `drive.google.com/file/d/<id>/view`, `?id=<id>`, or a proxy's `/drive/<id>`. */
export function driveFileOf(url: string | undefined): { driveFileId: string; resourceKey?: string } | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const byPath = /\/file\/d\/([\w-]{10,})/.exec(parsed.pathname) ?? /\/drive\/([\w-]{10,})/.exec(parsed.pathname);
  const id = byPath?.[1] ?? (parsed.hostname.endsWith('google.com') ? parsed.searchParams.get('id') : null);
  if (!id) return null;
  const key = parsed.searchParams.get('resourcekey');
  return key ? { driveFileId: id, resourceKey: key } : { driveFileId: id };
}

/**
 * mafteiach's date key for a farbrengen, as the apps key it (`5711-01-09b`,
 * `5741-06B-14`, day `00` when unknown): from its path, which the importer
 * made from that key, or else from its date and its order that day.
 */
export function occasionDateKey(path: string | null, data: Pick<EventData, 'date' | 'order'>): string | null {
  const m = path ? EVENT_PATH.exec(path) : null;
  if (m) return `${m[1]}-${m[2]!.toUpperCase()}-${m[3]}${m[4]}`;
  const parts = data.date ? parseDateKey(data.date) : null;
  if (!parts?.month) return null;
  const day = parts.day === undefined ? '00' : String(parts.day).padStart(2, '0');
  const letter = data.order && data.order > 0 && data.order < 26 ? String.fromCharCode(97 + data.order) : '';
  return `${parts.year}-${parts.month}-${day}${letter}`;
}

/** The JEM file a recording plays: its file on Ashreinu's CDN (or the old media proxy), or its JEM source id. */
function workerFilenameOf(data: RecordingData): string | null {
  const file = jemAudioFile(data.url);
  if (file) return file;
  return data.sources?.find((s) => s.source === 'jem')?.sourceId ?? null;
}

function audioOf(data: RecordingData): AppAudio | null {
  const workerFilename = workerFilenameOf(data);
  if (!workerFilename) return null;
  const audio: AppAudio = { workerFilename, durationMs: typeof data.durationMs === 'number' ? data.durationMs : 0 };
  if (data.note === 'shiur' || data.note === 'chazara') audio.kind = data.note;
  const { he, en } = data.title ?? { he: '' };
  if (en) {
    audio.chapterName = en;
    if (he && he !== en) audio.chapterNameHe = he;
  } else if (he && !/^חלק \d+$/.test(he)) audio.chapterNameHe = he;
  return audio;
}

/** The farbrengens by Hebrew year, in date order: every event mafteiach numbers, with its recordings and its hanachos on Drive. */
export function farbrengensByYear(events: Array<Row<EventData>>, recordings: Array<Row<RecordingData>>): Record<number, AppEntry[]> {
  const parts = new Map<string, Array<Row<RecordingData>>>();
  for (const r of recordings) if (r.data.event) parts.set(r.data.event, [...(parts.get(r.data.event) ?? []), r]);
  const byYear: Record<number, AppEntry[]> = {};
  const seen = new Set<number>();
  for (const e of events) {
    const occasionId = Number(e.data.externalIds?.mafteiach);
    const hebrewDate = occasionDateKey(e.path, e.data);
    if (!Number.isSafeInteger(occasionId) || seen.has(occasionId) || !hebrewDate) continue;
    seen.add(occasionId);
    const hebrewYear = Number(hebrewDate.slice(0, 4));
    const audio = (parts.get(e.id) ?? [])
      .sort((a, b) => (a.data.part ?? Infinity) - (b.data.part ?? Infinity) || (a.id < b.id ? -1 : 1))
      .map((r) => audioOf(r.data))
      .filter((a): a is AppAudio => a !== null);
    const pdfs = (e.data.links ?? []).flatMap((link): AppPdf[] => {
      const section = SECTIONS[link.kind];
      const drive = section ? (driveFileOf(link.origin) ?? driveFileOf(link.url)) : null;
      return section && drive ? [{ section, label: link.label.he, ...drive }] : [];
    });
    // In the order the apps' own files have them.
    const entry: AppEntry = { occasionId, hebrewYear, hebrewDate, occasionLabel: e.data.title.he, ...(e.data.title.en ? { occasionLabelEn: e.data.title.en } : {}), audio, pdfs };
    (byYear[hebrewYear] ??= []).push(entry);
  }
  for (const list of Object.values(byYear)) list.sort((a, b) => (a.hebrewDate < b.hebrewDate ? -1 : a.hebrewDate > b.hebrewDate ? 1 : a.occasionId - b.occasionId));
  return byYear;
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const names = (n: LocalName): AppNames => ({ he: n.he, en: n.en ?? n.he });
const TEXT_COPY = /\/texts\/([0-9a-f]{64})$/;

interface AuthorRow {
  name: LocalName;
  rebbe?: number;
  slug?: string;
  externalIds?: Record<string, string>;
}

/**
 * The works the apps know (each with its Sichos-Kodesh id), their authors,
 * and each one's contents and units as the phone reads them. Ids go back
 * to the apps' own (work and author slugs, the phone's unit ids), so
 * downloads, progress and packs keep working.
 */
export function appWorks(authors: Array<Row<AuthorRow>>, works: Array<Row<WorkData>>, units: Array<Row<UnitData>>): AppWorks {
  const authorIds = new Map(authors.map((a) => [a.id, a.data.slug ?? a.data.externalIds?.['sichos-kodesh-author'] ?? a.id]));
  const byWork = new Map<string, Array<Row<UnitData>>>();
  for (const u of units) byWork.set(u.data.work, [...(byWork.get(u.data.work) ?? []), u]);

  const out: AppWorks = { authors: [], works: [], contents: {} };
  const used = new Set<string>();
  const workIds = new Set<string>();
  // Sichos-Kodesh's registry order is not kept: in the order people gave them, else by id; the Rebbeim in their line.
  const ordered = [...works].sort((a, b) => cmp(a.data.order ?? '\uffff', b.data.order ?? '\uffff') || cmp(a.data.slug, b.data.slug));
  for (const w of ordered) {
    const id = w.data.externalIds?.['sichos-kodesh-work'] ?? w.data.slug;
    if (!id || workIds.has(id)) continue;
    workIds.add(id);
    const list = (byWork.get(w.id) ?? []).sort((a, b) => (a.data.order < b.data.order ? -1 : a.data.order > b.data.order ? 1 : a.id < b.id ? -1 : 1));
    const copies = (w.data.sourceCopies ?? []).filter((s) => KINDS.has(s.kind));
    const sources: AppWorkSource[] = copies.map((s) => {
      const source: AppWorkSource = { source: s.source, sourceId: s.sourceId, kind: s.kind, licence: s.licence, rights: decisionFromRightsState(rightsOf(s.source, s.licence, list)) };
      if (s.language && LANGUAGES.has(s.language)) source.language = s.language as AppWorkSource['language'];
      if (s.credit) source.credit = s.credit;
      if (s.version) source.version = s.version;
      return source;
    });
    const work: AppWork = { id, title: names(w.data.title), authors: w.data.authors.map((a) => authorIds.get(a)).filter((a): a is string => a !== undefined), genre: w.data.genre, levels: w.data.levels, sources };
    for (const a of w.data.authors) used.add(a);
    const collection = w.data.externalIds?.['sichos-kodesh-collection'];
    if (collection) work.collection = collection;
    if (list.length > 0) {
      const part = contentsOf(id, list, sources);
      out.contents[id] = part;
      work.units = part.units.length;
    }
    out.works.push(work);
  }
  const line = (a: Row<AuthorRow>) => a.data.rebbe ?? 8;
  for (const a of [...authors].sort((x, y) => line(x) - line(y) || cmp(authorIds.get(x.id)!, authorIds.get(y.id)!))) {
    if (!used.has(a.id) && !a.data.externalIds?.['sichos-kodesh-author']) continue;
    const author: AppWorks['authors'][number] = { id: authorIds.get(a.id)!, name: names(a.data.name) };
    if (a.data.rebbe) author.rebbe = a.data.rebbe;
    out.authors.push(author);
  }
  return out;
}

/** What may be done with a source's copies: as its units' words were imported (Sichos-Kodesh's own decision), else RebbeHub's default for it. */
function rightsOf(source: CatalogSourceId, licence: Licence, units: Array<Row<UnitData>>): RightsState {
  const decided = units.find((u) => u.data.bodySource?.source === source && u.data.bodySource.rights)?.data.bodySource?.rights;
  return decided ?? defaultRightsState({ source, licence });
}

/** Which of the work's sources an edition is: the same source, language and version, or failing that the nearest. */
function sourceIndex(edition: EditionData, sources: AppWorkSource[]): number {
  const same = (s: AppWorkSource) => s.source === edition.source;
  const lang = (s: AppWorkSource) => (s.language ?? null) === (edition.language ?? null);
  let i = sources.findIndex((s) => same(s) && lang(s) && (s.version ?? null) === (edition.version ?? null));
  if (i < 0) i = sources.findIndex((s) => same(s) && lang(s));
  if (i < 0) i = sources.findIndex(same);
  return i;
}

function contentsOf(workId: string, list: Array<Row<UnitData>>, sources: AppWorkSource[]): AppWorks['contents'][string] {
  // While building, each node keeps its children by position value too; they are dropped at the end.
  interface Building {
    entries: AppContentsEntry[];
    nodes: Map<string, Building & { title: AppNames }>;
  }
  const root: Building = { entries: [], nodes: new Map() };
  const units: AppUnit[] = [];
  const ids = new Set<string>();
  for (const { id, data } of list) {
    const unitId = data.externalIds?.['sichos-kodesh-unit'] ?? id;
    if (ids.has(unitId)) continue;
    ids.add(unitId);
    const unit: AppUnit = { id: unitId, label: data.label.he, editions: [] };
    if (data.label.en) unit.labelEn = data.label.en;
    const ref = data.editions?.find((e) => e.sourceId && e.sourceId !== unitId)?.sourceId;
    if (ref) unit.ref = ref;
    // RebbeHub keeps the text of the unit's first shippable edition (its Hebrew one), at /v1/texts/<sha256>.
    const copy = data.bodySource?.copy ? TEXT_COPY.exec(data.bodySource.copy)?.[1] : undefined;
    const shipped = data.bodySource?.rights === 'open' || data.bodySource?.rights === 'credit';
    let copyAt = -1;
    if (copy && shipped) {
      const candidates = (data.editions ?? []).map((e, i) => ({ e, i })).filter(({ e }) => e.source === data.bodySource!.source);
      copyAt = (candidates.find(({ e }) => e.language === 'he') ?? candidates[0])?.i ?? -1;
    }
    (data.editions ?? []).forEach((e, i) => {
      const source = sourceIndex(e, sources);
      if (source < 0) return;
      unit.editions.push(i === copyAt ? { source, sha256: copy! } : { source });
    });
    units.push(unit);

    let node: Building = root;
    for (const step of data.position.slice(0, -1)) {
      let child = node.nodes.get(step.value);
      if (!child) {
        child = { title: names(step.label ?? { he: step.value }), entries: [], nodes: new Map() };
        node.nodes.set(step.value, child);
        node.entries.push(child as unknown as AppContentsEntry);
      }
      node = child;
    }
    node.entries.push({ unitId });
  }
  const strip = (entries: AppContentsEntry[]): AppContentsEntry[] => entries.map((e) => ('unitId' in e ? { unitId: e.unitId } : { title: e.title, entries: strip(e.entries) }));
  return { workId, contents: strip(root.entries), units };
}

/** The library, which RebbeHub does not hold yet: every collection, empty. */
export function emptyLibrary(): AppLibrary {
  return { moadim: [], parshiyos: [], collections: Object.fromEntries(LIBRARY_COLLECTION_IDS.map((id) => [id, { items: [], groups: {} }])) as unknown as AppLibrary['collections'] };
}

// ------------------------------------------------------------------ releases

interface Parts {
  seq: number;
  releasedAt: string;
  byYear: Record<number, AppEntry[]>;
  library: AppLibrary;
  works: AppWorks;
}

export interface AppRelease {
  manifest: Omit<AppManifest, 'url'>;
  /** `catalog.json`, exactly the bytes `sha256` and `bytes` describe. */
  body: string;
}

async function sha256Hex(text: string): Promise<{ hex: string; bytes: number }> {
  const bytes = new TextEncoder().encode(text);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return { hex: [...digest].map((b) => b.toString(16).padStart(2, '0')).join(''), bytes: bytes.byteLength };
}

/** What a release of `schema` lacks, of what its app shows. */
function missingParts(parts: Parts, schema: AppSchema): string[] {
  const missing: string[] = [];
  if (Object.keys(parts.byYear).length === 0) missing.push('farbrengens');
  if (schema >= 2 && Object.values(parts.library.collections).every((c) => c.items.length === 0)) missing.push('library');
  if (schema >= 3 && parts.works.works.length === 0) missing.push('works');
  return missing;
}

/** One schema's release from the parts: `catalog.json` as `JSON.stringify` writes it, and its manifest. */
export async function releaseOf(parts: Parts, schema: AppSchema): Promise<AppRelease> {
  const missing = missingParts(parts, schema);
  const version = `${missing.length ? 0 : APP_CATALOG_MAJOR}.${parts.seq}.0`;
  const file: Record<string, unknown> = { schemaVersion: schema, version, releasedAt: parts.releasedAt, byYear: parts.byYear };
  if (schema >= 2) file.library = parts.library;
  if (schema >= 3) file.works = parts.works;
  const body = JSON.stringify(file);
  const { hex, bytes } = await sha256Hex(body);
  const years = Object.keys(parts.byYear).map(Number).sort((a, b) => a - b);
  const manifest: AppRelease['manifest'] = {
    schemaVersion: schema,
    version,
    releasedAt: parts.releasedAt,
    bytes,
    sha256: hex,
    years,
    occasions: years.reduce((n, y) => n + parts.byYear[y]!.length, 0),
    changelog: [
      {
        version,
        date: parts.releasedAt.slice(0, 10),
        en: [`The catalog as RebbeHub has it, as of its commit ${parts.seq}`],
        he: [`הקטלוג כפי שהוא ב-RebbeHub, נכון לשינוי ${parts.seq}`],
      },
    ],
  };
  if (schema >= 2) manifest.collections = Object.fromEntries(Object.entries(parts.library.collections).map(([id, c]) => [id, c.items.length]));
  if (schema >= 3) manifest.works = { works: parts.works.works.length, units: Object.values(parts.works.contents).reduce((n, c) => n + c.units.length, 0) };
  if (missing.length) manifest.missing = missing;
  return { manifest, body };
}

const TYPES = ['event', 'recording', 'work', 'unit', 'author'];

/** The last commit that changed anything the apps show, and when it was made. */
async function lastChange(catalog: Catalog): Promise<{ seq: number; at: string }> {
  const { rows } = await catalog.db.query<{ seq: string | number | null; at: string | Date | null }>(
    `SELECT e.seq, c.at FROM (SELECT max(updated_seq) AS seq FROM entity WHERE type = ANY($1)) e LEFT JOIN commit c ON c.seq = e.seq`,
    [TYPES],
  );
  const row = rows[0];
  return { seq: Number(row?.seq ?? 0), at: row?.at ? new Date(row.at).toISOString() : new Date(0).toISOString() };
}

async function rows<T>(catalog: Catalog, where: string, params: unknown[] = []): Promise<Array<Row<T>>> {
  const { rows } = await catalog.db.query<{ id: string; path: string | null; data: T }>(
    `SELECT e.id, e.path, r.data FROM entity e JOIN revision r ON r.id = e.main_rev
     WHERE e.main_rev IS NOT NULL AND NOT e.deleted AND r.data IS NOT NULL AND ${where}
     ORDER BY e.id`,
    params,
  );
  return rows;
}

/** Everything the three schemas are made of, read from main. */
export async function readParts(catalog: Catalog): Promise<Parts> {
  const { seq, at } = await lastChange(catalog);
  const events = await rows<EventData>(catalog, `e.type = 'event' AND r.data->'externalIds'->>'mafteiach' IS NOT NULL`);
  const recordings = await rows<RecordingData>(catalog, `e.type = 'recording' AND r.data->>'event' IS NOT NULL`);
  const works = await rows<WorkData>(catalog, `e.type = 'work' AND r.data->'externalIds'->>'sichos-kodesh-work' IS NOT NULL`);
  const units = works.length ? await rows<UnitData>(catalog, `e.type = 'unit' AND r.data->>'work' = ANY($1)`, [works.map((w) => w.id)]) : [];
  const authors = await rows<AuthorRow>(catalog, `e.type = 'author'`);
  return { seq, releasedAt: at, byYear: farbrengensByYear(events, recordings), library: emptyLibrary(), works: appWorks(authors, works, units) };
}

// ------------------------------------------------------------------ routes

/**
 * Keeps the latest release of each schema in this process, so a burst of
 * phones is one read of the catalog. A Worker makes its app afresh for
 * each request, so it keeps one of these for the life of its isolate
 * (worker.ts) and passes it in; each request then asks the database only
 * whether anything changed (one statement) before serving what was built.
 */
export class AppReleases {
  private built: { seq: number; parts: Promise<Parts>; schemas: Map<AppSchema, Promise<AppRelease>> } | null = null;

  async get(catalog: Catalog, schema: AppSchema): Promise<AppRelease> {
    const { seq } = await lastChange(catalog);
    if (!this.built || this.built.seq !== seq) {
      const parts = readParts(catalog);
      this.built = { seq, parts, schemas: new Map() };
      parts.catch(() => {
        if (this.built?.parts === parts) this.built = null;
      });
    }
    const built = this.built;
    let release = built.schemas.get(schema);
    if (!release) {
      release = built.parts.then((p) => releaseOf(p, schema));
      built.schemas.set(schema, release);
    }
    return release;
  }
}

/** The manifest is read by each app once a day: kept five minutes, as Sichos-Kodesh's own API keeps it. */
const MANIFEST_CACHE = 'public, max-age=300, s-maxage=300';
/** A release's file never changes once made: its address carries its version. */
const CATALOG_CACHE = 'public, max-age=31536000, s-maxage=31536000, immutable';

const SCHEMA = ':schema{v[123]}';
const schemaOf = (c: Context): AppSchema => Number(c.req.param('schema')!.slice(1)) as AppSchema;
const catalogPath = (schema: AppSchema, version: string) => `/v1/app/v${schema}/catalog/${version}/catalog.json`;

export function appCatalogRoutes(app: Hono, catalog: Catalog, releases: AppReleases = new AppReleases()): void {
  const origin = (c: Context) => new URL(c.req.url).origin;

  app.get(`/v1/app/${SCHEMA}/catalog/manifest.json`, async (c) => {
    const schema = schemaOf(c);
    const { manifest } = await releases.get(catalog, schema);
    // `url` points back into this same API, whatever address it was asked at.
    return c.json({ ...manifest, url: `${origin(c)}${catalogPath(schema, manifest.version)}` } satisfies AppManifest, 200, { 'Cache-Control': MANIFEST_CACHE });
  });

  app.get(`/v1/app/${SCHEMA}/catalog/changelog.json`, async (c) => c.json((await releases.get(catalog, schemaOf(c))).manifest.changelog, 200, { 'Cache-Control': MANIFEST_CACHE }));

  app.get(`/v1/app/${SCHEMA}/catalog/latest/catalog.json`, async (c) => {
    const schema = schemaOf(c);
    const { manifest } = await releases.get(catalog, schema);
    return c.redirect(`${origin(c)}${catalogPath(schema, manifest.version)}`, 302);
  });

  app.get(`/v1/app/${SCHEMA}/catalog/:version{\\d+\\.\\d+\\.\\d+}/catalog.json`, async (c) => {
    const { manifest, body } = await releases.get(catalog, schemaOf(c));
    // Only the release being served: an older one is gone, as on Sichos-Kodesh's API.
    if (c.req.param('version') !== manifest.version) throw new CatalogError('not-found', `catalog ${c.req.param('version')} is not served; the manifest names the one that is`);
    return c.body(body, 200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': CATALOG_CACHE,
      ETag: `"${manifest.sha256}"`,
      'X-Catalog-Version': manifest.version,
    });
  });

  // The phone asks the same address for its own updates (app-core's appRelease.ts); those stay with Sichos-Kodesh.
  app.get('/v1/app/v1/app/android/latest.json', (c) => c.redirect(`${SICHOS_KODESH_APP_SERVER}/v1/app/android/latest.json`, 307));
  app.get('/v1/app/v1/app/android/download/:abi{arm64-v8a|armeabi-v7a|universal}', (c) => c.redirect(`${SICHOS_KODESH_APP_SERVER}/v1/app/android/download/${c.req.param('abi')}`, 307));
}
