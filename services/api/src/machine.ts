import type { Context, Hono } from 'hono';
import { machineRequests, machineSummary, requestMachineWork, summariseTraining, trainingClips, trainingGoal, type Catalog, type MachineKind, type MachineRequestStatus } from '@rebbehub/core';
import { readId, type EntityId } from '@rebbehub/model';
import { HttpError } from './app.js';

/**
 * Asking the machines for work (core/machineWork.ts), for the site, agents
 * and anyone's tools:
 *
 *   GET  /v1/machine                      what waits, what is left, what was done this week
 *   GET  /v1/machine/requests?kind=&item=&items=&status=&limit=
 *                                         the requests, the waiting ones in the order they are taken
 *   POST /v1/machine/requests { kind, item }
 *                                         "read this scan" (ocr) or "transcribe this recording"
 *                                         (transcript); asking again joins the waiting request
 *   GET  /v1/machine/training?since=      the next Rebbe Whisper's training data so far: hours, clips,
 *                                         and what was checked since the last round
 *   GET  /v1/machine/training/clips       those clips, one JSON object a line, as the training
 *                                         script reads them (core/trainingClips.ts)
 *
 * A request is answered by the free CPU jobs (services/jobs): at once
 * when `dispatch` can start them (GitHub Actions), else on their nightly
 * run. Nothing a request starts costs money.
 */
export type MachineDispatch = (kind: MachineKind) => Promise<boolean>;

const KINDS = ['ocr', 'transcript'];
const STATUSES = ['waiting', 'running', 'done', 'failed'];

export function machineRoutes(app: Hono, catalog: Catalog, signedIn: (c: Context) => Promise<string>, options: { dispatch?: MachineDispatch; waitUntil?: (c: Context, work: Promise<unknown>) => void } = {}): void {
  const id = (raw: string): EntityId => {
    const read = readId(raw);
    if (!read) throw new HttpError(400, `"${raw}" is not an id (rh-…)`);
    return read;
  };

  app.get('/v1/machine', async (c) => c.json({ ...(await machineSummary(catalog)), startsAtOnce: Boolean(options.dispatch) }));

  // The retraining cycle's data: what people's checking has made so far. One query each; the words are the site's own, the audio stays where it is.
  // Shown on every transcript, so kept for ten minutes at the edge: the database is asked a few times an hour, not once a page.
  app.get('/v1/machine/training', async (c) => {
    const since = c.req.query('since');
    if (since && Number.isNaN(Date.parse(since))) throw new HttpError(400, 'since is a date, like 2026-09-29');
    return edgeCached(c.req.raw, 600, async () => {
      const all = await trainingClips(catalog);
      return Response.json({ ...summariseTraining(all, since), goal: await trainingGoal(catalog, all) });
    });
  });

  app.get('/v1/machine/training/clips', async (c) =>
    edgeCached(c.req.raw, 3600, async () => {
      const { clips } = await trainingClips(catalog);
      return new Response(clips.map((clip) => JSON.stringify(clip)).join('\n') + (clips.length ? '\n' : ''), {
        headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Content-Disposition': 'inline; filename="clips-site.jsonl"' },
      });
    }),
  );

  app.get('/v1/machine/requests', async (c) => {
    const kind = c.req.query('kind');
    if (kind && !KINDS.includes(kind)) throw new HttpError(400, 'kind is ocr or transcript');
    const status = c.req.query('status');
    if (status && !STATUSES.includes(status)) throw new HttpError(400, `status is ${STATUSES.join(', ')}`);
    const item = c.req.query('item');
    const items = (c.req.query('items') ?? '').split(',').filter(Boolean);
    if (items.length > 100) throw new HttpError(400, 'at most 100 items');
    const limit = c.req.query('limit');
    if (limit !== undefined && !/^\d{1,3}$/.test(limit)) throw new HttpError(400, 'limit must be a whole number');
    const requests = await machineRequests(catalog, {
      kind: kind as MachineKind | undefined,
      status: status as MachineRequestStatus | undefined,
      item: item ? id(item) : undefined,
      items: items.length ? items.map(id) : undefined,
      limit: limit === undefined ? undefined : Number(limit),
    });
    return c.json({ requests });
  });

  app.post('/v1/machine/requests', async (c) => {
    const by = await signedIn(c);
    let input: { kind?: unknown; item?: unknown };
    try {
      input = await c.req.json();
    } catch {
      throw new HttpError(400, 'the request body must be JSON');
    }
    if (typeof input?.item === 'string') input.item = id(input.item);
    const { request, created } = await requestMachineWork(catalog, by, input ?? {});
    let dispatched = false;
    if (created && options.dispatch) {
      const started = options.dispatch(request.kind).catch((error: unknown) => {
        console.error('machine dispatch', error);
        return false;
      });
      // On Workers the answer need not wait for GitHub; elsewhere it does, and says whether it started.
      if (options.waitUntil) {
        options.waitUntil(c, started);
        dispatched = true;
      } else dispatched = await started;
    }
    return c.json({ request, created, startsAtOnce: dispatched }, created ? 201 : 200);
  });
}

/**
 * Starts the machine's GitHub Actions workflow for requests of a kind
 * (.github/workflows/ocr.yml or transcribe.yml), with a token that may run
 * that repository's workflows and nothing else. Only the free engines are
 * asked for: the requested-only run on the runner's CPU.
 */
export function githubDispatch(input: { token: string; repo?: string; ref?: string; fetch?: typeof fetch }): MachineDispatch {
  const repo = input.repo || 'shmuky/RebbeHub';
  return async (kind) => {
    const workflow = kind === 'ocr' ? 'ocr.yml' : 'transcribe.yml';
    const response = await (input.fetch ?? fetch)(`https://api.github.com/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'rebbehub-api', 'X-GitHub-Api-Version': '2022-11-28' },
      body: JSON.stringify({ ref: input.ref || 'main', inputs: { requested: 'true' } }),
    });
    if (!response.ok) throw new Error(`GitHub: ${response.status} ${await response.text().catch(() => '')}`);
    return true;
  };
}

/** A public answer kept in the Workers cache for `seconds` (where there is one; elsewhere, made every time). */
async function edgeCached(request: Request, seconds: number, make: () => Promise<Response>): Promise<Response> {
  const cache = (globalThis as { caches?: { default?: { match(r: Request): Promise<Response | undefined>; put(r: Request, res: Response): Promise<void> } } }).caches?.default;
  const hit = cache ? await cache.match(request) : undefined;
  if (hit) return hit;
  const made = await make();
  const response = new Response(made.body, made);
  response.headers.set('Cache-Control', `public, max-age=${seconds}`);
  if (cache && response.ok) await cache.put(request, response.clone());
  return response;
}
