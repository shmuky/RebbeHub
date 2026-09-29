import { Hono, type Context } from 'hono';
import { Catalog, CatalogError, ExportGate, TAKEDOWN_RESPONSE_DAYS, idsOfUsernames, listSuggestions, UnresolvedConflictError, adviceFor, anchorSync, chooseSeed, claimNext, comparePrintings, confirmPage, confirmSync, createWebhook, deleteWebhook, fileFromDrive, fixLine, fixParagraph, suggestWords, getDerivations, getDerivationsOf, getFile, getFiles, getPageFix, getPageFixes, hanachaSyncs, itemsUsingFile, listWebhooks, pageImageCounts, printingsOf, projectTodo, recordingTranscript, releaseClaim, requestTakedown, scanProgress, scanText, similarFiles, uploadOcr, type ChangesetStatus, type Embedder, type FileRow, type Mailer, type PageFixRow, type TakedownRelation, type EntityView, type Json, type ReportReason, type Resolution, type OcrFormat, type ProjectFocus, type WordsChange, type MetadataFetch } from '@rebbehub/core';
import { peopleOf } from '@rebbehub/core';
import { parseDateText, describeDateKey } from '@rebbehub/hebrew';
import { ENTITY_TYPES, isEntityId, mayServe, readId, sha256Hex, type EntityId, type EntityType, type Language, type PageInline, type PageSegmentKind } from '@rebbehub/model';
import { authRoutes, sessionAuthenticator, type AuthOptions } from './auth.js';
import { adminRoutes } from './admin.js';
import { uploadRoutes, type UploadOptions } from './uploads.js';
import { scanRoutes } from './scans.js';
import { OPENAPI } from './openapi.js';
import { networkRoutes } from './network.js';
import { oaiRoutes, type OaiOptions } from './oai.js';
import { mirrorRoutes, type MirrorOptions } from './mirrors.js';
import { readingRoutes } from './reading.js';
import { tokenGate, tokenGrantOf, tokenRoutes } from './tokens.js';
import { ERROR_CODES, PUBLIC_SUMMARY, caching, cors, cursor, nextLink, type RateLimits } from './platform.js';
import { mcpRoutes } from './mcp.js';
import { oauthRoutes } from './oauth.js';
import { pageRoutes } from './pages.js';
import { driveRoutes, type DriveOptions } from './drive.js';
import { threadRoutes } from './threads.js';
import { organizeRoutes } from './organize.js';
import { appCatalogRoutes, type AppReleases } from './appCatalog.js';
import { machineRoutes, type MachineDispatch } from './machine.js';

/**
 * The RebbeHub API, version 1 (docs/developers/api.md). Reading needs
 * nothing; reporting a problem needs no account (a captcha and a rate
 * limit instead); suggesting and reviewing need a signed-in account: a
 * passkey session from the site's own pages (auth.ts), a personal API
 * token (tokens.ts) or, in tests, whatever `authenticate` says. What
 * every route shares - errors, cursors, ETags, CORS, rate limits - is in
 * platform.ts; the routes and the OpenAPI description (openapi.ts) are
 * kept in step by a test.
 */

export interface ApiOptions {
  catalog: Catalog;
  /** The account a request is signed in as, or null. Unset, the passkey session cookie (with `auth`). */
  authenticate?: (c: Context) => Promise<string | null> | string | null;
  /** Passkey sign-in: where the site is, which passkeys and sessions belong to. Unset, nobody can sign in. */
  auth?: AuthOptions;
  /** The Sichos Kodesh apps' catalog as last built (appCatalog.ts): a Worker keeps one for its isolate's life, across its requests. */
  appReleases?: AppReleases;
  /** Salt for hashing reporters' addresses (only the hash is kept, for rate limits). */
  reportSalt?: string;
  /** Verifies a report's captcha token (Cloudflare Turnstile); unset, reports need none. */
  verifyCaptcha?: (token: string | undefined, ip: string | undefined) => Promise<boolean>;
  /** Reports one address may send per hour. */
  reportsPerHour?: number;
  /** Where servable files are fetched from: `<filesBaseUrl>/objects/<sha256>`. Unset, this API's own address. */
  filesBaseUrl?: string;
  /** Where uploaded bytes are written: the public bucket for files that may be served, the preservation bucket for the rest. Unset, uploads are refused. */
  uploads?: UploadOptions;
  /** The public bucket's bytes (R2 on Workers). With it, this API serves `/objects/<sha256>` itself, for files whose rights allow. */
  files?: FileStore;
  /** Where the texts of seforim are kept (`texts/<sha256>` in the public bucket), and where they are first copied from: Sichos-Kodesh's published archive. */
  texts?: { store: FileStore; writer: { put(key: string, bytes: ArrayBuffer, mime: string): Promise<void> }; from?: FileStore };
  /** Where the catalog is mirrored, and the keys its editions are signed with (mirrors.ts). */
  mirrors?: MirrorOptions;
  /** The site's address (`https://rebbehub.org`), for links home from IIIF manifests. Unset, the passkeys' site, else rebbehub.org. */
  siteUrl?: string;
  version?: string;
  /** Sends email (Resend): sign-in links, and a receipt to whoever asks for a takedown. Unset, no email is sent. */
  mailer?: Mailer;
  /** Turns questions into vectors for search by meaning (Workers AI); unset, that search says it is not available. */
  embedder?: Embedder | null;
  /** OAI-PMH for libraries, at /oai; unset (no administrators' address), it is not offered. */
  oai?: OaiOptions;
  /** Requests allowed per address and per token (platform.ts); unset, none are counted (local work, tests). */
  rateLimits?: RateLimits;
  /** Reading the Google Drive files the catalog links to (drive.ts): how Drive is reached, the size cap, and a limit per address. */
  drive?: DriveOptions;
  /** Reads an app's own description (a Client ID Metadata Document) when it connects with OAuth; unset, fetch. Replaced in tests. */
  fetchClientMetadata?: MetadataFetch;
  /** Starts the free machine jobs when someone asks for OCR or a transcript (GitHub Actions); unset, the nightly run takes the request. */
  machineDispatch?: MachineDispatch;
  /** Lets work finish after the answer is sent (Workers' waitUntil); unset, the answer waits for it. */
  waitUntil?: (work: Promise<unknown>) => void;
}

/** A byte range asked for with `Range: bytes=…`. */
export interface ByteRange {
  offset: number;
  length?: number;
}

/** Where file bytes are kept, by key (`objects/<sha256>`): R2 on Workers, anything else in tests. */
export interface FileStore {
  get(key: string, range?: ByteRange): Promise<{ body: ReadableStream; size: number } | null>;
}

/** `bytes=100-199` → { offset: 100, length: 100 }; `bytes=100-` → { offset: 100 }. Null when absent or not one simple range. */
export function parseRange(header: string | null | undefined, size?: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (!match || (match[1] === '' && match[2] === '')) return null;
  if (match[1] === '') {
    // The last N bytes.
    if (size === undefined) return null;
    const n = Math.min(Number(match[2]), size);
    return { offset: size - n, length: n };
  }
  const offset = Number(match[1]);
  return match[2] === '' ? { offset } : { offset, length: Number(match[2]) - offset + 1 };
}

const REPORT_REASONS: readonly ReportReason[] = ['wrong-fact', 'missing-page', 'bad-scan', 'audio-problem', 'wrong-text', 'duplicate', 'rights', 'offensive', 'other'];
const STATUSES: readonly ChangesetStatus[] = ['draft', 'open', 'merged', 'sent_back', 'withdrawn'];

const STATUS_BY_CODE: Record<CatalogError['code'], 400 | 401 | 403 | 404 | 409 | 422> = {
  'not-found': 404,
  forbidden: 403,
  invalid: 422,
  state: 409,
  conflict: 409,
};

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 405 | 409 | 422 | 429,
    message: string,
  ) {
    super(message);
  }
}

function entityId(raw: string): EntityId {
  const id = readId(raw);
  if (!id) throw new HttpError(400, `"${raw}" is not an id (rh-…)`);
  return id;
}

function intParam(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  if (!/^\d+$/.test(value)) throw new HttpError(400, `${name} must be a whole number`);
  return Number(value);
}

async function body<T>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new HttpError(400, 'the request body must be JSON');
  }
}

export function createApp(options: ApiOptions): Hono {
  const { catalog } = options;
  const app = new Hono();
  const session = options.authenticate ?? (options.auth ? sessionAuthenticator(catalog, options.auth) : undefined);
  // A request's token, when it sent one, is who it is; otherwise its session.
  const authenticate = async (c: Context): Promise<string | null> => tokenGrantOf(c)?.personId ?? (await session?.(c)) ?? null;
  const siteUrl = options.siteUrl ?? options.auth?.origins[0] ?? 'https://rebbehub.org';

  // Words whose rights forbid copies are never served, only listed.
  const redact = (views: EntityView[]): Promise<Array<EntityView & { withheld?: string }>> => {
    const gate = new ExportGate(catalog);
    return Promise.all(views.map((v) => gate.redact(v)));
  };

  const signedIn = async (c: Context): Promise<string> => {
    const account = (await authenticate?.(c)) ?? null;
    if (!account) throw new HttpError(401, 'sign in to do this');
    return account;
  };

  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: ERROR_CODES[error.status] ?? 'bad-request', message: error.message }, error.status);
    if (error instanceof UnresolvedConflictError) return c.json({ error: 'conflict', message: error.message, conflicts: error.conflicts }, 409);
    if (error instanceof CatalogError) return c.json({ error: error.code, message: error.message, detail: error.detail ?? null }, STATUS_BY_CODE[error.code]);
    console.error(error);
    return c.json({ error: 'internal', message: 'something went wrong on our side' }, 500);
  });

  app.use('*', cors());
  app.use('*', caching());
  app.use('*', tokenGate(catalog, options.rateLimits));

  if (options.auth) authRoutes(app, catalog, options.mailer && !options.auth.mailer ? { ...options.auth, mailer: options.mailer } : options.auth);
  adminRoutes(app, catalog, signedIn);
  tokenRoutes(app, catalog, signedIn);
  mcpRoutes(app, { siteUrl, version: options.version ?? API_VERSION });
  oauthRoutes(app, catalog, signedIn, { siteUrl, fetchClientMetadata: options.fetchClientMetadata });
  const filesBase = (c: Context) => options.filesBaseUrl ?? (options.files ? new URL(c.req.url).origin : null);
  uploadRoutes(app, catalog, signedIn, options.uploads, filesBase);
  pageRoutes(app, catalog, { filesBase });
  driveRoutes(app, catalog, options.drive);
  networkRoutes(app, catalog, { embedder: options.embedder });
  if (options.oai) oaiRoutes(app, catalog, options.oai);
  readingRoutes(app, catalog, signedIn, (status, message) => {
    throw new HttpError(status, message);
  });
  mirrorRoutes(app, catalog, { mirrors: options.mirrors, files: options.files });
  threadRoutes(app, catalog, signedIn, authenticate);
  organizeRoutes(app, catalog, signedIn);
  appCatalogRoutes(app, catalog, options.appReleases);
  machineRoutes(app, catalog, signedIn, { dispatch: options.machineDispatch, waitUntil: options.waitUntil ? (_c, work) => options.waitUntil!(work) : undefined });
  scanRoutes(app, catalog, {
    filesBase,
    siteUrl,
    signedIn,
    authenticate,
    reportSalt: options.reportSalt,
    verifyCaptcha: options.verifyCaptcha,
    reportsPerHour: options.reportsPerHour,
  });

  app.get('/', (c) => c.redirect('/v1'));
  app.get('/openapi.json', (c) => c.json(OPENAPI, 200, { 'Cache-Control': 'public, max-age=300' }));
  // For AI agents: what this API is and where its tools are (the site's /llms.txt says more).
  app.get('/llms.txt', (c) => c.text(apiLlmsTxt(new URL(c.req.url).origin, siteUrl), 200, { 'Cache-Control': 'public, max-age=3600' }));
  // Crawlers read the site's pages, not the JSON behind them: each read here reaches the database, and the site's pages say it all.
  app.get('/robots.txt', (c) => c.text(API_ROBOTS_TXT, 200, { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' }));

  app.get('/v1', async (c) =>
    c.json({
      name: 'RebbeHub',
      version: options.version ?? API_VERSION,
      head: await catalog.head(),
      docs: '/openapi.json',
      developers: `${siteUrl.replace(/\/+$/, '')}/developers`,
      mcp: '/mcp',
      licence: { code: 'AGPL-3.0-only', facts: 'CC0-1.0', community: 'CC-BY-SA-4.0' },
    }),
  );

  // ---------------------------------------------------------------- reading

  app.get('/v1/types', async (c) => {
    const registry = await catalog.registry();
    return c.json({ types: registry.types().map((type) => ({ type, schema: registry.schemaFor(type) })) });
  });

  app.get('/v1/entities', async (c) => {
    const type = c.req.query('type');
    if (type && !(await catalog.registry()).has(type)) throw new HttpError(400, `unknown type "${type}"`);
    const set = c.req.query('set');
    const limit = Math.min(Math.max(intParam(c.req.query('limit'), 'limit') ?? 50, 1), 500);
    const raw = c.req.query('cursor') ?? c.req.query('after');
    const after = cursor.decode(raw)?.[0] ?? raw;
    const items = await catalog.list({ type: type as EntityType | undefined, set: set ? entityId(set) : undefined, after: after === undefined ? undefined : String(after), limit });
    const last = items[items.length - 1];
    const next = last && items.length === limit ? cursor.encode([`${last.path ?? ''}${last.id}`]) : null;
    nextLink(c, next);
    return c.json({ items: await redact(items), next });
  });

  app.get('/v1/entities/batch', async (c) => {
    const ids = (c.req.query('ids') ?? '').split(',').filter((x) => x.length > 0).map(entityId);
    if (ids.length > 200) throw new HttpError(400, 'at most 200 ids at a time');
    return c.json({ items: await redact(await catalog.getMany(ids)) });
  });

  app.get('/v1/entities/:id/children', async (c) => {
    const field = c.req.query('field');
    const type = c.req.query('type');
    if (!field || !/^[a-z][a-zA-Z]*$/.test(field)) throw new HttpError(400, 'say which field points at the parent (field=work)');
    if (!type || !(await catalog.registry()).has(type)) throw new HttpError(400, 'say which type of children (type=unit)');
    const limit = Math.min(Math.max(intParam(c.req.query('limit'), 'limit') ?? 100, 1), 1000);
    const raw = c.req.query('cursor') ?? c.req.query('after');
    // A cursor holds the last child's order and id; an older plain value is an order alone.
    const [after, afterId] = cursor.decode(raw) ?? [raw];
    const items = await catalog.children(entityId(c.req.param('id')), field, type as EntityType, { after: after === undefined ? undefined : String(after), afterId: afterId === undefined ? undefined : String(afterId), limit });
    const last = items[items.length - 1] as { id: string; data: { order?: string } } | undefined;
    const next = last && items.length === limit ? cursor.encode([last.data.order ?? '', last.id]) : null;
    nextLink(c, next);
    return c.json({ items: await redact(items), next });
  });

  app.get('/v1/events', async (c) => {
    const within = c.req.query('within');
    const day = c.req.query('day');
    const dates = c.req.query('dates');
    if (!within && !day && !dates && !c.req.query('missing')) throw new HttpError(400, 'give within (5742 or 5742-05), day (05-10, or several: 05-10,05-11) or dates (5742-05-10,5743-05-10)');
    const list = (value: string | undefined) => (value === undefined ? undefined : value.split(',').filter(Boolean));
    const missing = c.req.query('missing');
    if (missing !== undefined && missing !== 'recordings' && missing !== 'texts') throw new HttpError(400, 'missing is recordings or texts');
    return c.json({ items: await catalog.events({ within, day: list(day), dates: list(dates), missing, limit: intParam(c.req.query('limit'), 'limit') }) });
  });

  // How many items point at each item through a field: `?field=work&type=unit` counts each work's units.
  app.get('/v1/refcounts', async (c) => {
    const field = c.req.query('field');
    if (!field || !/^[a-zA-Z]+$/.test(field)) throw new HttpError(400, 'give field (work, authors, event...)');
    const type = c.req.query('type');
    return c.json({ counts: await catalog.refCounts(field, type as EntityType | undefined) }, 200, { 'Cache-Control': PUBLIC_SUMMARY });
  });

  // A work's volumes (its top-level parts) with how many units each holds, and one volume's units.
  app.get('/v1/works/:id/outline', async (c) => c.json({ parts: await catalog.workOutline(entityId(c.req.param('id'))) }));
  app.get('/v1/works/:id/parts/:part', async (c) => c.json({ items: await catalog.workPart(entityId(c.req.param('id')), c.req.param('part'), intParam(c.req.query('limit'), 'limit')) }));

  // The community page in numbers: the latest merges, reports waiting (a count), people, and what the catalog lacks.
  app.get('/v1/community', async (c) => c.json(await catalog.community(intParam(c.req.query('limit'), 'limit')), 200, { 'Cache-Control': PUBLIC_SUMMARY }));

  // The Missing board (the plan, section 7): farbrengens without recordings or texts (of a year), sefarim without a scan.
  app.get('/v1/missing', async (c) => {
    const kind = c.req.query('kind');
    const within = c.req.query('within') || undefined;
    const limit = Math.min(intParam(c.req.query('limit'), 'limit') ?? 50, 500);
    if (kind === 'scans') {
      const { total, items } = await catalog.worksWithoutScans(limit);
      return c.json({ kind, total, items: await redact(items) });
    }
    // Files Sichos-Kodesh's archive wants and upstream would not give (a Drive link gone, a recording the CDN lost).
    if (kind === 'files') {
      const { total, items } = await catalog.archiveGaps(limit);
      const entities = await redact(items.flatMap((g) => (g.entity ? [g.entity] : [])));
      const byId = new Map(entities.map((e) => [e.id, e]));
      return c.json({ kind, total, items: items.map((g) => ({ ...g, entity: g.entity ? (byId.get(g.entity.id) ?? null) : null })) });
    }
    if (kind !== 'recordings' && kind !== 'texts') throw new HttpError(400, 'kind is recordings, texts, scans or files');
    if (within && !/^\d{4}(-(0[1-9]|1[0-2]|06A|06B))?$/.test(within)) throw new HttpError(400, 'within is a year (5745) or a month (5745-05)');
    const all = await catalog.events({ within, missing: kind, limit: 2000 });
    return c.json({ kind, within: within ?? null, total: all.length, items: await redact(all.slice(0, limit)) });
  });

  // Projects that work through a gap, with their progress and what is next to do.
  app.get('/v1/projects', async (c) => c.json({ projects: await catalog.projects({ status: (c.req.query('status') as 'open' | undefined) ?? undefined }) }));

  app.get('/v1/projects/:slug', async (c) => {
    const [project] = await catalog.projects({ slug: c.req.param('slug') });
    if (!project) throw new CatalogError('not-found', 'no such project');
    const open = project.status === 'open';
    const byEvent = project.focus.missing === 'recordings' || project.focus.missing === 'texts';
    const next = open && byEvent ? await catalog.events({ within: project.focus.within, missing: project.focus.missing as 'recordings', limit: 30 }) : [];
    const todo = open ? await projectTodo(catalog, project, 30) : [];
    return c.json({ project, next: await redact(next), todo });
  });

  // "Give me the next one": the next item nobody holds, held for whoever asks for a few hours.
  app.post('/v1/projects/:slug/next', async (c) => {
    const by = await signedIn(c);
    return c.json({ item: await claimNext(catalog, c.req.param('slug'), by) });
  });

  app.post('/v1/projects/:slug/release', async (c) => {
    const by = await signedIn(c);
    const input = await body<{ item?: string }>(c);
    if (!input.item) throw new HttpError(400, 'give the item to let go of');
    await releaseClaim(catalog, c.req.param('slug'), by, input.item);
    return c.json({ ok: true });
  });

  app.post('/v1/projects', async (c) => {
    const by = await signedIn(c);
    const input = await body<{ slug?: string; name?: string; goal?: string; set?: string; missing?: ProjectFocus['missing']; within?: string; scan?: string; level?: number }>(c);
    if (!input.slug || !input.name?.trim()) throw new HttpError(400, 'a project needs a slug and a name');
    const focus: ProjectFocus =
      input.missing === 'proofreading'
        ? { missing: 'proofreading', scan: input.scan ? entityId(input.scan) : undefined, ...(input.level ? { level: input.level as 1 | 2 } : {}) }
        : { missing: input.missing as 'recordings', ...(input.within ? { within: input.within } : {}) };
    const id = await catalog.openFocusProject(by, {
      slug: input.slug,
      name: input.name.trim().slice(0, 200),
      goal: input.goal?.trim().slice(0, 2000) || undefined,
      set: input.set ? entityId(input.set) : undefined,
      focus,
    });
    return c.json({ id, slug: input.slug }, 201);
  });

  app.post('/v1/projects/:slug/close', async (c) => {
    const by = await signedIn(c);
    const [project] = await catalog.projects({ slug: c.req.param('slug') });
    if (!project) throw new CatalogError('not-found', 'no such project');
    await catalog.closeProject(project.id, by);
    return c.json({ ok: true });
  });

  // A scan's text, page by page: the community's where people fixed it, else the machine's, each line marked checked or not.
  // Its words follow its scan's file: withheld when the file may not be served.
  const scanTextAllowed = async (scan: EntityId) => {
    const entity = await catalog.get(scan);
    if (!entity || entity.type !== 'scan') throw new CatalogError('not-found', 'no such scan');
    const file = await getFile(catalog.db, String((entity.data as { file?: string }).file ?? ''));
    if (!file || !mayServe(file.rights_state)) throw new CatalogError('not-found', "this scan's text is withheld for its rights");
  };

  app.get('/v1/scans/:id/text', async (c) => {
    const scan = entityId(c.req.param('id'));
    await scanTextAllowed(scan);
    const text = await scanText(catalog, scan, intParam(c.req.query('page'), 'page') ?? 1);
    if (!text) throw new CatalogError('not-found', 'this scan has not been read yet');
    return c.json(text);
  });

  app.post('/v1/scans/:id/text/fix', async (c) => {
    const by = await signedIn(c);
    const scan = entityId(c.req.param('id'));
    await scanTextAllowed(scan);
    const input = await body<{ page?: number; line?: string; text?: string }>(c);
    if (typeof input.page !== 'number' || !input.line || typeof input.text !== 'string') throw new HttpError(400, 'give page, line and text');
    return c.json(await fixLine(catalog, by, { scan, page: input.page, line: input.line, text: input.text }), 201);
  });

  // How far each page of a scan is proofread (0, 1 or 2), for the page strip and proofreading projects.
  app.get('/v1/scans/:id/progress', async (c) => {
    const scan = entityId(c.req.param('id'));
    await scanTextAllowed(scan);
    const progress = await scanProgress(catalog, scan);
    if (!progress) throw new CatalogError('not-found', 'this scan has not been read yet');
    return c.json(progress);
  });

  // "This page is right": raises a page a proofreading level, with any lines fixed on the way.
  app.post('/v1/scans/:id/text/confirm', async (c) => {
    const by = await signedIn(c);
    const scan = entityId(c.req.param('id'));
    await scanTextAllowed(scan);
    const input = await body<{ page?: number; fixes?: Record<string, string> }>(c);
    if (typeof input.page !== 'number') throw new HttpError(400, 'give the page');
    return c.json(await confirmPage(catalog, by, { scan, page: input.page, fixes: input.fixes }), 201);
  });

  // Someone's own OCR of a scan (hOCR, ALTO or plain text), as a new layer, for review.
  app.post('/v1/scans/:id/ocr', async (c) => {
    const by = await signedIn(c);
    const scan = entityId(c.req.param('id'));
    await scanTextAllowed(scan);
    const input = await body<{ content?: string; format?: OcrFormat; engine?: { name?: string; version?: string }; firstPage?: number; language?: string }>(c);
    if (typeof input.content !== 'string' || !input.engine?.name || !input.engine.version) throw new HttpError(400, 'give content and engine { name, version }');
    if (input.format !== undefined && !['hocr', 'alto', 'text'].includes(input.format)) throw new HttpError(400, 'format is hocr, alto or text');
    const made = await uploadOcr(catalog, by, { scan, content: input.content, format: input.format, engine: { name: input.engine.name, version: input.engine.version }, firstPage: input.firstPage, language: input.language });
    return c.json(made, 201);
  });

  // Keepers pick which OCR layer seeds the community text.
  app.post('/v1/scans/:id/text/seed', async (c) => {
    const by = await signedIn(c);
    const scan = entityId(c.req.param('id'));
    const input = await body<{ layer?: string }>(c);
    if (!input.layer) throw new HttpError(400, 'give the layer');
    return c.json(await chooseSeed(catalog, by, { scan, layer: entityId(input.layer) }), 201);
  });

  // Compare printings: the printings of a unit whose text the catalog has, and two of them word by word.
  app.get('/v1/units/:id/printings', async (c) => c.json({ printings: await printingsOf(catalog, entityId(c.req.param('id'))) }));

  app.get('/v1/compare', async (c) => {
    const a = c.req.query('a');
    const b = c.req.query('b');
    if (!a || !b) throw new HttpError(400, 'give a and b: text:<id> or scan:<id>:<from>-<to>');
    return c.json(await comparePrintings(catalog, a, b));
  });

  // A recording's transcript, paragraph by paragraph with where each is heard; machine paragraphs are marked until checked.
  app.get('/v1/recordings/:id/transcript', async (c) => {
    const transcript = await recordingTranscript(catalog, entityId(c.req.param('id')));
    if (!transcript) throw new CatalogError('not-found', 'this recording has no transcript yet');
    return c.json(transcript);
  });

  app.post('/v1/recordings/:id/transcript/fix', async (c) => {
    const by = await signedIn(c);
    const input = await body<{ segment?: string; content?: string }>(c);
    if (!input.segment || typeof input.content !== 'string') throw new HttpError(400, 'give segment and content');
    const transcript = await recordingTranscript(catalog, entityId(c.req.param('id')));
    if (!transcript?.paragraphs.some((p) => p.id === input.segment)) throw new CatalogError('not-found', 'no such paragraph in this transcript');
    return c.json(await fixParagraph(catalog, by, { segment: input.segment as EntityId, content: input.content }), 201);
  });

  // "The Rebbe is saying this line now": sets a paragraph (or a word of it) at this moment, locks it, and moves what follows with it.
  app.post('/v1/recordings/:id/sync/anchor', async (c) => {
    const by = await signedIn(c);
    const input = await body<{ segment?: string; atMs?: number; word?: number }>(c);
    if (!input.segment || typeof input.atMs !== 'number') throw new HttpError(400, 'give segment and atMs');
    return c.json(await anchorSync(catalog, by, { recording: entityId(c.req.param('id')), segment: entityId(input.segment), atMs: input.atMs, word: typeof input.word === 'number' ? input.word : undefined }), 201);
  });

  // "The sync is right": every paragraph's sync of the recording marked checked.
  app.post('/v1/recordings/:id/sync/confirm', async (c) => {
    const by = await signedIn(c);
    return c.json(await confirmSync(catalog, by, { recording: entityId(c.req.param('id')) }), 201);
  });

  // The farbrengen's hanacha, paragraph by paragraph with where each is heard in these recordings: a farbrengen's page
  // asks about all its parts in one request, where it used to ask about each (each a Worker call and its statements).
  app.get('/v1/recordings/batch/hanacha', async (c) => {
    const ids = (c.req.query('ids') ?? '').split(',').filter((x) => x.length > 0).map(entityId);
    if (ids.length > 200) throw new HttpError(400, 'at most 200 ids at a time');
    const gate = new ExportGate(catalog);
    const items: Record<string, unknown> = {};
    for (const [recording, found] of await hanachaSyncs(catalog, ids)) if (!(await gate.textWithheld(found.text))) items[recording] = found;
    return c.json({ items });
  });

  app.get('/v1/recordings/:id/hanacha', async (c) => {
    const id = entityId(c.req.param('id'));
    const found = (await hanachaSyncs(catalog, [id])).get(id);
    if (!found) throw new CatalogError('not-found', 'this recording has no hanacha synced to it');
    const gate = new ExportGate(catalog);
    if (await gate.textWithheld(found.text)) throw new CatalogError('not-found', "this hanacha's text is withheld for its rights");
    return c.json(found);
  });

  app.get('/v1/stats', async (c) => c.json({ head: await catalog.head(), counts: await catalog.counts() }, 200, { 'Cache-Control': PUBLIC_SUMMARY }));

  // Several files at once (a farbrengen's parts, a printing's scans), in the order asked, missing ones left out: four
  // statements for them all, where each used to be its own request and its own four.
  app.get('/v1/files/batch', async (c) => {
    const ids = (c.req.query('ids') ?? '').split(',').filter((x) => x.length > 0);
    if (ids.length > 200) throw new HttpError(400, 'at most 200 ids at a time');
    if (ids.some((id) => !/^[0-9a-f]{64}$/.test(id))) throw new HttpError(400, 'a file is named by its sha256');
    return c.json({ items: await fileInfos(c, ids) });
  });

  app.get('/v1/files/:sha256', async (c) => {
    const sha256 = c.req.param('sha256');
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new HttpError(400, 'a file is named by its sha256');
    const [file] = await fileInfos(c, [sha256]);
    if (!file) throw new CatalogError('not-found', 'no such file');
    return c.json(file);
  });

  /** What /v1/files says of each of several files, in the order asked (missing ones left out). */
  async function fileInfos(c: Context, sha256s: readonly string[]) {
    const files = await getFiles(catalog.db, sha256s);
    const found = [...new Set(sha256s)].filter((id) => files.has(id));
    if (found.length === 0) return [];
    const base = options.filesBaseUrl ?? (options.files ? new URL(c.req.url).origin : null);
    const servedOf = (file: FileRow) => Boolean(mayServe(file.rights_state) && file.storage_tier === 'public' && base);
    // What was made from each (a scan's reading copy), served under the same rights; its page images are counted, and listed by its scan's pages.
    const [derivations, fixes, pageImages] = await Promise.all([
      getDerivationsOf(catalog.db, found),
      getPageFixes(catalog.db, found),
      pageImageCounts(catalog.db, found.filter((id) => servedOf(files.get(id)!))),
    ]);
    return found.map((sha256) => {
      const file = files.get(sha256)!;
      const served = servedOf(file);
      const fix = fixes.get(sha256);
      return {
        sha256,
        bytes: file.bytes,
        mime: file.mime,
        rights: file.rights_state,
        credit: file.credit,
        url: served ? `${base}/objects/${sha256}` : null,
        derivations: (derivations.get(sha256) ?? [])
          .filter((d) => !/^(page-image|thumbnail)\//.test(d.profile))
          .map((d) => ({ profile: d.profile, sha256: d.sha256, bytes: d.bytes, encoder: d.encoder, url: served ? `${base}/objects/${d.sha256}` : null })),
        pageFix: fix ? pageFixView(fix) : null,
        pageImages: served ? (pageImages.get(sha256) ?? 0) : 0,
      };
    });
  }

  /** A file's page fix (docs/operations.md): measurements, open whatever the file's rights. */
  async function pageFixOf(sha256: string) {
    const fix = await getPageFix(catalog.db, sha256);
    return fix ? pageFixView(fix) : null;
  }
  const pageFixView = (fix: PageFixRow) => ({ encoder: fix.encoder, verdict: fix.verdict, reason: fix.reason, pages: fix.pages });

  // What a PDF on Google Drive needs to read straight, by its Drive id: the site's reader draws the file through
  // it, or opens the file's reading copy when RebbeHub serves one.
  app.get('/v1/page-fixes/drive/:id{[\\w-]{10,}}', async (c) => {
    const sha256 = await fileFromDrive(catalog.db, c.req.param('id'));
    const fix = sha256 ? await pageFixOf(sha256) : null;
    if (!sha256 || !fix) throw new CatalogError('not-found', 'no page fix for this file');
    const file = (await getFile(catalog.db, sha256))!;
    const base = options.filesBaseUrl ?? (options.files ? new URL(c.req.url).origin : null);
    const copy = (await getDerivations(catalog.db, sha256)).find((d) => d.profile === 'reading-copy');
    const served = mayServe(file.rights_state) && file.storage_tier === 'public' && base;
    return c.json({ sha256, ...fix, readingCopy: copy && served ? `${base}/objects/${copy.sha256}` : null }, 200, { 'Cache-Control': 'public, max-age=300' });
  });

  // Published manifests (the Sichos Kodesh scans' reading copies…): facts about files - hashes, sizes, page
  // measurements - open like the rest of the catalog. Every import reads them back into the catalog.
  app.get('/manifests/:collection{[a-z0-9-]+}/:name{[a-z0-9-]+\\.json}', async (c) => {
    if (!options.files) throw new CatalogError('not-found', 'no such manifest');
    const object = await options.files.get(`manifests/${c.req.param('collection')}/${c.req.param('name')}`);
    if (!object) throw new CatalogError('not-found', 'no such manifest');
    return c.body(object.body, 200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
  });

  // The media proxy: a file's bytes, only while its rights allow serving it (a takedown stops this at once).
  app.get('/objects/:sha256', async (c) => {
    const sha256 = c.req.param('sha256');
    if (!options.files || !/^[0-9a-f]{64}$/.test(sha256)) throw new CatalogError('not-found', 'no such file');
    const file = await getFile(catalog.db, sha256);
    if (!file || !mayServe(file.rights_state) || file.storage_tier !== 'public') throw new CatalogError('not-found', 'this file is not served here');
    const range = parseRange(c.req.header('range'), file.bytes);
    if (range && (range.offset >= file.bytes || (range.length !== undefined && (range.length <= 0 || range.offset + range.length > file.bytes)))) {
      return c.body(null, 416, { 'Content-Range': `bytes */${file.bytes}` });
    }
    const object = await options.files.get(`objects/${sha256}`, range ?? undefined);
    if (!object) throw new CatalogError('not-found', 'the file is listed but its bytes are missing');
    const headers: Record<string, string> = {
      'Content-Type': file.mime,
      'Accept-Ranges': 'bytes',
      // Named by content, so it never changes; takedowns are enforced here, before the cache is filled again.
      'Cache-Control': 'public, max-age=86400',
      ETag: `"${sha256}"`,
    };
    if (file.credit) headers['X-Credit'] = encodeURIComponent(file.credit);
    if (range) {
      const end = range.length === undefined ? file.bytes - 1 : range.offset + range.length - 1;
      headers['Content-Range'] = `bytes ${range.offset}-${end}/${file.bytes}`;
      headers['Content-Length'] = String(end - range.offset + 1);
      return c.body(object.body, 206, headers);
    }
    headers['Content-Length'] = String(file.bytes);
    return c.body(object.body, 200, headers);
  });

  // A text of a sefer as its source gave it (one chapter or letter, an HTML <article>), kept on RebbeHub's own storage
  // (`texts/<sha256>` in the public bucket). The first time it is asked for, it is copied from Sichos-Kodesh's published
  // archive, checked against its hash, and kept; after that RebbeHub serves its own copy. Pages link to it, and the
  // works importer reads it for their words (packages/importers/src/sichosKodeshTexts.ts).
  const sourceText = async (c: Context) => {
    const sha256 = c.req.param('sha256') ?? '';
    const kept = options.texts;
    if (!kept || !/^[0-9a-f]{64}$/.test(sha256)) throw new CatalogError('not-found', 'no such text');
    const key = `texts/${sha256}`;
    let text: string | null = null;
    const own = await kept.store.get(key);
    if (own) text = await new Response(own.body).text();
    else if (kept.from) {
      const object = await kept.from.get(`objects/${sha256}`);
      if (object && object.size <= 4_000_000) {
        const bytes = await new Response(object.body).arrayBuffer();
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
        const candidate = new TextDecoder().decode(bytes);
        if (digest === sha256 && /^\s*<article[\s>]/i.test(candidate)) {
          await kept.writer.put(key, bytes, 'text/html; charset=utf-8');
          text = candidate;
        }
      }
    }
    if (text === null) throw new CatalogError('not-found', 'no such text');
    return c.body(text, 200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=31536000, immutable',
      // Someone else's HTML: shown as a document, never run on this origin.
      'Content-Security-Policy': 'sandbox',
      'X-Content-Type-Options': 'nosniff',
    });
  };
  app.get('/v1/texts/:sha256', sourceText);
  // The same texts where the Sichos Kodesh apps look for them, under their catalog's address (appCatalog.ts).
  app.get('/v1/app/v3/texts/:sha256', sourceText);

  app.get('/v1/entities/:id', async (c) => {
    const id = entityId(c.req.param('id'));
    const at = intParam(c.req.query('at'), 'at');
    const entity = await catalog.get(id, { at });
    if (!entity) {
      // Merged into another item (organizing the catalog): say which, so links to it still lead somewhere.
      const mergedInto = at === undefined ? await catalog.forwardOf(id) : null;
      throw new CatalogError('not-found', mergedInto ? `${id} was merged into ${mergedInto}` : `${id} not found`, mergedInto ? { mergedInto } : undefined);
    }
    return c.json((await redact([entity]))[0]);
  });

  app.get('/v1/entities/:id/history', async (c) => {
    const id = entityId(c.req.param('id'));
    const history = await catalog.history(id);
    // What changed, field by field, is shown only where the item's words may be shown at all.
    const current = await catalog.get(id);
    const withheld = current ? Boolean(((await redact([current]))[0] as { withheld?: string }).withheld) : false;
    return c.json({ history: withheld ? history.map((h) => ({ ...h, changes: [] })) : history });
  });

  // The page's talk page: the conversation about it, open to read; writing needs a signed-in account.
  app.get('/v1/entities/:id/talk', async (c) => c.json({ talk: await catalog.talk({ kind: 'entity', id: entityId(c.req.param('id')) }) }));

  app.post('/v1/entities/:id/talk', async (c) => {
    const by = await signedIn(c);
    const id = entityId(c.req.param('id'));
    if (!(await catalog.get(id))) throw new CatalogError('not-found', `${id} not found`);
    const input = await body<{ body?: string; parent?: number }>(c);
    const text = (input.body ?? '').trim();
    if (!text || text.length > 10_000) throw new HttpError(400, 'a comment of 1 to 10,000 characters');
    if (input.parent !== undefined) {
      const thread = await catalog.talk({ kind: 'entity', id });
      if (!thread.some((t) => t.id === input.parent)) throw new HttpError(400, 'that comment is not on this page');
    }
    return c.json({ id: await catalog.comment(by, { kind: 'entity', id }, text, input.parent) }, 201);
  });

  app.post('/v1/comments/:id/hide', async (c) => {
    const by = await signedIn(c);
    await catalog.hideComment(intParam(c.req.param('id'), 'id')!, by);
    return c.json({ ok: true });
  });

  app.get('/v1/entities/:id/backlinks', async (c) => {
    const type = c.req.query('type');
    if (type && !ENTITY_TYPES.includes(type as EntityType)) throw new HttpError(400, `unknown type "${type}"`);
    return c.json({ backlinks: await catalog.backlinks(entityId(c.req.param('id')), { field: c.req.query('field'), type: type as EntityType | undefined }) });
  });

  app.get('/v1/revisions/:rev', async (c) => {
    const rev = await catalog.revision(intParam(c.req.param('rev'), 'rev')!);
    if (!rev) throw new CatalogError('not-found', 'no such revision');
    if (rev.data === null) return c.json(rev);
    const [shown] = await redact([{ id: rev.entity_id, type: rev.entity_type, path: rev.path, rev: rev.id, data: rev.data }]);
    // (Typed loosely: Hono's JSON typing cannot follow the recursive Json type.)
    return c.json({ ...rev, data: shown!.data, withheld: shown!.withheld } as Record<string, unknown>);
  });

  app.get('/v1/resolve', async (c) => {
    const path = c.req.query('path');
    if (!path || !path.startsWith('/')) throw new HttpError(400, 'give a path, starting with /');
    const found = await catalog.resolvePath(path);
    if (!found) throw new CatalogError('not-found', `nothing at ${path}`);
    return c.json(found);
  });

  app.get('/v1/search', async (c) => {
    const q = c.req.query('q') ?? '';
    const type = c.req.query('type');
    if (type && !(await catalog.registry()).has(type)) throw new HttpError(400, `unknown type "${type}"`);
    const date = parseDateText(q);
    const results = await catalog.search(q, { type: type as EntityType | undefined, limit: intParam(c.req.query('limit'), 'limit') });
    return c.json({ query: q, date: date.ok ? { key: date.key, he: describeDateKey(date.key, 'he'), en: describeDateKey(date.key, 'en') } : null, results: await redact(results) });
  });

  app.get('/v1/dates/parse', (c) => {
    const parsed = parseDateText(c.req.query('q') ?? '');
    if (!parsed.ok) return c.json({ ok: false, reason: parsed.reason }, 422);
    return c.json({ ok: true, key: parsed.key, he: describeDateKey(parsed.key, 'he'), en: describeDateKey(parsed.key, 'en') });
  });

  app.get('/v1/commits', async (c) => {
    // `cursor` is the `next` of the page before; `since` a commit's seq, to start from anywhere.
    const raw = c.req.query('cursor');
    const since = raw !== undefined ? Number(cursor.decode(raw)?.[0] ?? intParam(raw, 'cursor')) : (intParam(c.req.query('since'), 'since') ?? 0);
    const limit = Math.min(Math.max(intParam(c.req.query('limit'), 'limit') ?? 20, 1), 100);
    // `changes`: only so many of each commit's changes (an import's has thousands), for a feed; `changed` and `types` still count them all.
    const changes = intParam(c.req.query('changes'), 'changes');
    const gate = new ExportGate(catalog);
    const commits = await catalog.commitsSince(since, limit, { changes });
    for (const commit of commits) {
      commit.changes = await Promise.all(commit.changes.map(async (change) => (change.data === null ? change : { ...change, data: (await gate.redact({ ...change, data: change.data })).data })));
    }
    const next = commits.length === limit ? cursor.encode([commits[commits.length - 1]!.seq]) : null;
    nextLink(c, next);
    // The newest page is how programs follow the catalog: kept only seconds, so a merge is seen almost at once.
    return c.json({ commits, next }, 200, next ? {} : { 'Cache-Control': 'public, max-age=10, s-maxage=10' });
  });

  // ---------------------------------------------------------------- reports (no account needed)

  app.post('/v1/reports', async (c) => {
    const input = await body<{ entityId?: string; reason?: string; note?: string; captcha?: string; title?: string }>(c);
    if (!input.reason || !REPORT_REASONS.includes(input.reason as ReportReason)) throw new HttpError(400, `reason must be one of ${REPORT_REASONS.join(', ')}`);
    const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim();
    const account = (await authenticate?.(c)) ?? null;
    if (!account && options.verifyCaptcha && !(await options.verifyCaptcha(input.captcha, ip))) throw new HttpError(403, 'the captcha was not solved');
    const reporterHash = ip ? await sha256Hex(`${options.reportSalt ?? 'rebbehub'}\u0000${ip}`) : undefined;
    if (reporterHash && !account) {
      const { rows } = await catalog.db.query<{ n: number }>("SELECT count(*)::int AS n FROM report WHERE reporter_hash = $1 AND created_at > now() - interval '1 hour'", [reporterHash]);
      if ((rows[0]?.n ?? 0) >= (options.reportsPerHour ?? 10)) throw new HttpError(429, 'too many reports from here in the last hour; please try again later');
    }
    const id = await catalog.report({
      entityId: input.entityId ? entityId(input.entityId) : undefined,
      reason: input.reason as ReportReason,
      note: input.note,
      reporter: account ?? undefined,
      reporterHash,
      title: typeof input.title === 'string' ? input.title : undefined,
    });
    // Its number (#12), by which the site shows it as an issue.
    const number = (await catalog.db.query<{ number: string }>('SELECT number FROM report WHERE id = $1', [id])).rows[0]?.number;
    return c.json({ id, number: number === undefined ? null : Number(number) }, 201);
  });

  // A takedown request (no account needed): a Report in the set's inbox, with who asked kept for stewards alone.
  app.post('/v1/takedowns', async (c) => {
    const input = await body<{ target?: string; name?: string; email?: string; relation?: string; statement?: string; captcha?: string }>(c);
    const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim();
    if (options.verifyCaptcha && !(await options.verifyCaptcha(input.captcha, ip))) throw new HttpError(403, 'the captcha was not solved');
    const reporterHash = ip ? await sha256Hex(`${options.reportSalt ?? 'rebbehub'}\u0000${ip}`) : undefined;
    if (reporterHash) {
      const { rows } = await catalog.db.query<{ n: number }>("SELECT count(*)::int AS n FROM report WHERE reporter_hash = $1 AND created_at > now() - interval '1 hour'", [reporterHash]);
      if ((rows[0]?.n ?? 0) >= (options.reportsPerHour ?? 10)) throw new HttpError(429, 'too many requests from here in the last hour; please try again later');
    }
    const id = await requestTakedown(catalog, {
      target: input.target ?? '',
      name: input.name ?? '',
      email: input.email ?? '',
      relation: input.relation as TakedownRelation,
      statement: input.statement ?? '',
      reporterHash,
    });
    // A receipt, so they know it arrived and when to expect an answer (best effort: the request is kept either way).
    if (options.mailer && input.email) {
      const text = `We received your takedown request (number ${id}) for: ${input.target}\n\nA steward will answer within ${TAKEDOWN_RESPONSE_DAYS} days. Until then nothing is deleted; if it is taken down, it stops being shown at once.\n\nRebbeHub`;
      await options.mailer
        .send({ to: input.email.trim(), subject: `RebbeHub: takedown request ${id} received`, text, html: `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>` })
        .catch((error) => console.error('takedown receipt', error));
    }
    return c.json({ id, answerWithinDays: TAKEDOWN_RESPONSE_DAYS }, 201);
  });

  // Reports are private: stewards read them all, a set's keepers read their set's.
  app.get('/v1/reports', async (c) => {
    const by = await signedIn(c);
    const set = c.req.query('set');
    const status = c.req.query('status');
    if (status && !['open', 'resolved', 'dismissed'].includes(status)) throw new HttpError(400, 'status is open, resolved or dismissed');
    const account = await catalog.account(by);
    const keeps = set ? ((((await catalog.get(entityId(set)))?.data ?? {}) as { keepers?: string[] }).keepers ?? []).includes(by) : false;
    if (!account?.is_steward && !keeps) throw new HttpError(403, "reports are read by stewards and the set's keepers");
    const reports = (await catalog.reports({ set: set ? entityId(set) : undefined, status: status as 'open' | undefined })) as Array<{ entity_id: string | null; reporter_hash?: unknown }>;
    // With the item each is about, for its name; never who (or which address) sent it.
    const items = await redact((await Promise.all([...new Set(reports.map((r) => r.entity_id).filter((id): id is string => Boolean(id)))].map((id) => catalog.get(id as EntityId)))).filter((i): i is EntityView => i !== null));
    return c.json({ reports: reports.map(({ reporter_hash: _hidden, ...r }) => r), items });
  });

  app.post('/v1/reports/:id/close', async (c) => {
    const by = await signedIn(c);
    const input = await body<{ outcome?: 'resolved' | 'dismissed'; changeset?: number; note?: string }>(c);
    if (input.outcome !== 'resolved' && input.outcome !== 'dismissed') throw new HttpError(400, 'outcome is resolved or dismissed');
    await catalog.closeReport(intParam(c.req.param('id'), 'id')!, by, input.outcome, { changeset: input.changeset, note: input.note });
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- suggestions

  app.get('/v1/suggestions', async (c) => {
    // Asked for by state (open, closed, all), it is the list of conversations: newest first, by number, with who is asked to review.
    const state = c.req.query('state');
    if (state !== undefined) {
      if (!['open', 'closed', 'all'].includes(state)) throw new HttpError(400, 'state is open, closed or all');
      const handle = async (value: string | undefined) => {
        if (!value) return undefined;
        const ids = await idsOfUsernames(catalog.db, [value.replace(/^@/, '')]);
        return [...ids.values()][0] ?? value;
      };
      // Newest first by number: a cursor holds the last one's number; `before` (a number) is still read.
      let before = intParam(c.req.query('before'), 'before');
      if (c.req.query('cursor')) {
        const [n] = cursor.decode(c.req.query('cursor')) ?? [];
        if (typeof n !== 'number') throw new HttpError(400, 'that cursor is not one this list gave');
        before = n;
      }
      const limit = Math.min(Math.max(intParam(c.req.query('limit'), 'limit') ?? 30, 1), 100);
      const about = (c.req.query('about') ?? '').split(',').filter((x) => x.length > 0).map(entityId);
      if (about.length > 500) throw new HttpError(400, 'at most 500 ids in about');
      const list = await listSuggestions(catalog.db, {
        state: state as 'open',
        about: about.length ? about : undefined,
        author: await handle(c.req.query('author')),
        reviewer: await handle(c.req.query('reviewer')),
        q: c.req.query('q'),
        before,
        limit,
      });
      const last = list.items[list.items.length - 1];
      const next = last && list.items.length === limit ? cursor.encode([last.number]) : null;
      nextLink(c, next);
      return c.json({ suggestions: list.items, people: list.people, counts: list.counts, next });
    }
    const status = c.req.query('status');
    if (status && !STATUSES.includes(status as ChangesetStatus)) throw new HttpError(400, `status is one of ${STATUSES.join(', ')}`);
    const limit = Math.min(Math.max(intParam(c.req.query('limit'), 'limit') ?? 50, 1), 500);
    const [at, id] = cursor.decode(c.req.query('cursor')) ?? [];
    if (c.req.query('cursor') && (typeof at !== 'string' || typeof id !== 'number')) throw new HttpError(400, 'that cursor is not one this list gave');
    const suggestions = await catalog.listChangesets({
      status: status as ChangesetStatus | undefined,
      author: c.req.query('author'),
      postReview: c.req.query('postReview') === 'true',
      limit,
      after: typeof at === 'string' && typeof id === 'number' ? { at, id } : undefined,
    });
    const last = suggestions[suggestions.length - 1];
    const next = last && suggestions.length === limit ? cursor.encode([new Date(last.submitted_at ?? last.created_at).toISOString(), Number(last.id)]) : null;
    nextLink(c, next);
    // How many items each changes, and who wrote them (a bot's, said to be one), so a list is drawn without opening each.
    const counts = await catalog.itemCounts(suggestions.map((s) => Number(s.id)));
    return c.json({ suggestions: suggestions.map((s) => ({ ...s, items: counts.get(Number(s.id)) ?? 0 })), people: await peopleOf(catalog.db, suggestions.map((s) => s.author)), next });
  });

  app.get('/v1/suggestions/:id', async (c) => {
    // A page of its items at a time (a bot's Suggestion may change hundreds), with how many in all and a summary of them all.
    const offset = Math.max(intParam(c.req.query('offset'), 'offset') ?? 0, 0);
    const limit = Math.min(Math.max(intParam(c.req.query('limit'), 'limit') ?? 25, 1), 200);
    const view = await catalog.review(intParam(c.req.param('id'), 'id')!, { offset, limit });
    const gate = new ExportGate(catalog);
    const hide = async (type: string, id: EntityId, data: Json | null) => (data === null ? null : ((await gate.redact({ id, type: type as EntityType, path: null, rev: 0, data })) as { withheld?: string }).withheld);
    for (const entry of view.entries) {
      const withheld = (await hide(entry.type, entry.entityId, entry.after)) ?? (await hide(entry.type, entry.entityId, entry.before));
      if (withheld) Object.assign(entry, { before: null, after: null, changes: [], conflicts: [], withheld });
    }
    // Names instead of ids, and whether the person asking may approve it (to show the buttons or not).
    const names = async (ids: string[]) => Object.fromEntries(await Promise.all([...new Set(ids)].map(async (id) => [id, (await catalog.account(id))?.display_name ?? id])));
    const viewer = (await authenticate?.(c)) ?? null;
    // Open, or live and waiting to be reviewed after: then someone may decide it.
    const decidable = view.changeset.status === 'open' || view.changeset.post_review === 'pending';
    const mayApprove = viewer && decidable ? await catalog.mayApprove(view.changeset.id, viewer) : { ok: false as const, reason: viewer ? `this suggestion is ${view.changeset.status}` : 'sign in to review' };
    // The files it adds, where each may be heard or read (null while its rights keep it private), so the reviewer checks it first.
    const base = options.filesBaseUrl ?? (options.files ? new URL(c.req.url).origin : null);
    const files: Record<string, { url: string | null; mime: string; bytes: number; rights: string; similar: Array<{ kind: string; matched?: number; of?: number; items: Array<{ id: string; type: string; path: string | null }> }> }> = {};
    for (const entry of view.entries) {
      const sha = (entry.after as { file?: unknown } | null)?.file;
      if (typeof sha !== 'string' || files[sha]) continue;
      const file = await getFile(catalog.db, sha);
      // And what the jobs found it looks like: the same scan or recording already held (a machine's guess, shown as one).
      const similar = await Promise.all((await similarFiles(catalog.db, sha)).map(async (s) => ({ kind: s.kind, matched: s.matched, of: s.of, items: (await itemsUsingFile(catalog.db, s.sha256)).map((i) => ({ id: i.id, type: i.type, path: i.path })) })));
      if (file) files[sha] = { url: base && mayServe(file.rights_state) && file.storage_tier === 'public' ? `${base}/objects/${sha}` : null, mime: file.mime, bytes: file.bytes, rights: file.rights_state, similar };
    }
    const next = view.offset + view.entries.length < view.total ? view.offset + view.entries.length : null;
    return c.json({
      ...view,
      limit,
      next,
      files,
      names: await names([view.changeset.author, ...(view.reviews as Array<{ reviewer: string }>).map((r) => r.reviewer)]),
      people: await peopleOf(catalog.db, [view.changeset.author]),
      mayApprove: mayApprove.ok,
      mayApproveReason: mayApprove.ok ? null : mayApprove.reason,
      mine: viewer === view.changeset.author,
      // The reviewer's assist: a machine's summary, advice only, marked as such wherever it is shown.
      advice: await adviceFor(catalog.db, view.changeset.id).then((a) => (a ? { ...a, machine: true } : null)),
    });
  });

  /**
   * "Suggest a fix" in one step: a new version of one item, with a few
   * words on why, sent for review. What the site's fix form sends.
   */
  app.post('/v1/suggestions/quick', async (c) => {
    const by = await signedIn(c);
    const input = await body<{ entityId?: string; data?: Json; title?: string; note?: string }>(c);
    if (!input.entityId || !isEntityId(input.entityId)) throw new HttpError(400, 'say which item this fixes (entityId)');
    if (!input.data || typeof input.data !== 'object') throw new HttpError(400, "give the item's new data");
    const entity = await catalog.get(input.entityId as EntityId);
    if (!entity || entity.data === null) throw new HttpError(404, `no item ${input.entityId}`);
    const title = (input.title ?? '').trim().slice(0, 200) || 'A fix';
    const suggestion = await catalog.createChangeset(by, { title, description: input.note?.trim().slice(0, 2000) || undefined });
    await catalog.putRevision(suggestion.id, by, { id: entity.id, type: entity.type, data: input.data });
    return c.json(await catalog.submit(suggestion.id, by), 201);
  });

  /**
   * A page's words fixed segment by segment: one segment's new words (or a
   * segment added after it, or taken out, or a page's first words), sent
   * for review as a suggestion of its own. What the site's in-place
   * editing sends; `before` is the segment as the person saw it, so a
   * change made since is never overwritten.
   */
  app.post('/v1/suggestions/words', async (c) => {
    const by = await signedIn(c);
    const input = await body<{ entityId?: string; change?: string; version?: string; segment?: string; text?: unknown; before?: unknown; kind?: string; language?: string; title?: string; note?: string }>(c);
    if (!input.entityId || !isEntityId(input.entityId)) throw new HttpError(400, 'say which item these words are on (entityId)');
    if (!['edit', 'add', 'remove', 'start'].includes(input.change ?? '')) throw new HttpError(400, 'the change is edit, add, remove or start');
    const runs = (value: unknown) => (value === undefined ? undefined : Array.isArray(value) ? (value as PageInline[]) : (() => { throw new HttpError(400, 'words are a list of runs'); })());
    return c.json(
      await suggestWords(catalog, by, {
        entity: input.entityId as EntityId,
        change: input.change as WordsChange,
        version: input.version,
        segment: input.segment,
        text: runs(input.text),
        before: runs(input.before),
        kind: input.kind as PageSegmentKind | undefined,
        language: input.language as Language | undefined,
        title: input.title,
        note: input.note,
      }),
      201,
    );
  });

  app.post('/v1/suggestions', async (c) => {
    const by = await signedIn(c);
    const input = await body<{ title?: string; description?: string; project?: number }>(c);
    if (!input.title) throw new HttpError(400, 'a suggestion needs a title');
    return c.json(await catalog.createChangeset(by, { title: input.title, description: input.description, project: input.project }), 201);
  });

  app.put('/v1/suggestions/:id/items', async (c) => {
    const by = await signedIn(c);
    const input = await body<{ id?: string; type?: string; data?: Json | null; path?: string | null }>(c);
    if (!input.type) throw new HttpError(400, 'say which type of item this is');
    if (input.data === undefined) throw new HttpError(400, 'give the item\'s data (null deletes it)');
    if (input.id !== undefined && !isEntityId(input.id)) throw new HttpError(400, `"${input.id}" is not an id`);
    const id = await catalog.putRevision(intParam(c.req.param('id'), 'id')!, by, { id: input.id as EntityId | undefined, type: input.type as EntityType, data: input.data, path: input.path });
    return c.json({ id });
  });

  app.post('/v1/suggestions/:id/submit', async (c) => {
    const by = await signedIn(c);
    return c.json(await catalog.submit(intParam(c.req.param('id'), 'id')!, by));
  });

  app.post('/v1/suggestions/:id/approve', async (c) => {
    const by = await signedIn(c);
    const input = await body<{ resolutions?: Record<string, Record<string, Resolution>>; note?: string }>(c).catch(() => ({}) as { resolutions?: undefined; note?: undefined });
    return c.json(await catalog.merge(intParam(c.req.param('id'), 'id')!, by, input.resolutions ?? {}, input.note));
  });

  app.post('/v1/suggestions/:id/send-back', async (c) => {
    const by = await signedIn(c);
    const input = await body<{ note?: string }>(c);
    await catalog.sendBack(intParam(c.req.param('id'), 'id')!, by, input.note ?? '');
    return c.json({ ok: true });
  });

  // A live change (a trusted person's line fix in an open set), reviewed after it went live: kept, or undone.
  app.post('/v1/suggestions/:id/review-live', async (c) => {
    const by = await signedIn(c);
    const input = await body<{ verdict?: 'approve' | 'revert'; note?: string }>(c);
    if (input.verdict !== 'approve' && input.verdict !== 'revert') throw new HttpError(400, 'verdict is approve (keep it) or revert (undo it)');
    return c.json(await catalog.reviewLive(intParam(c.req.param('id'), 'id')!, by, input.verdict, input.note?.trim().slice(0, 2000) || undefined));
  });

  app.post('/v1/suggestions/:id/withdraw', async (c) => {
    const by = await signedIn(c);
    await catalog.withdraw(intParam(c.req.param('id'), 'id')!, by);
    return c.json({ ok: true });
  });

  app.post('/v1/suggestions/:id/revert', async (c) => {
    const by = await signedIn(c);
    const input = await body<{ reason?: string }>(c).catch(() => ({}) as { reason?: string });
    return c.json(await catalog.revert(intParam(c.req.param('id'), 'id')!, by, input.reason));
  });

  app.post('/v1/entities/:id/restore', async (c) => {
    const by = await signedIn(c);
    const input = await body<{ rev?: number }>(c);
    if (typeof input.rev !== 'number') throw new HttpError(400, 'say which version (rev) to restore');
    return c.json({ suggestion: await catalog.restore(entityId(c.req.param('id')), input.rev, by) }, 201);
  });

  // What the person asking follows, the items themselves (for their names), and what changed in them lately.
  app.get('/v1/follows', async (c) => {
    const by = await signedIn(c);
    const follows = await catalog.follows(by);
    const items = await Promise.all(follows.filter((f) => f.kind === 'entity' || f.kind === 'set').map((f) => catalog.get(f.id as EntityId)));
    return c.json({ follows, items: await redact(items.filter((i): i is EntityView => i !== null)), feed: await catalog.followFeed(by, intParam(c.req.query('limit'), 'limit') ?? 20) });
  });

  // Webhooks: every merge posted to an address a person registered (packages/core/src/webhooks.ts).
  app.get('/v1/webhooks', async (c) => c.json({ webhooks: await listWebhooks(catalog, await signedIn(c)) }));

  app.post('/v1/webhooks', async (c) => {
    const by = await signedIn(c);
    const input = await body<{ url?: string }>(c);
    if (!input.url) throw new HttpError(400, 'give the address (url) to post to');
    return c.json(await createWebhook(catalog, by, input.url), 201);
  });

  app.delete('/v1/webhooks/:id', async (c) => {
    const by = await signedIn(c);
    await deleteWebhook(catalog, by, intParam(c.req.param('id'), 'id')!);
    return c.json({ ok: true });
  });

  app.post('/v1/follows', async (c) => {
    const by = await signedIn(c);
    const input = await body<{ kind?: 'entity' | 'set' | 'project' | 'changeset' | 'report'; id?: string; on?: boolean }>(c);
    if (!input.kind || !input.id) throw new HttpError(400, 'say what to follow (kind and id)');
    if (!['entity', 'set', 'project', 'changeset', 'report'].includes(input.kind)) throw new HttpError(400, 'kind is entity, set, project, changeset or report');
    await catalog.follow(by, { kind: input.kind, id: input.id }, input.on ?? true);
    return c.json({ ok: true });
  });

  app.notFound((c) => c.json({ error: 'not-found', message: 'no such route; see /openapi.json' }, 404));
  return app;
}

/** The API's version: /v1 changes only by adding (docs/developers/api.md, Stability). */
export const API_VERSION = '1.0.0';

/**
 * What crawlers may read on the API: the guides for agents, and the files
 * (a sefer's shaar is the picture its page is shared with), and what the
 * Sichos Kodesh apps read (`/v1/app/`: they are not crawlers, but some
 * fetchers heed robots.txt); not the other routes, which the site's pages
 * already show, made once and kept at the edge.
 */
export const API_ROBOTS_TXT = ['User-agent: *', 'Allow: /llms.txt', 'Allow: /openapi.json', 'Allow: /objects/', 'Allow: /v1/app/', 'Disallow: /', ''].join('\n');

/** The API's own /llms.txt: a pointer for agents that land here first. */
function apiLlmsTxt(api: string, site: string): string {
  const home = site.replace(/\/+$/, '');
  return `# RebbeHub API

> The open, community-edited index of Chabad Torah and media: sefarim, sichos, letters, farbrengens, recordings and scans, with their texts. Reading needs no account.

- [OpenAPI 3.1 description](${api}/openapi.json): every route
- [MCP server](${api}/mcp): tools search, get_item, list_children, get_text, suggest_fix, list_issues, open_issue (Streamable HTTP, POST). Reading needs no account; the writing tools ask to connect with OAuth (${api}/.well-known/oauth-protected-resource/mcp) or take a personal token
- [Developer docs](${home}/developers): getting started, tokens, rate limits, rights
- [Full docs for LLMs](${home}/llms-full.txt)

Ids (rh-...) never change. Words a machine read or heard are marked until a person checks them. Rights: ${home}/developers/rights
`;
}

/** Verifies a Cloudflare Turnstile token. */
export function turnstileVerifier(secret: string): NonNullable<ApiOptions['verifyCaptcha']> {
  return async (token, ip) => {
    if (!token) return false;
    const form = new FormData();
    form.set('secret', secret);
    form.set('response', token);
    if (ip) form.set('remoteip', ip);
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  };
}
