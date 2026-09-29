import type { Hono } from 'hono';

/**
 * Is RebbeHub up? (docs/operations.md, "Status"). Every five minutes the
 * API's scheduled run checks the site, the API, the MCP server, the
 * database, the database's daily query allowance and the scheduled jobs,
 * and keeps what it found, with ninety days of it and the last incidents,
 * as one small JSON file in R2. GET /v1/status reads that file and nothing
 * else, so the site's /status page still answers when the database does not.
 *
 * The checks cost the database one query a run (`SELECT now()`, which
 * Hyperdrive never caches): 288 a day, well inside the free allowance of
 * 100,000. How much of the allowance today has used comes from Cloudflare's
 * analytics, not from the database.
 */

export const CHECKS = ['site', 'api', 'mcp', 'database', 'quota', 'jobs'] as const;
export type CheckId = (typeof CHECKS)[number];

/** `unknown`: not checked this time (not configured, or waiting on something that is down); it counts for nothing. */
export type CheckState = 'up' | 'degraded' | 'down' | 'unknown';

export interface CheckResult {
  id: CheckId;
  state: CheckState;
  /** How long it took to answer, when it was asked something. */
  ms: number | null;
  /** A sentence for people, when something is wrong or worth saying. Never a raw error: those go to the logs. */
  detail: string | null;
}

export interface QueryAllowance {
  /** Queries through Hyperdrive since 00:00 UTC today. */
  used: number;
  /** The plan's daily allowance; null on a plan without one. */
  limit: number | null;
  /** When the count starts again (the next 00:00 UTC). */
  resetsAt: string;
  /** At today's pace so far, when it would run out, if before it resets. */
  runsOutAt: string | null;
}

export interface DayTally {
  runs: number;
  up: number;
  degraded: number;
  down: number;
}

export interface StatusDay {
  /** YYYY-MM-DD, UTC. */
  date: string;
  checks: Partial<Record<CheckId, DayTally>>;
}

export interface Incident {
  check: CheckId;
  /** The worst it got. */
  state: 'degraded' | 'down';
  from: string;
  /** Null while it goes on. */
  to: string | null;
  detail: string | null;
}

export interface StatusReport {
  checkedAt: string;
  /** The worst of the checks. */
  state: CheckState;
  checks: CheckResult[];
  quota: QueryAllowance | null;
  /** Oldest first, at most DAYS_KEPT. */
  days: StatusDay[];
  /** Newest first, at most INCIDENTS_KEPT. */
  incidents: Incident[];
}

export const DAYS_KEPT = 90;
export const INCIDENTS_KEPT = 30;
/** The key in the public bucket; it holds nothing that is not on the public page. */
export const STATUS_KEY = 'status/report.json';
/** Hyperdrive's free daily allowance of queries. */
export const FREE_DAILY_QUERIES = 100_000;
/** An answer slower than this is working, but slowly. */
const SLOW_MS = 5000;
const TIMEOUT_MS = 10_000;

const RANK: Record<CheckState, number> = { unknown: 0, up: 1, degraded: 2, down: 3 };
const worst = (states: CheckState[]): CheckState => states.reduce<CheckState>((a, b) => (RANK[b] > RANK[a] ? b : a), 'unknown');

// ------------------------------------------------------------------ checks

/** Something that answers requests: a service binding, the app itself, or global fetch. */
export type Fetcher = (request: Request) => Promise<Response>;

/**
 * Asks `fetcher` once and judges the answer: `accept` says what is wrong
 * with it (null when nothing is). Slower than five seconds is degraded;
 * no answer in ten, or a wrong one, is down.
 */
export async function probe(id: CheckId, fetcher: Fetcher, request: Request, accept: (response: Response) => Promise<string | null> = async (r) => (r.ok ? null : `answered ${r.status}`)): Promise<CheckResult> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
    });
    const response = await Promise.race([fetcher(request), timeout]);
    const problem = await Promise.race([accept(response), timeout]);
    const ms = Date.now() - started;
    if (problem) return { id, state: 'down', ms, detail: `It ${problem}.` };
    return { id, state: ms > SLOW_MS ? 'degraded' : 'up', ms, detail: ms > SLOW_MS ? 'Answering slowly.' : null };
  } catch (error) {
    console.error(`status: ${id}`, error);
    const timedOut = error instanceof Error && error.message === 'timeout';
    return { id, state: 'down', ms: timedOut ? TIMEOUT_MS : null, detail: timedOut ? 'No answer within ten seconds.' : 'Could not be reached.' };
  }
}

/** The MCP server answers `initialize` as MCP says. */
export function mcpRequest(apiOrigin: string): Request {
  return new Request(`${apiOrigin}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'rebbehub-status', version: '1' } } }),
  });
}

export async function mcpAnswers(response: Response): Promise<string | null> {
  if (!response.ok) return `answered ${response.status}`;
  const body = (await response.json().catch(() => null)) as { result?: { serverInfo?: unknown } } | null;
  return body?.result?.serverInfo ? null : 'did not answer as an MCP server';
}

/** Whether a database error says the day's allowance of queries is used up, rather than that the database is down. */
export function isAllowanceError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.message} ${(error as { code?: string }).code ?? ''}` : String(error);
  return /quota|daily limit|limit (?:was |has been )?(?:reached|exceeded)|exceeded .*limit|too many queries|free tier/i.test(text);
}

/** One query through Hyperdrive. */
export async function checkDatabase(ask: () => Promise<unknown>): Promise<CheckResult> {
  const started = Date.now();
  try {
    await ask();
    const ms = Date.now() - started;
    return { id: 'database', state: ms > SLOW_MS ? 'degraded' : 'up', ms, detail: ms > SLOW_MS ? 'Answering slowly.' : null };
  } catch (error) {
    console.error('status: database', error);
    return {
      id: 'database',
      state: 'down',
      ms: Date.now() - started,
      detail: isAllowanceError(error) ? "Today's allowance of database queries is used up; it starts again at 00:00 UTC." : 'The database did not answer.',
    };
  }
}

const startOfDay = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

/**
 * Queries through the Hyperdrive config since 00:00 UTC, from Cloudflare's
 * GraphQL analytics (a token allowed Account Analytics: Read). Null when it
 * could not be read.
 */
export async function hyperdriveQueriesToday(options: { accountId: string; token: string; configId: string; now: Date; fetch?: typeof fetch }): Promise<number | null> {
  const query = `query ($account: string!, $config: string!, $from: Time!, $to: Time!) {
    viewer { accounts(filter: { accountTag: $account }) {
      hyperdriveQueriesAdaptiveGroups(limit: 1, filter: { configId: $config, datetime_geq: $from, datetime_leq: $to }) { count }
    } }
  }`;
  const variables = { account: options.accountId, config: options.configId, from: startOfDay(options.now).toISOString(), to: options.now.toISOString() };
  try {
    const response = await (options.fetch ?? fetch)('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await response.json()) as { data?: { viewer?: { accounts?: Array<{ hyperdriveQueriesAdaptiveGroups?: Array<{ count: number }> }> } }; errors?: unknown };
    if (!response.ok || body.errors) {
      console.error('status: analytics', response.status, JSON.stringify(body.errors ?? null));
      return null;
    }
    const groups = body.data?.viewer?.accounts?.[0]?.hyperdriveQueriesAdaptiveGroups ?? [];
    return groups.reduce((sum, g) => sum + (g.count ?? 0), 0);
  } catch (error) {
    console.error('status: analytics', error);
    return null;
  }
}

/**
 * The day's allowance: used up is down; past 80%, or on pace to run out
 * before 00:00 UTC, is degraded. `used` null means it could not be read.
 */
export function allowanceCheck(used: number | null, limit: number | null, now: Date): { check: CheckResult; quota: QueryAllowance | null } {
  if (used === null) return { check: { id: 'quota', state: 'unknown', ms: null, detail: 'Not measured: the analytics token is not set, or did not answer.' }, quota: null };
  const midnight = startOfDay(now);
  const resets = new Date(midnight.getTime() + 86_400_000);
  const elapsed = now.getTime() - midnight.getTime();
  let runsOutAt: string | null = null;
  // Too early in the day, one burst would look like a pace.
  if (limit !== null && used > 0 && used < limit && elapsed > 3_600_000) {
    const at = midnight.getTime() + (elapsed * limit) / used;
    if (at < resets.getTime()) runsOutAt = new Date(at).toISOString();
  }
  const quota = { used, limit, resetsAt: resets.toISOString(), runsOutAt };
  if (limit === null) return { check: { id: 'quota', state: 'up', ms: null, detail: null }, quota };
  const hhmm = (iso: string) => iso.slice(11, 16);
  if (used >= limit) return { check: { id: 'quota', state: 'down', ms: null, detail: `All ${limit.toLocaleString('en')} of today's queries are used; they start again at 00:00 UTC.` }, quota };
  if (used >= limit * 0.8) return { check: { id: 'quota', state: 'degraded', ms: null, detail: `${Math.round((used / limit) * 100)}% of today's queries are used.` }, quota };
  if (runsOutAt) return { check: { id: 'quota', state: 'degraded', ms: null, detail: `At today's pace the queries run out at about ${hhmm(runsOutAt)} UTC.` }, quota };
  return { check: { id: 'quota', state: 'up', ms: null, detail: null }, quota };
}

/** The scheduled jobs of this run (webhooks, email updates, the reviewer's advice): which failed, or null when they did not run. */
export function jobsCheck(failed: string[] | null): CheckResult {
  if (failed === null) return { id: 'jobs', state: 'unknown', ms: null, detail: 'Waiting for the database.' };
  if (failed.length) return { id: 'jobs', state: 'degraded', ms: null, detail: `Failed this time: ${failed.join(', ')}.` };
  return { id: 'jobs', state: 'up', ms: null, detail: null };
}

// ------------------------------------------------------------------ the record

/** This run's checks added to what was kept: today's tally, and incidents opened, made worse, or closed. */
export function record(previous: StatusReport | null, checks: CheckResult[], at: Date, quota: QueryAllowance | null): StatusReport {
  const iso = at.toISOString();
  const date = iso.slice(0, 10);
  const days = (previous?.days ?? []).filter((d) => d.date < date).map((d) => ({ ...d }));
  const today: StatusDay = previous?.days.find((d) => d.date === date) ?? { date, checks: {} };
  const tally = { ...today.checks };
  for (const check of checks) {
    if (check.state === 'unknown') continue;
    const t = { ...(tally[check.id] ?? { runs: 0, up: 0, degraded: 0, down: 0 }) };
    t.runs += 1;
    t[check.state] += 1;
    tally[check.id] = t;
  }
  days.push({ date, checks: tally });

  const incidents = (previous?.incidents ?? []).map((i) => ({ ...i }));
  for (const check of checks) {
    if (check.state === 'unknown') continue;
    const open = incidents.find((i) => i.check === check.id && i.to === null);
    if (check.state === 'up') {
      if (open) open.to = iso;
    } else if (open) {
      if (RANK[check.state] > RANK[open.state]) open.state = check.state;
      open.detail = check.detail ?? open.detail;
    } else {
      incidents.unshift({ check: check.id, state: check.state, from: iso, to: null, detail: check.detail });
    }
  }

  return {
    checkedAt: iso,
    state: worst(checks.map((c) => c.state)),
    checks,
    quota,
    days: days.slice(-DAYS_KEPT),
    incidents: incidents.slice(0, INCIDENTS_KEPT),
  };
}

// ------------------------------------------------------------------ reading it

/** Where the report is kept (R2 on Workers). */
export interface StatusStore {
  read(): Promise<StatusReport | null>;
}

/**
 * GET /v1/status: the last report, never the database. `now` is when this
 * answer was made, so a reader can tell when the checks stopped running.
 */
export function statusRoutes(app: Hono, store: StatusStore | undefined): void {
  app.get('/v1/status', async (c) => {
    const report = store ? await store.read().catch((error) => (console.error('status: read', error), null)) : null;
    return c.json({ now: new Date().toISOString(), report } as unknown as Record<string, unknown>, 200, { 'Cache-Control': 'public, max-age=60, s-maxage=60' });
  });
}
