import type { Hono } from 'hono';

/**
 * Is RebbeHub up? (docs/operations.md, "Status"). Every five minutes the
 * API's scheduled run checks the site, the API, the MCP server, the
 * database, the database's daily query allowance, the Workers' load (the
 * CPU a request takes, and how many were stopped for taking too much)
 * and the scheduled jobs, and keeps what it found, with ninety days of it and the last incidents,
 * as one small JSON file in R2. GET /v1/status reads that file and nothing
 * else, so the site's /status page still answers when the database does not.
 *
 * The checks cost the database one query a run (`SELECT now()`, which
 * Hyperdrive never caches): 288 a day, well inside the free allowance of
 * 100,000. How much of the allowance today has used comes from Cloudflare's
 * analytics, not from the database.
 */

export const CHECKS = ['site', 'api', 'mcp', 'database', 'quota', 'workers', 'jobs'] as const;
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

/** One Worker's load since 00:00 UTC today, from Cloudflare's analytics. */
export interface WorkerLoad {
  /** The Worker's name in Cloudflare (`rebbehub-web`, `rebbehub-api`). */
  script: string;
  /** Requests today. */
  requests: number;
  /** Of them, ended by the runtime with an error: an exception, resources exceeded, or its own failure. */
  errors: number;
  /** Of them, stopped for going over the CPU allowance (error 1102, "exceeded resources"): pages nobody got. */
  exceeded: number;
  /** The CPU a request takes, in milliseconds: the median, and the slowest hundredth. Null with no requests. */
  cpuP50Ms: number | null;
  cpuP99Ms: number | null;
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
  /** Each Worker's load today; missing in reports made before it was measured. */
  workers?: WorkerLoad[] | null;
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
/** The free plan's CPU allowance for one request, in milliseconds; past it the runtime stops the request (error 1102). */
export const FREE_CPU_MS = 10;
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

/**
 * What went wrong, in a few words fit for a public page: the error's code
 * and the start of its message, with addresses, hosts and anything like a
 * connection string taken out.
 */
export function reasonOf(error: unknown): string {
  if (!(error instanceof Error)) return '';
  const code = (error as { code?: unknown }).code;
  const words = error.message
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '…')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '…')
    .replace(/\b[\w-]+(?:\.[\w-]+)+\.[a-z]{2,}\b/gi, '…')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  const parts = [typeof code === 'string' && /^[\w-]{1,20}$/.test(code) ? code : null, words || null].filter(Boolean);
  return parts.length ? ` (${parts.join(': ')})` : '';
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
      detail: isAllowanceError(error) ? "Today's allowance of database queries is used up; it starts again at 00:00 UTC." : `The database did not answer${reasonOf(error)}.`,
    };
  }
}

const startOfDay = (at: Date) => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

/**
 * Hyperdrive gives no reason when it refuses a query for the day's allowance
 * ("Connection terminated unexpectedly"), so a database that fails while the
 * count says the allowance is used up is taken to be that, not an outage.
 */
export function explainDatabase(database: CheckResult, quota: CheckResult): CheckResult {
  if (database.state !== 'down' || quota.state !== 'down') return database;
  return { ...database, detail: "Today's allowance of database queries is used up; it starts again at 00:00 UTC." };
}

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
    // No account in the answer means the token may not read it (or the id is wrong): not measured, never zero.
    const account = body.data?.viewer?.accounts?.[0];
    if (!account) {
      console.error('status: analytics', 'the token cannot read this account, or CLOUDFLARE_ACCOUNT_ID is wrong');
      return null;
    }
    const groups = account.hyperdriveQueriesAdaptiveGroups ?? [];
    return groups.reduce((sum, g) => sum + (g.count ?? 0), 0);
  } catch (error) {
    console.error('status: analytics', error);
    return null;
  }
}

/**
 * Each Worker's load since 00:00 UTC, from the same analytics: its
 * requests, how many the runtime stopped for going over the CPU allowance
 * (error 1102, "exceeded resources"), and the CPU a request takes at the
 * median and at the slowest hundredth. One request for all the Workers,
 * each asked twice: whole, for its counts and quantiles, and by
 * invocation status, for the stopped ones. Null when it could not be read.
 */
export async function workersLoadToday(options: { accountId: string; token: string; scripts: string[]; now: Date; fetch?: typeof fetch }): Promise<WorkerLoad[] | null> {
  const scripts = options.scripts.filter((script) => /^[a-z0-9-]{1,63}$/.test(script));
  if (!scripts.length) return null;
  const fields = scripts
    .map(
      (_, i) => `
      w${i}: workersInvocationsAdaptive(limit: 1, filter: { scriptName: $s${i}, datetime_geq: $from, datetime_leq: $to }) { sum { requests errors } quantiles { cpuTimeP50 cpuTimeP99 } }
      x${i}: workersInvocationsAdaptive(limit: 20, filter: { scriptName: $s${i}, datetime_geq: $from, datetime_leq: $to }) { sum { requests } dimensions { status } }`,
    )
    .join('');
  const query = `query ($account: string!, $from: Time!, $to: Time!, ${scripts.map((_, i) => `$s${i}: string!`).join(', ')}) {
    viewer { accounts(filter: { accountTag: $account }) {${fields}
    } }
  }`;
  const variables: Record<string, string> = { account: options.accountId, from: startOfDay(options.now).toISOString(), to: options.now.toISOString() };
  scripts.forEach((script, i) => (variables[`s${i}`] = script));
  type Whole = Array<{ sum?: { requests?: number; errors?: number }; quantiles?: { cpuTimeP50?: number; cpuTimeP99?: number } }>;
  type ByStatus = Array<{ sum?: { requests?: number }; dimensions?: { status?: string } }>;
  try {
    const response = await (options.fetch ?? fetch)('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const body = (await response.json()) as { data?: { viewer?: { accounts?: Array<Record<string, Whole | ByStatus>> } }; errors?: unknown };
    if (!response.ok || body.errors) {
      console.error('status: analytics', response.status, JSON.stringify(body.errors ?? null));
      return null;
    }
    const account = body.data?.viewer?.accounts?.[0];
    if (!account) {
      console.error('status: analytics', 'the token cannot read this account, or CLOUDFLARE_ACCOUNT_ID is wrong');
      return null;
    }
    return scripts.map((script, i) => {
      const whole = ((account[`w${i}`] as Whole | undefined) ?? [])[0];
      const requests = whole?.sum?.requests ?? 0;
      const exceeded = ((account[`x${i}`] as ByStatus | undefined) ?? []).filter((g) => g.dimensions?.status === 'exceededResources').reduce((n, g) => n + (g.sum?.requests ?? 0), 0);
      // The quantiles come in microseconds.
      const ms = (us: number | undefined) => (requests && us !== undefined && us !== null ? Math.round(us / 100) / 10 : null);
      return { script, requests, errors: whole?.sum?.errors ?? 0, exceeded, cpuP50Ms: ms(whole?.quantiles?.cpuTimeP50), cpuP99Ms: ms(whole?.quantiles?.cpuTimeP99) };
    });
  } catch (error) {
    console.error('status: analytics', error);
    return null;
  }
}

/**
 * The Workers' load: a request the runtime stopped for CPU (error 1102)
 * is a page somebody did not get, so any today is degraded and one in
 * twenty is down; a slowest hundredth over the plan's allowance is
 * degraded too, since the next ones will be stopped. `load` null means it
 * could not be read; `cpuLimitMs` null means the plan sets none that matters.
 */
export function workersCheck(load: WorkerLoad[] | null, cpuLimitMs: number | null): CheckResult {
  if (load === null) return { id: 'workers', state: 'unknown', ms: null, detail: 'Not measured: the analytics token is not set, or did not answer.' };
  let state: CheckState = 'up';
  const lines: string[] = [];
  const n = (x: number) => x.toLocaleString('en');
  for (const w of load) {
    if (!w.requests) continue;
    const slow = cpuLimitMs !== null && w.cpuP99Ms !== null && w.cpuP99Ms > cpuLimitMs;
    if (w.exceeded / w.requests >= 0.05) state = 'down';
    else if ((w.exceeded || slow) && state !== 'down') state = 'degraded';
    if (w.exceeded) lines.push(`${w.script}: ${n(w.exceeded)} of ${n(w.requests)} requests today went over the CPU allowance and were stopped (error 1102)${w.cpuP99Ms !== null ? `; the slowest 1% take ${w.cpuP99Ms} ms${cpuLimitMs !== null ? ` of the ${cpuLimitMs} allowed` : ''}` : ''}.`);
    else if (slow) lines.push(`${w.script}: the slowest 1% of requests take ${w.cpuP99Ms} ms of CPU, over the ${cpuLimitMs} the plan allows; the next may be stopped (error 1102).`);
  }
  return { id: 'workers', state, ms: null, detail: lines.length ? lines.join(' ') : null };
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
export function record(previous: StatusReport | null, checks: CheckResult[], at: Date, quota: QueryAllowance | null, workers: WorkerLoad[] | null = null): StatusReport {
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
    workers,
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
