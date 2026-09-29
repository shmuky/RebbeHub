import { describe, expect, it } from 'vitest';
import type { Catalog } from '@rebbehub/core';
import { createApp } from '../src/app.js';
import { allowanceCheck, checkDatabase, explainDatabase, hyperdriveQueriesToday, isAllowanceError, jobsCheck, mcpAnswers, mcpRequest, probe, record, workersCheck, workersLoadToday, type CheckResult, type StatusReport, type WorkerLoad } from '../src/status.js';

/**
 * The status checks (src/status.ts): each check's verdict, the kept record
 * of days and incidents, and GET /v1/status, which reads the record and
 * never the database.
 */

const at = (iso: string) => new Date(iso);
const up = (id: CheckResult['id']): CheckResult => ({ id, state: 'up', ms: 10, detail: null });
const down = (id: CheckResult['id'], detail = 'It answered 500.'): CheckResult => ({ id, state: 'down', ms: 10, detail });

describe('the checks', () => {
  it('a probe is up when it answers well, down when it answers badly or not at all', async () => {
    const ok = await probe('api', async () => new Response('{}'), new Request('https://api.test/openapi.json'));
    expect(ok).toMatchObject({ id: 'api', state: 'up', detail: null });
    const bad = await probe('api', async () => new Response('', { status: 503 }), new Request('https://api.test/openapi.json'));
    expect(bad).toMatchObject({ state: 'down', detail: 'It answered 503.' });
    const gone = await probe('site', async () => Promise.reject(new Error('refused')), new Request('https://site.test/about'));
    expect(gone).toMatchObject({ state: 'down', detail: 'Could not be reached.' });
  });

  it('the MCP server must answer initialize as an MCP server', async () => {
    const app = createApp({ catalog: {} as Catalog, siteUrl: 'https://rebbehub.test' });
    const result = await probe('mcp', (r) => Promise.resolve(app.request(r)), mcpRequest('https://api.test'), mcpAnswers);
    expect(result.state).toBe('up');
    const html = await probe('mcp', async () => new Response('<html>'), mcpRequest('https://api.test'), mcpAnswers);
    expect(html).toMatchObject({ state: 'down', detail: 'It did not answer as an MCP server.' });
  });

  it('tells a used-up allowance from a database that does not answer', async () => {
    expect(isAllowanceError(new Error('Hyperdrive: daily query limit exceeded for this account'))).toBe(true);
    expect(isAllowanceError(new Error('connect ECONNREFUSED'))).toBe(false);
    expect((await checkDatabase(async () => 1)).state).toBe('up');
    const quota = await checkDatabase(async () => Promise.reject(new Error('free tier quota exceeded')));
    expect(quota).toMatchObject({ state: 'down', detail: expect.stringContaining('00:00 UTC') });
    const refused = await checkDatabase(async () => Promise.reject(new Error('connect ECONNREFUSED 10.0.0.1:5432')));
    // What went wrong shows, but never an address, a host or a connection string.
    expect(refused.detail).toBe('The database did not answer (connect ECONNREFUSED …).');
    const leaky = Object.assign(new Error('bad postgres://user:pw@db.example.neon.tech/x at ep-cool-1.aws.neon.tech'), { code: '08006' });
    expect((await checkDatabase(async () => Promise.reject(leaky))).detail).toBe('The database did not answer (08006: bad … at …).');
  });

  it('a database that fails while the allowance is used up is said to be the allowance', () => {
    const failed = down('database', 'The database did not answer (Connection terminated unexpectedly).');
    const usedUp: CheckResult = { id: 'quota', state: 'down', ms: null, detail: 'All used.' };
    expect(explainDatabase(failed, usedUp).detail).toContain('00:00 UTC');
    expect(explainDatabase(failed, up('quota'))).toBe(failed);
    expect(explainDatabase(up('database'), usedUp).state).toBe('up');
  });

  it('the allowance: fine, nearly used, on pace to run out, used up, not measured', () => {
    const noon = at('2026-09-29T12:00:00Z');
    expect(allowanceCheck(10_000, 100_000, noon).check.state).toBe('up');
    expect(allowanceCheck(85_000, 100_000, noon).check).toMatchObject({ state: 'degraded', detail: "85% of today's queries are used." });
    // 60,000 by noon is 120,000 by midnight: out at about 20:00.
    const pace = allowanceCheck(60_000, 100_000, noon);
    expect(pace.check.state).toBe('degraded');
    expect(pace.quota).toEqual({ used: 60_000, limit: 100_000, resetsAt: '2026-09-30T00:00:00.000Z', runsOutAt: '2026-09-29T20:00:00.000Z' });
    expect(allowanceCheck(100_000, 100_000, noon).check.state).toBe('down');
    expect(allowanceCheck(500_000, null, noon).check.state).toBe('up');
    expect(allowanceCheck(null, 100_000, noon)).toMatchObject({ check: { state: 'unknown' }, quota: null });
    // Too early in the day for a pace to mean anything.
    expect(allowanceCheck(5_000, 100_000, at('2026-09-29T00:20:00Z')).quota?.runsOutAt).toBeNull();
  });

  it("counts today's Hyperdrive queries from Cloudflare's analytics", async () => {
    let asked: { variables: Record<string, string> } | null = null;
    const fake = (async (_url: string, init: RequestInit) => {
      asked = JSON.parse(String(init.body));
      return Response.json({ data: { viewer: { accounts: [{ hyperdriveQueriesAdaptiveGroups: [{ count: 1234 }] }] } } });
    }) as unknown as typeof fetch;
    expect(await hyperdriveQueriesToday({ accountId: 'acc', token: 't', configId: 'cfg', now: at('2026-09-29T13:00:00Z'), fetch: fake })).toBe(1234);
    expect(asked!.variables).toMatchObject({ account: 'acc', config: 'cfg', from: '2026-09-29T00:00:00.000Z' });
    const refused = (async () => Response.json({ errors: [{ message: 'not authorized' }] }, { status: 403 })) as unknown as typeof fetch;
    expect(await hyperdriveQueriesToday({ accountId: 'acc', token: 't', configId: 'cfg', now: at('2026-09-29T13:00:00Z'), fetch: refused })).toBeNull();
    // A token that may not read the account gets no account back: not measured, never zero.
    const noAccount = (async () => Response.json({ data: { viewer: { accounts: [] } } })) as unknown as typeof fetch;
    expect(await hyperdriveQueriesToday({ accountId: 'acc', token: 't', configId: 'cfg', now: at('2026-09-29T13:00:00Z'), fetch: noAccount })).toBeNull();
  });

  it("reads each Worker's load today from the same analytics: requests, the ones stopped for CPU, and the CPU a request takes", async () => {
    let asked: { query: string; variables: Record<string, string> } | undefined;
    const fake = (async (_url: string, init: RequestInit) => {
      asked = JSON.parse(String(init.body)) as typeof asked;
      return Response.json({
        data: {
          viewer: {
            accounts: [
              {
                w0: [{ sum: { requests: 4300, errors: 15 }, quantiles: { cpuTimeP50: 3120, cpuTimeP99: 14250 } }],
                x0: [{ sum: { requests: 4285 }, dimensions: { status: 'success' } }, { sum: { requests: 12 }, dimensions: { status: 'exceededResources' } }, { sum: { requests: 3 }, dimensions: { status: 'scriptThrewException' } }],
                w1: [{ sum: { requests: 0, errors: 0 }, quantiles: { cpuTimeP50: 0, cpuTimeP99: 0 } }],
                x1: [],
              },
            ],
          },
        },
      });
    }) as unknown as typeof fetch;
    const load = await workersLoadToday({ accountId: 'acc', token: 't', scripts: ['rebbehub-web', 'rebbehub-api'], now: at('2026-09-29T13:00:00Z'), fetch: fake });
    expect(load).toEqual([
      { script: 'rebbehub-web', requests: 4300, errors: 15, exceeded: 12, cpuP50Ms: 3.1, cpuP99Ms: 14.3 },
      { script: 'rebbehub-api', requests: 0, errors: 0, exceeded: 0, cpuP50Ms: null, cpuP99Ms: null },
    ]);
    // One request for both Workers, each asked whole and by invocation status, since 00:00 UTC.
    expect(asked!.variables).toMatchObject({ account: 'acc', s0: 'rebbehub-web', s1: 'rebbehub-api', from: '2026-09-29T00:00:00.000Z' });
    expect(asked!.query).toContain('w0: workersInvocationsAdaptive(limit: 1, filter: { scriptName: $s0');
    expect(asked!.query).toContain('x1: workersInvocationsAdaptive(limit: 20, filter: { scriptName: $s1');
    expect(asked!.query).toContain('dimensions { status }');
    // Not measured when the token is refused, when it may not read the account, or with no Worker named.
    const refused = (async () => Response.json({ errors: [{ message: 'not authorized' }] }, { status: 403 })) as unknown as typeof fetch;
    expect(await workersLoadToday({ accountId: 'acc', token: 't', scripts: ['rebbehub-web'], now: at('2026-09-29T13:00:00Z'), fetch: refused })).toBeNull();
    const noAccount = (async () => Response.json({ data: { viewer: { accounts: [] } } })) as unknown as typeof fetch;
    expect(await workersLoadToday({ accountId: 'acc', token: 't', scripts: ['rebbehub-web'], now: at('2026-09-29T13:00:00Z'), fetch: noAccount })).toBeNull();
    expect(await workersLoadToday({ accountId: 'acc', token: 't', scripts: ['not a name'], now: at('2026-09-29T13:00:00Z'), fetch: fake })).toBeNull();
  });

  it("the Workers' load: fine, a slow hundredth, some stopped, many stopped, not measured", () => {
    const web = (over: Partial<WorkerLoad>): WorkerLoad => ({ script: 'rebbehub-web', requests: 4300, errors: 0, exceeded: 0, cpuP50Ms: 3.1, cpuP99Ms: 8.9, ...over });
    expect(workersCheck([web({})], 10)).toEqual({ id: 'workers', state: 'up', ms: null, detail: null });
    expect(workersCheck([web({ cpuP99Ms: 14.3 })], 10)).toMatchObject({ state: 'degraded', detail: 'rebbehub-web: the slowest 1% of requests take 14.3 ms of CPU, over the 10 the plan allows; the next may be stopped (error 1102).' });
    // A plan whose allowance does not matter judges only what was stopped.
    expect(workersCheck([web({ cpuP99Ms: 14.3 })], null).state).toBe('up');
    expect(workersCheck([web({ exceeded: 12, errors: 15, cpuP99Ms: 14.3 })], 10)).toMatchObject({ state: 'degraded', detail: 'rebbehub-web: 12 of 4,300 requests today went over the CPU allowance and were stopped (error 1102); the slowest 1% take 14.3 ms of the 10 allowed.' });
    expect(workersCheck([web({ exceeded: 300 })], 10).state).toBe('down');
    // The worst Worker decides; one with no requests yet says nothing.
    expect(workersCheck([web({ exceeded: 300 }), { script: 'rebbehub-api', requests: 0, errors: 0, exceeded: 0, cpuP50Ms: null, cpuP99Ms: null }], 10).state).toBe('down');
    expect(workersCheck(null, 10)).toMatchObject({ state: 'unknown', detail: 'Not measured: the analytics token is not set, or did not answer.' });
  });

  it('jobs: failed ones named; none run while the database is down', () => {
    expect(jobsCheck([]).state).toBe('up');
    expect(jobsCheck(['webhooks'])).toMatchObject({ state: 'degraded', detail: 'Failed this time: webhooks.' });
    expect(jobsCheck(null).state).toBe('unknown');
  });
});

describe('the record', () => {
  it('tallies each day, opens an incident when a check fails, and closes it when it recovers', () => {
    let report: StatusReport | null = null;
    report = record(report, [up('site'), up('database')], at('2026-09-29T10:00:00Z'), null);
    expect(report.state).toBe('up');
    expect(report.incidents).toEqual([]);

    report = record(report, [up('site'), down('database', 'The database did not answer.')], at('2026-09-29T10:05:00Z'), null);
    expect(report.state).toBe('down');
    expect(report.incidents).toEqual([{ check: 'database', state: 'down', from: '2026-09-29T10:05:00.000Z', to: null, detail: 'The database did not answer.' }]);

    report = record(report, [up('site'), down('database')], at('2026-09-29T10:10:00Z'), null);
    expect(report.incidents).toHaveLength(1);

    report = record(report, [up('site'), up('database')], at('2026-09-29T10:15:00Z'), null);
    expect(report.incidents[0]!.to).toBe('2026-09-29T10:15:00.000Z');
    expect(report.days).toEqual([{ date: '2026-09-29', checks: { site: { runs: 4, up: 4, degraded: 0, down: 0 }, database: { runs: 4, up: 2, degraded: 0, down: 2 } } }]);

    // A new day starts a new tally; an unknown check counts for nothing.
    report = record(report, [up('site'), { id: 'quota', state: 'unknown', ms: null, detail: null }], at('2026-09-30T00:00:00Z'), null);
    expect(report.days.map((d) => d.date)).toEqual(['2026-09-29', '2026-09-30']);
    expect(report.days[1]!.checks.quota).toBeUndefined();
    expect(report.state).toBe('up');
  });

  it('an incident that gets worse keeps its start and takes the worse state', () => {
    let report = record(null, [{ id: 'quota', state: 'degraded', ms: null, detail: '85% used.' }], at('2026-09-29T20:00:00Z'), null);
    report = record(report, [{ id: 'quota', state: 'down', ms: null, detail: 'All used.' }], at('2026-09-29T22:00:00Z'), null);
    expect(report.incidents).toEqual([{ check: 'quota', state: 'down', from: '2026-09-29T20:00:00.000Z', to: null, detail: 'All used.' }]);
  });

  it('keeps ninety days', () => {
    let report: StatusReport | null = null;
    for (let d = 0; d < 100; d++) report = record(report, [up('site')], new Date(Date.UTC(2026, 0, 1) + d * 86_400_000), null);
    expect(report!.days).toHaveLength(90);
    expect(report!.days[0]!.date).toBe('2026-01-11');
  });
});

describe('GET /v1/status', () => {
  // A catalog whose database throws when asked anything: a query here fails the test.
  const asked = () => {
    throw new Error('the database was asked');
  };
  const catalog = new Proxy({ db: new Proxy({}, { get: asked }) }, { get: (target, key) => (key === 'db' ? target.db : asked()) }) as unknown as Catalog;

  it('answers the kept report without asking the database', async () => {
    const kept = record(null, [up('site')], at('2026-09-29T10:00:00Z'), null);
    const app = createApp({ catalog, status: { read: async () => kept } });
    const response = await app.request('/v1/status');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('max-age=60');
    const body = (await response.json()) as { now: string; report: StatusReport };
    expect(body.report).toEqual(kept);
    expect(Date.parse(body.now)).not.toBeNaN();
  });

  it('answers null before the first check, and when the store cannot be read', async () => {
    expect(((await (await createApp({ catalog }).request('/v1/status')).json()) as { report: unknown }).report).toBeNull();
    const broken = createApp({ catalog, status: { read: async () => Promise.reject(new Error('R2 is down')) } });
    expect(((await (await broken.request('/v1/status')).json()) as { report: unknown }).report).toBeNull();
  });
});
