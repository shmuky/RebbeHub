import type { Context, Hono } from 'hono';
import {
  CatalogError,
  familyRequest,
  filePages,
  getFile,
  itemsUsingFile,
  proposeUpload,
  similarFiles,
  similarScans,
  suggestContents,
  teshurosSetId,
  type Catalog,
  type EntityView,
  type FilePageRow,
  type SimilarFile,
} from '@rebbehub/core';
import { isEntityId, mayServe, readId, sha256Hex, type EntityId, type LocalName } from '@rebbehub/model';
import { HttpError } from './app.js';

/**
 * Scans and files (the plan's phase 3): a served scan's pages as images
 * and as a IIIF manifest any library viewer opens; what a held file looks
 * like ("we already have this — here"); what an upload is, guessed before
 * it is sent; "Map a teshura"; and a family's request that a teshura not
 * be shown.
 */

export interface ScanRouteOptions {
  /** Where servable files are fetched from (`<base>/objects/<sha256>`), for this request. */
  filesBase: (c: Context) => string | null;
  /** The site's address, for a manifest's link home. */
  siteUrl: string;
  signedIn: (c: Context) => Promise<string>;
  authenticate?: (c: Context) => Promise<string | null> | string | null;
  reportSalt?: string;
  verifyCaptcha?: (token: string | undefined, ip: string | undefined) => Promise<boolean>;
  reportsPerHour?: number;
}

type Names = Record<string, string[]>;

/** A catalog name as IIIF's language map: `{ he: [...], en: [...] }`. */
const languageMap = (name: LocalName | undefined, fallback: string): Names => {
  const out: Names = {};
  if (name?.he) out.he = [name.he];
  if (name?.en) out.en = [name.en];
  return Object.keys(out).length ? out : { none: [fallback] };
};

export interface ManifestInput {
  /** The manifest's own address. */
  id: string;
  scan: EntityView;
  publication: EntityView | null;
  pages: FilePageRow[];
  filesBase: string;
  pdfUrl: string;
  credit: string | null;
  siteUrl: string;
}

/**
 * A scan as a IIIF Presentation 3 manifest: one canvas per page, each
 * painted with its page image (static JPEGs, which Mirador, the Universal
 * Viewer and every IIIF viewer open), read right to left, with the whole
 * PDF as its rendering and the credit its rights require.
 */
export function iiifManifest(input: ManifestInput): Record<string, unknown> {
  const pub = (input.publication?.data ?? {}) as { title?: LocalName; publisher?: string; placePrinted?: string; date?: string; gregorianYear?: number; printing?: number; simcha?: { families?: string[] } };
  const scanData = input.scan.data as { pageLabels?: Array<{ pdfPage: number; printed: string }> };
  const title = languageMap(pub.title, input.scan.id);
  const labels = [...(scanData.pageLabels ?? [])].sort((a, b) => a.pdfPage - b.pdfPage);
  const printedAt = (page: number) => {
    const start = labels.filter((l) => l.pdfPage <= page).at(-1);
    return start && start.pdfPage === page ? start.printed : null;
  };
  const image = (sha: string) => `${input.filesBase}/objects/${sha}`;
  const home = `${input.siteUrl.replace(/\/$/, '')}${input.publication?.path ?? input.scan.path ?? `/${input.scan.id}`}`;
  const metadata: Array<{ label: Names; value: Names }> = [];
  const fact = (he: string, en: string, value: string | number | undefined) => value !== undefined && value !== '' && metadata.push({ label: { he: [he], en: [en] }, value: { none: [String(value)] } });
  fact('הוצאה', 'Publisher', [pub.publisher, pub.placePrinted].filter(Boolean).join(', ') || undefined);
  fact('שנה', 'Year', [pub.date, pub.gregorianYear].filter(Boolean).join(' · ') || undefined);
  fact('דפוס', 'Printing', pub.printing);
  fact('משפחות', 'Families', pub.simcha?.families?.join(' – '));
  fact('מזהה', 'RebbeHub id', input.scan.id);
  const pages = input.pages.filter((p) => p.image_sha256 && p.image_width && p.image_height);
  const thumb = (p: FilePageRow) => (p.thumb_sha256 ? [{ id: image(p.thumb_sha256), type: 'Image', format: 'image/jpeg', width: p.thumb_width, height: p.thumb_height }] : undefined);
  return {
    '@context': 'http://iiif.io/api/presentation/3/context.json',
    id: input.id,
    type: 'Manifest',
    label: title,
    metadata,
    ...(input.credit ? { requiredStatement: { label: { he: ['קרדיט'], en: ['Credit'] }, value: { none: [input.credit] } } } : {}),
    provider: [{ id: input.siteUrl, type: 'Agent', label: { he: ['רביהאב'], en: ['RebbeHub'] }, homepage: [{ id: input.siteUrl, type: 'Text', label: { en: ['RebbeHub'] }, format: 'text/html' }] }],
    homepage: [{ id: home, type: 'Text', label: title, format: 'text/html' }],
    rendering: [{ id: input.pdfUrl, type: 'Text', label: { he: ['PDF'], en: ['PDF'] }, format: 'application/pdf' }],
    viewingDirection: 'right-to-left',
    behavior: ['paged'],
    ...(pages[0] && thumb(pages[0]) ? { thumbnail: thumb(pages[0]) } : {}),
    items: pages.map((p) => {
      const canvas = `${input.id.replace(/\.json$/, '')}/canvas/${p.page}`;
      const printed = printedAt(p.page);
      return {
        id: canvas,
        type: 'Canvas',
        label: { none: [printed ? `${p.page} (${printed})` : String(p.page)] },
        width: p.image_width,
        height: p.image_height,
        ...(thumb(p) ? { thumbnail: thumb(p) } : {}),
        items: [
          {
            id: `${canvas}/page`,
            type: 'AnnotationPage',
            items: [{ id: `${canvas}/image`, type: 'Annotation', motivation: 'painting', body: { id: image(p.image_sha256!), type: 'Image', format: 'image/jpeg', width: p.image_width, height: p.image_height }, target: canvas }],
          },
        ],
      };
    }),
  };
}

export function scanRoutes(app: Hono, catalog: Catalog, options: ScanRouteOptions): void {
  /** A scan whose file RebbeHub serves, with the file and its base address; else not found. */
  const servedScan = async (c: Context, raw: string) => {
    const id = readId(raw);
    const scan = id ? await catalog.get(id) : null;
    if (!scan || scan.type !== 'scan') throw new CatalogError('not-found', 'no such scan');
    const file = await getFile(catalog.db, String((scan.data as { file?: string }).file ?? ''));
    const base = options.filesBase(c);
    if (!file || !base || !mayServe(file.rights_state) || file.storage_tier !== 'public') throw new CatalogError('not-found', "this scan is not served here for its rights; it is linked at its source");
    return { scan, file, base };
  };

  // A served scan as a IIIF manifest, beside the other published manifests (/manifests/…), for any library viewer.
  app.get('/manifests/iiif/:file{rh-[0-9a-z]+\\.json}', async (c) => {
    const { scan, file, base } = await servedScan(c, c.req.param('file').replace(/\.json$/, ''));
    const pages = await filePages(catalog.db, file.sha256);
    if (!pages.some((p) => p.image_sha256)) throw new CatalogError('not-found', 'this scan has no page images yet');
    const publicationId = (scan.data as { publication?: string }).publication;
    const publication = publicationId && isEntityId(publicationId) ? await catalog.get(publicationId) : null;
    const manifest = iiifManifest({
      id: `${new URL(c.req.url).origin}/manifests/iiif/${scan.id}.json`,
      scan,
      publication,
      pages,
      filesBase: base,
      pdfUrl: `${base}/objects/${file.sha256}`,
      credit: file.credit,
      siteUrl: options.siteUrl,
    });
    return c.json(manifest, 200, { 'Content-Type': 'application/ld+json;profile="http://iiif.io/api/presentation/3/context.json"', 'Cache-Control': 'public, max-age=300' });
  });

  // A served scan's page images and thumbnails, in page order, with where its IIIF manifest is.
  app.get('/v1/scans/:id/pages', async (c) => {
    const { scan, file, base } = await servedScan(c, c.req.param('id'));
    const pages = (await filePages(catalog.db, file.sha256)).filter((p) => p.image_sha256);
    return c.json({
      scan: scan.id,
      manifest: pages.length ? `${new URL(c.req.url).origin}/manifests/iiif/${scan.id}.json` : null,
      pages: pages.map((p) => ({ page: p.page, width: p.image_width, height: p.image_height, image: `${base}/objects/${p.image_sha256}`, thumbnail: p.thumb_sha256 ? `${base}/objects/${p.thumb_sha256}` : null })),
    });
  });

  /** Similar files, each with the items that use it (a scan with its publication), for people to see. */
  const withItems = async (similar: SimilarFile[]) =>
    Promise.all(
      similar.map(async (s) => {
        const items = await itemsUsingFile(catalog.db, s.sha256);
        return { ...s, items: items.map((i) => ({ id: i.id, type: i.type, path: i.path, publication: typeof i.data.publication === 'string' ? i.data.publication : null })) };
      }),
    );

  // What a held file looks like, from the jobs' measurements: the same scan or recording in other bytes. A machine's guess.
  app.get('/v1/files/:sha256/similar', async (c) => {
    const sha256 = c.req.param('sha256');
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new HttpError(400, 'a file is named by its sha256');
    if (!(await getFile(catalog.db, sha256))) throw new CatalogError('not-found', 'no such file');
    return c.json({ sha256, machine: true, similar: await withItems(await similarFiles(catalog.db, sha256)) });
  });

  // Before an upload is sent: its sha256 and a few pages' hashes (made in the browser) say whether we have it, and what it likely is.
  app.post('/v1/uploads/check', async (c) => {
    await options.signedIn(c);
    const input = await c.req.json<{ for?: string; sha256?: string; pageHashes?: unknown[]; title?: string }>().catch(() => ({}) as Record<string, undefined>);
    const target = input.for && isEntityId(input.for) ? await catalog.get(input.for as EntityId) : null;
    if (!target) throw new HttpError(400, 'say which item the file is added to (for)');
    const teshurosSet = target.id === (await teshurosSetId());
    if (target.type !== 'work' && target.type !== 'publication' && !teshurosSet) throw new HttpError(400, 'a scan is added to a sefer, a printing, or the Teshuros set');
    const sha256 = typeof input.sha256 === 'string' && /^[0-9a-f]{64}$/.test(input.sha256) ? input.sha256 : null;
    const usedBy = sha256 && (await getFile(catalog.db, sha256)) ? (await itemsUsingFile(catalog.db, sha256)).map((i) => ({ id: i.id, type: i.type, path: i.path })) : [];
    const hashes = (Array.isArray(input.pageHashes) ? input.pageHashes : []).slice(0, 64).map((h) => (typeof h === 'string' && /^[0-9a-f]{64}$/.test(h) ? h : null));
    const similar = (await withItems(await similarScans(catalog.db, hashes, { exclude: sha256 ?? undefined }))).map((s) => ({
      ...s,
      scans: s.items.filter((i) => i.type === 'scan').map((i) => ({ id: i.id as EntityId, publication: (i.publication as EntityId | null) ?? null })),
    }));
    const workId = target.type === 'work' ? target.id : target.type === 'publication' ? (target.data as { work?: string }).work : undefined;
    const publications = workId && isEntityId(workId) ? await catalog.getMany((await catalog.backlinks(workId as EntityId, { field: 'work', type: 'publication' })).map((b) => b.from)) : [];
    const proposal = proposeUpload({ target, title: typeof input.title === 'string' ? input.title : undefined, teshurosSet, usedBy, similar, publications });
    // The publications named, for their titles.
    const named = await catalog.getMany([...new Set(similar.flatMap((s) => s.scans.map((x) => x.publication)).filter((p): p is EntityId => p !== null))]);
    const brief = (p: EntityView) => {
      const d = p.data as { kind?: string; title?: LocalName; publisher?: string; date?: string; gregorianYear?: number; printing?: number };
      return { id: p.id, path: p.path, kind: d.kind, title: d.title, publisher: d.publisher ?? null, date: d.date ?? null, gregorianYear: d.gregorianYear ?? null, printing: d.printing ?? null };
    };
    return c.json({ proposal, usedBy, similar, machine: true, publications: [...publications, ...named.filter((n) => !publications.some((p) => p.id === n.id))].map(brief) });
  });

  // "Map a teshura": pages of a publication linked to a unit, a new unit, or words; one suggestion for the keepers.
  app.post('/v1/suggestions/contents-map', async (c) => {
    const by = await options.signedIn(c);
    const input = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!input || typeof input !== 'object') throw new HttpError(400, 'the request body must be JSON');
    const pages = input.pages as { from?: unknown; to?: unknown; scheme?: unknown } | undefined;
    const name = (v: unknown): LocalName | undefined => (v && typeof v === 'object' && typeof (v as LocalName).he === 'string' ? { he: (v as LocalName).he, ...(typeof (v as LocalName).en === 'string' ? { en: (v as LocalName).en } : {}) } : undefined);
    const newUnit = input.newUnit as { work?: unknown; label?: unknown; date?: unknown } | undefined;
    const result = await suggestContents(catalog, by, {
      publication: String(input.publication ?? '') as EntityId,
      pages: { from: Number(pages?.from), to: Number(pages?.to), scheme: pages?.scheme as 'printed' },
      unit: typeof input.unit === 'string' && input.unit ? (readId(input.unit) ?? (input.unit as EntityId)) : undefined,
      newUnit: newUnit ? { work: String(newUnit.work ?? '') as EntityId, label: name(newUnit.label) ?? { he: '' }, date: typeof newUnit.date === 'string' && newUnit.date ? newUnit.date : undefined } : undefined,
      label: name(input.label),
    });
    return c.json(result, 201);
  });

  // A family's request that a teshura not be shown: no account needed (a captcha and a rate limit, as for reports).
  app.post('/v1/teshuros/:id/family-request', async (c) => {
    const id = readId(c.req.param('id'));
    if (!id) throw new HttpError(400, 'not an id');
    const input = await c.req.json<{ relation?: string; note?: string; contact?: string; captcha?: string }>().catch(() => ({}) as Record<string, undefined>);
    const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim();
    const account = (await options.authenticate?.(c)) ?? null;
    if (!account && options.verifyCaptcha && !(await options.verifyCaptcha(input.captcha, ip))) throw new HttpError(403, 'the captcha was not solved');
    const reporterHash = ip ? await sha256Hex(`${options.reportSalt ?? 'rebbehub'}\u0000${ip}`) : undefined;
    if (reporterHash && !account) {
      const { rows } = await catalog.db.query<{ n: number }>("SELECT count(*)::int AS n FROM report WHERE reporter_hash = $1 AND created_at > now() - interval '1 hour'", [reporterHash]);
      if ((rows[0]?.n ?? 0) >= (options.reportsPerHour ?? 10)) throw new HttpError(429, 'too many requests from here in the last hour; please try again later');
    }
    const done = await familyRequest(catalog, {
      publication: id,
      relation: typeof input.relation === 'string' ? input.relation : undefined,
      note: typeof input.note === 'string' ? input.note : undefined,
      contact: typeof input.contact === 'string' ? input.contact : undefined,
      reporter: account ?? undefined,
      reporterHash,
    });
    // Say only what happened to the scans; the request itself is for the stewards.
    return c.json({ report: done.report, paused: done.paused.length }, 201);
  });
}

