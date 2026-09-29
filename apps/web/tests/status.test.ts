import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ServerBuild } from 'react-router';
import { record } from '../../../services/api/src/status.js';
import { createSiteHandler } from '../server/handler.js';

/**
 * The status page (/status), over an API that answers GET /v1/status with
 * a made-up report, and over one that does not answer at all: the page
 * must still say what it knows.
 */

const webRoot = fileURLToPath(new URL('..', import.meta.url));
let build: ServerBuild;

beforeAll(async () => {
  if (!existsSync(`${webRoot}/build/server/index.js`)) execFileSync('npx', ['react-router', 'build'], { cwd: webRoot, stdio: 'ignore' });
  build = (await import(`${webRoot}/build/server/index.js`)) as ServerBuild;
}, 120_000);

const site = (answer: (path: string) => Promise<Response>) =>
  createSiteHandler(build, { apiUrl: 'http://api.test', siteUrl: 'https://rebbehub.test', fetch: (input) => answer(new URL(String(input)).pathname) });

const page = async (handler: (request: Request) => Promise<Response>, lang = 'en') => {
  const response = await handler(new Request(`https://rebbehub.test/status${lang === 'en' ? '?lang=en' : ''}`, { headers: { 'Accept-Language': lang } }));
  return { status: response.status, html: await response.text(), cache: response.headers.get('Cache-Control') };
};

describe('the status page', () => {
  it('shows each part, its days, and the incidents', async () => {
    const now = new Date();
    const earlier = new Date(now.getTime() - 10 * 60_000);
    let report = record(null, [{ id: 'site', state: 'up', ms: 40, detail: null }, { id: 'database', state: 'down', ms: 20, detail: 'The database did not answer.' }], earlier, null);
    report = record(report, [{ id: 'site', state: 'up', ms: 40, detail: null }, { id: 'database', state: 'up', ms: 20, detail: null }, { id: 'quota', state: 'up', ms: null, detail: null }], now, { used: 1234, limit: 100_000, resetsAt: now.toISOString(), runsOutAt: null });
    const handler = site(async (path) => (path === '/v1/status' ? Response.json({ now: now.toISOString(), report }) : new Response('{}', { status: 404 })));
    const { status, html, cache } = await page(handler);
    expect(status).toBe(200);
    expect(cache).toContain('max-age=60');
    expect(html).toContain('Everything is working');
    expect(html).toContain('The MCP server');
    expect(html).toContain('1,234 of 100,000 database queries today');
    expect(html).toContain('Lasted 10 min');
    expect(html).toContain('http://api.test/v1/status');
  });

  it('says the API is not answering when it cannot read the checks', async () => {
    const { status, html } = await page(site(async () => Promise.reject(new Error('refused'))));
    expect(status).toBe(200);
    expect(html).toContain('The API is not answering');
  });

  it('says when the checks have stopped running', async () => {
    const old = new Date(Date.now() - 3 * 3_600_000);
    const report = record(null, [{ id: 'site', state: 'up', ms: 40, detail: null }], old, null);
    const { html } = await page(site(async () => Response.json({ now: new Date().toISOString(), report })));
    expect(html).toContain('The checks have stopped running');
  });

  it('in Hebrew too', async () => {
    const { html } = await page(site(async () => Response.json({ now: new Date().toISOString(), report: null })), 'he');
    expect(html).toContain('מצב האתר');
    expect(html).toContain('עוד לא נבדק');
  });
});
