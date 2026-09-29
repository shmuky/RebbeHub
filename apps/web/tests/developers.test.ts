import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ServerBuild } from 'react-router';
import { createApp } from '../../../services/api/src/app.js';
import { OPENAPI } from '../../../services/api/src/openapi.js';
import { freshCatalog } from '../../../packages/core/tests/helpers.js';
import { createSiteHandler } from '../server/handler.js';
import { renderMarkdown, slugOf } from '../app/lib/markdown.js';
import { curlExample, operationsOf, typescriptExample, type OpenApiDocument } from '../app/lib/apiExamples.js';

/**
 * The developer docs: the markdown the docs are drawn with, the examples
 * made from the OpenAPI document, and on the built site /developers, the
 * reference, and /llms.txt for agents.
 */

describe('the docs markdown', () => {
  it('escapes everything, and draws headings, code, tables and links', () => {
    const { html, headings, title } = renderMarkdown(
      ['# Title', '', 'Some <b>words</b> and `code` and [a link](other.md#part).', '', '## A part', '', '```sh', 'curl "x" <y>', '```', '', '| a | b |', '| --- | --- |', '| 1 | 2 |', '', '- one', '- two'].join('\n'),
      { link: (href) => `/to/${href}` },
    );
    expect(title).toBe('Title');
    expect(headings.map((h) => [h.depth, h.id])).toEqual([
      [1, 'title'],
      [2, 'a-part'],
    ]);
    expect(html).toContain('&lt;b&gt;words&lt;/b&gt;');
    expect(html).not.toContain('<b>words');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('href="/to/other.md#part"');
    expect(html).toContain('curl &quot;x&quot; &lt;y&gt;');
    expect(html).toContain('<table>');
    expect(html).toContain('<li>two</li>');
    expect(slugOf('Rate limits & keys')).toBe('rate-limits--keys') // as GitHub makes it;
  });

  it('never lets a link run script', () => {
    const { html } = renderMarkdown('[x](javascript:alert)');
    expect(html).not.toContain('javascript:');
  });
});

describe('examples from the OpenAPI document', () => {
  const doc = OPENAPI as unknown as OpenApiDocument;
  const ops = operationsOf(doc);

  it('reads every operation, with who may call it', () => {
    expect(ops.length).toBeGreaterThan(40);
    expect(ops.find((o) => o.path === '/v1/tokens' && o.method === 'POST')?.access).toBe('site');
    expect(ops.find((o) => o.path === '/v1/search' && o.method === 'GET')?.access).toBe('public');
  });

  it('makes curl and TypeScript examples that fill in the path', () => {
    const entity = ops.find((o) => o.path === '/v1/entities/{id}' && o.method === 'GET')!;
    const curl = curlExample(entity, 'https://api.rebbehub.org', doc);
    expect(curl).toMatch(/^curl .*https:\/\/api\.rebbehub\.org\/v1\/entities\/rh-/);
    expect(typescriptExample(entity, doc)).toContain('new RebbeHub(');
    const suggest = ops.find((o) => o.path === '/v1/suggestions/quick' && o.method === 'POST')!;
    expect(curlExample(suggest, 'https://api.rebbehub.org', doc)).toContain('Authorization: Bearer');
  });
});

describe('the developer pages on the built site', () => {
  const webRoot = fileURLToPath(new URL('..', import.meta.url));
  const SITE = 'https://rebbehub.test';
  let handle: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    if (!existsSync(`${webRoot}/build/server/index.js`)) execFileSync('npx', ['react-router', 'build'], { cwd: webRoot, stdio: 'ignore' });
    const build = (await import(`${webRoot}/build/server/index.js`)) as ServerBuild;
    const { catalog } = await freshCatalog();
    const api = createApp({ catalog, reportSalt: 'test' });
    handle = createSiteHandler(build, { apiUrl: 'http://api.test', siteUrl: SITE, fetch: (input, init) => Promise.resolve(api.request(input, init)) });
  }, 120_000);

  const get = async (path: string) => {
    const response = await handle(new Request(`${SITE}${path}`));
    return { status: response.status, type: response.headers.get('content-type'), body: await response.text() };
  };

  it('draws the docs from docs/, linking between pages', async () => {
    const index = await get('/developers?lang=en');
    expect(index.status).toBe(200);
    expect(index.body).toContain('href="/developers/getting-started"');
    expect(index.body).toContain('href="/developers/reference"');
    const auth = await get('/developers/auth?lang=en');
    expect(auth.status).toBe(200);
    expect(auth.body).toContain('rhp_');
    expect((await get('/developers/no-such-page')).status).toBe(404);
  });

  it('draws the reference from the API own OpenAPI document', async () => {
    const page = await get('/developers/reference?lang=en');
    expect(page.status).toBe(200);
    expect(page.body).toContain('GET<!-- --> <!-- -->/v1/search');
    expect(page.body).toContain('id="mcp"');
  });

  it('answers agents at /llms.txt and /llms-full.txt', async () => {
    const short = await get('/llms.txt');
    expect(short.status).toBe(200);
    expect(short.type).toContain('text/plain');
    expect(short.body).toMatch(/^# RebbeHub\n\n> /);
    expect(short.body).toContain(`${SITE}/developers/auth`);
    expect(short.body).toContain('/mcp');
    const full = await get('/llms-full.txt');
    expect(full.body.length).toBeGreaterThan(short.body.length * 5);
    expect(full.body).toContain('`GET /v1/search`');
    expect(full.body).not.toMatch(/^- `POST \/v1\/tokens`/m); // site-only routes are not for agents
  });
});
