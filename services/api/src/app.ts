import { Hono, type Context } from 'hono';
import { Catalog, CatalogError, ExportGate, UnresolvedConflictError, getFile, type ChangesetStatus, type EntityView, type Json, type ReportReason, type Resolution } from '@rebbehub/core';
import { parseDateText, describeDateKey } from '@rebbehub/hebrew';
import { ENTITY_TYPES, isEntityId, mayServe, readId, sha256Hex, type EntityId, type EntityType } from '@rebbehub/model';
import { OPENAPI } from './openapi.js';

/**
 * The RebbeHub API. Reading needs nothing; reporting a problem needs no
 * account (a captcha and a rate limit instead); suggesting and reviewing
 * need a signed-in account, which the deployment establishes through
 * `authenticate` (accounts and sign-in arrive in phase 2 - until then no
 * request is signed in and those routes answer 401).
 */

export interface ApiOptions {
  catalog: Catalog;
  /** The account a request is signed in as, or null. */
  authenticate?: (c: Context) => Promise<string | null> | string | null;
  /** Salt for hashing reporters' addresses (only the hash is kept, for rate limits). */
  reportSalt?: string;
  /** Verifies a report's captcha token (Cloudflare Turnstile); unset, reports need none. */
  verifyCaptcha?: (token: string | undefined, ip: string | undefined) => Promise<boolean>;
  /** Reports one address may send per hour. */
  reportsPerHour?: number;
  /** Where servable files are fetched from: `<filesBaseUrl>/objects/<sha256>` (the media proxy in front of R2). */
  filesBaseUrl?: string;
  version?: string;
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

class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 422 | 429,
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

  // Words whose rights forbid copies are never served, only listed.
  const redact = (views: EntityView[]): Promise<Array<EntityView & { withheld?: string }>> => {
    const gate = new ExportGate(catalog);
    return Promise.all(views.map((v) => gate.redact(v)));
  };

  const signedIn = async (c: Context): Promise<string> => {
    const account = (await options.authenticate?.(c)) ?? null;
    if (!account) throw new HttpError(401, 'sign in to do this');
    return account;
  };

  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ error: 'bad-request', message: error.message }, error.status);
    if (error instanceof UnresolvedConflictError) return c.json({ error: 'conflict', message: error.message, conflicts: error.conflicts }, 409);
    if (error instanceof CatalogError) return c.json({ error: error.code, message: error.message, detail: error.detail ?? null }, STATUS_BY_CODE[error.code]);
    console.error(error);
    return c.json({ error: 'internal', message: 'something went wrong on our side' }, 500);
  });

  app.use('*', async (c, next) => {
    await next();
    c.header('Access-Control-Allow-Origin', '*');
    c.header('X-Content-Type-Options', 'nosniff');
  });

  app.get('/', (c) => c.redirect('/v1'));
  app.get('/openapi.json', (c) => c.json(OPENAPI));

  app.get('/v1', async (c) =>
    c.json({
      name: 'RebbeHub',
      version: options.version ?? '0.1.0',
      head: await catalog.head(),
      docs: '/openapi.json',
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
    const items = await catalog.list({
      type: type as EntityType | undefined,
      set: set ? entityId(set) : undefined,
      after: c.req.query('after'),
      limit: intParam(c.req.query('limit'), 'limit'),
    });
    const last = items[items.length - 1];
    return c.json({ items: await redact(items), next: last ? `${last.path ?? ''}${last.id}` : null });
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
    const items = await catalog.children(entityId(c.req.param('id')), field, type as EntityType, { after: c.req.query('after'), limit: intParam(c.req.query('limit'), 'limit') });
    const last = items[items.length - 1] as { data: { order?: string } } | undefined;
    return c.json({ items: await redact(items), next: last?.data.order ?? null });
  });

  app.get('/v1/events', async (c) => {
    const within = c.req.query('within');
    const day = c.req.query('day');
    if (!within && !day) throw new HttpError(400, 'give within (5742 or 5742-05) or day (05-10)');
    return c.json({ items: await catalog.events({ within, day, limit: intParam(c.req.query('limit'), 'limit') }) });
  });

  app.get('/v1/stats', async (c) => c.json({ head: await catalog.head(), counts: await catalog.counts() }));

  app.get('/v1/files/:sha256', async (c) => {
    const sha256 = c.req.param('sha256');
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new HttpError(400, 'a file is named by its sha256');
    const file = await getFile(catalog.db, sha256);
    if (!file) throw new CatalogError('not-found', 'no such file');
    const served = mayServe(file.rights_state) && file.storage_tier === 'public' && options.filesBaseUrl;
    return c.json({ sha256, bytes: file.bytes, mime: file.mime, rights: file.rights_state, credit: file.credit, url: served ? `${options.filesBaseUrl}/objects/${sha256}` : null });
  });

  app.get('/v1/entities/:id', async (c) => {
    const id = entityId(c.req.param('id'));
    const at = intParam(c.req.query('at'), 'at');
    const entity = await catalog.get(id, { at });
    if (!entity) throw new CatalogError('not-found', `${id} not found`);
    return c.json((await redact([entity]))[0]);
  });

  app.get('/v1/entities/:id/history', async (c) => c.json({ history: await catalog.history(entityId(c.req.param('id'))) }));

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

  app.get('/v1/editions', async (c) => c.json({ editions: await catalog.editions() }));

  app.get('/v1/commits', async (c) => {
    const since = intParam(c.req.query('since'), 'since') ?? 0;
    const limit = Math.min(intParam(c.req.query('limit'), 'limit') ?? 20, 100);
    const gate = new ExportGate(catalog);
    const commits = await catalog.commitsSince(since, limit);
    for (const commit of commits) {
      commit.changes = await Promise.all(commit.changes.map(async (change) => (change.data === null ? change : { ...change, data: (await gate.redact({ ...change, data: change.data })).data })));
    }
    return c.json({ commits });
  });

  // ---------------------------------------------------------------- reports (no account needed)

  app.post('/v1/reports', async (c) => {
    const input = await body<{ entityId?: string; reason?: string; note?: string; captcha?: string }>(c);
    if (!input.reason || !REPORT_REASONS.includes(input.reason as ReportReason)) throw new HttpError(400, `reason must be one of ${REPORT_REASONS.join(', ')}`);
    const ip = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim();
    const account = (await options.authenticate?.(c)) ?? null;
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
    });
    return c.json({ id }, 201);
  });

  app.get('/v1/reports', async (c) => {
    await signedIn(c);
    const set = c.req.query('set');
    const status = c.req.query('status');
    if (status && !['open', 'resolved', 'dismissed'].includes(status)) throw new HttpError(400, 'status is open, resolved or dismissed');
    return c.json({ reports: await catalog.reports({ set: set ? entityId(set) : undefined, status: status as 'open' | undefined }) });
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
    const status = c.req.query('status');
    if (status && !STATUSES.includes(status as ChangesetStatus)) throw new HttpError(400, `status is one of ${STATUSES.join(', ')}`);
    return c.json({
      suggestions: await catalog.listChangesets({
        status: status as ChangesetStatus | undefined,
        author: c.req.query('author'),
        postReview: c.req.query('postReview') === 'true',
        limit: intParam(c.req.query('limit'), 'limit'),
      }),
    });
  });

  app.get('/v1/suggestions/:id', async (c) => {
    const view = await catalog.review(intParam(c.req.param('id'), 'id')!);
    const gate = new ExportGate(catalog);
    const hide = async (type: string, id: EntityId, data: Json | null) => (data === null ? null : ((await gate.redact({ id, type: type as EntityType, path: null, rev: 0, data })) as { withheld?: string }).withheld);
    for (const entry of view.entries) {
      const withheld = (await hide(entry.type, entry.entityId, entry.after)) ?? (await hide(entry.type, entry.entityId, entry.before));
      if (withheld) Object.assign(entry, { before: null, after: null, changes: [], conflicts: [], withheld });
    }
    return c.json(view);
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

  app.post('/v1/follows', async (c) => {
    const by = await signedIn(c);
    const input = await body<{ kind?: 'entity' | 'set' | 'project' | 'changeset'; id?: string; on?: boolean }>(c);
    if (!input.kind || !input.id) throw new HttpError(400, 'say what to follow (kind and id)');
    await catalog.follow(by, { kind: input.kind, id: input.id }, input.on ?? true);
    return c.json({ ok: true });
  });

  app.notFound((c) => c.json({ error: 'not-found', message: 'no such route; see /openapi.json' }, 404));
  return app;
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
