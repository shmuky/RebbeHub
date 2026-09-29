import type { Context, Hono } from 'hono';
import { CatalogError, ExportGate, SITEMAP_PAGE_SIZE, SITEMAP_TYPES, coverSources, sitemapChunks, sitemapPage, coversOf, fileAbout, linkedCounts, linkedPage, pdfPageCount, type Catalog, type CoverView, type EntityView } from '@rebbehub/core';
import { mayServe, readId, type EntityId, type EntityType } from '@rebbehub/model';
import { HttpError } from './app.js';
import { cursor, nextLink } from './platform.js';

/**
 * What every item's page needs beyond the item (the plan: "one permanent
 * page per item"): everything that points at it, grouped, counted and a
 * page at a time, so a set lists every sefer and a sefer every sicha and no
 * list ends without saying how much more there is; the covers of sefarim,
 * drawn from their title pages (core/covers.ts); and a file's own page.
 */

export interface PageRouteOptions {
  /** Where servable files are fetched from (`<base>/objects/<sha256>`), for this request. */
  filesBase: (c: Context) => string | null;
}

const whole = (value: string | undefined, name: string, max: number): number | undefined => {
  if (value === undefined || value === '') return undefined;
  if (!/^\d+$/.test(value)) throw new HttpError(400, `${name} must be a whole number`);
  return Math.min(Number(value), max);
};

const idOf = (raw: string): EntityId => {
  const id = readId(raw);
  if (!id) throw new HttpError(400, `"${raw}" is not an id (rh-…)`);
  return id;
};

/** A cover as the API gives it: its pictures' addresses, the page, and whether a machine chose it. */
export function coverJson(cover: CoverView, base: string) {
  return {
    file: cover.file,
    page: cover.page,
    machine: cover.machine,
    reasons: cover.reasons,
    credit: cover.credit,
    image: { url: `${base}/objects/${cover.image.sha256}`, width: cover.image.width, height: cover.image.height },
    thumb: { url: `${base}/objects/${cover.thumb.sha256}`, width: cover.thumb.width, height: cover.thumb.height },
  };
}

export function pageRoutes(app: Hono, catalog: Catalog, options: PageRouteOptions): void {
  const redact = (views: EntityView[]) => {
    const gate = new ExportGate(catalog);
    return Promise.all(views.map((v) => gate.redact(v)));
  };

  // What points at an item, by kind and field, with how many of each: the groups an item's page lists.
  app.get('/v1/entities/:id/linked/counts', async (c) => c.json({ groups: await linkedCounts(catalog.db, idOf(c.req.param('id'))) }));

  // One group of it, in its own order, a page at a time, with the total: `?field=work&type=unit&cursor=<next>` (`after` is read the same).
  app.get('/v1/entities/:id/linked', async (c) => {
    const field = c.req.query('field');
    const type = c.req.query('type');
    if (!field) throw new HttpError(400, 'say which field points here (field=work)');
    if (type && !(await catalog.registry()).has(type)) throw new HttpError(400, `unknown type "${type}"`);
    // The API's cursor wraps core's sort-key cursor; a bare one (what `next` was at first) is read as it is.
    const raw = c.req.query('cursor') || c.req.query('after') || undefined;
    const after = raw === undefined ? undefined : String(cursor.decode(raw)?.[0] ?? raw);
    const page = await linkedPage(catalog.db, idOf(c.req.param('id')), {
      field,
      type: type as EntityType | undefined,
      after,
      limit: whole(c.req.query('limit'), 'limit', 500),
    });
    const next = page.next ? cursor.encode([page.next]) : null;
    nextLink(c, next);
    return c.json({ items: await redact(page.items), total: page.total, next });
  });

  // The covers of sefarim, drawn from their title pages, for a shelf of them: `?ids=rh-…,rh-…`. Only those still served.
  app.get('/v1/covers', async (c) => {
    const ids = (c.req.query('ids') ?? '')
      .split(',')
      .filter(Boolean)
      .map(idOf);
    if (ids.length > 200) throw new HttpError(400, 'at most 200 ids at a time');
    const base = options.filesBase(c);
    if (!base) return c.json({ covers: {} });
    const covers = await coversOf(catalog.db, ids);
    return c.json({ covers: Object.fromEntries(Object.entries(covers).map(([id, cover]) => [id, coverJson(cover, base)])) }, 200, { 'Cache-Control': 'public, max-age=300' });
  });

  // A sefer's cover and the PDFs a keeper may choose its title page from, with how many pages each has.
  app.get('/v1/works/:id/cover', async (c) => {
    const work = await catalog.get(idOf(c.req.param('id')));
    if (!work || work.type !== 'work') throw new CatalogError('not-found', 'no such sefer');
    const base = options.filesBase(c);
    const cover = base ? (await coversOf(catalog.db, [work.id]))[work.id] : undefined;
    const sources = await coverSources(catalog.db, work.id);
    return c.json({
      work: work.id,
      chosen: (work.data as { cover?: unknown }).cover ?? null,
      cover: cover && base ? coverJson(cover, base) : null,
      sources: await Promise.all(sources.map(async (s) => ({ ...s, pages: await pdfPageCount(catalog.db, s.sha256) }))),
    });
  });

  // A file's own page: what it is, its rights, where it came from, what was made from it, and what uses it.
  app.get('/v1/files/:sha256/about', async (c) => {
    const about = await fileAbout(catalog.db, c.req.param('sha256'), { limit: whole(c.req.query('limit'), 'limit', 500) });
    if (!about) throw new CatalogError('not-found', 'no such file');
    const base = options.filesBase(c);
    const served = mayServe(about.file.rights_state) && about.file.storage_tier === 'public' && base !== null;
    return c.json({
      sha256: about.file.sha256,
      bytes: Number(about.file.bytes),
      mime: about.file.mime,
      rights: about.file.rights_state,
      credit: about.file.credit,
      storage: about.file.storage_tier,
      url: served ? `${base}/objects/${about.file.sha256}` : null,
      createdAt: new Date(about.file.created_at).toISOString(),
      sources: about.sources,
      derivations: about.derivations,
      derivedFrom: about.derivedFrom,
      measured: about.measured,
      pageImages: about.pageImages,
      pageFix: about.pageFix,
      covers: about.covers,
      usedBy: { total: about.usedBy.total, items: await redact(about.usedBy.items.map((i) => ({ id: i.id, type: i.type as EntityType, path: i.path, rev: 0, data: i.data as never }))) },
    });
  });

  // For crawlers: every sitemap there is (each type in pages of SITEMAP_PAGE_SIZE items), then one page's items with when each
  // last changed. The site's /sitemap.xml and /sitemaps/<type>-<page>.xml are made from these. Slow to change: kept at the edge an hour.
  const LONG = 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400';
  app.get('/v1/sitemap', async (c) => c.json({ pageSize: SITEMAP_PAGE_SIZE, sitemaps: await sitemapChunks(catalog.db) }, 200, { 'Cache-Control': LONG }));
  app.get('/v1/sitemap/:type/:page{[0-9]+}', async (c) => {
    const type = c.req.param('type') as EntityType;
    if (!SITEMAP_TYPES.includes(type)) throw new CatalogError('not-found', `there is no sitemap of ${type}`);
    const page = Number(c.req.param('page'));
    const items = page >= 1 ? await sitemapPage(catalog.db, type, page) : [];
    if (!items.length) throw new CatalogError('not-found', `${type} has no page ${page}`);
    return c.json({ type, page, items }, 200, { 'Cache-Control': LONG });
  });
}
