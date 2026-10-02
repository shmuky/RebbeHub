import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ServerBuild } from 'react-router';
import { createSiteHandler } from '../server/handler.js';
import { MODEL_FAMILIES } from '../app/lib/models.js';

/**
 * The models page (/models): every model and every score table from
 * lib/models.ts, in both languages, with the licence and the word that the
 * models are not released. It needs no API, so it answers none.
 */

const webRoot = fileURLToPath(new URL('..', import.meta.url));
let handle: (request: Request) => Promise<Response>;

beforeAll(async () => {
  if (!existsSync(`${webRoot}/build/server/index.js`)) execFileSync('npx', ['react-router', 'build'], { cwd: webRoot, stdio: 'ignore' });
  const build = (await import(`${webRoot}/build/server/index.js`)) as ServerBuild;
  handle = createSiteHandler(build, { apiUrl: 'http://api.test', siteUrl: 'https://rebbehub.test', fetch: () => Promise.resolve(new Response('{}', { status: 404 })) });
}, 120_000);

const get = async (path: string) => {
  const response = await handle(new Request(`https://rebbehub.test${path}`));
  return { status: response.status, html: await response.text() };
};

describe('the models page', () => {
  it('lists every model, which one is in use, and every score table', async () => {
    const page = await get('/models?lang=en');
    expect(page.status).toBe(200);
    for (const family of MODEL_FAMILIES) {
      for (const model of family.models) expect(page.html).toContain(model.name);
      for (const table of family.tables) expect(page.html).toContain(`id="${table.id}"`);
    }
    expect(page.html).toContain('99.91%'); // the reader in use, letters
    expect(page.html).toContain('1,832 / 1,832'); // the Miram detector
    expect(page.html).toContain('11.5% / 5.5%'); // whisper v3 on the whole 17 Tammuz
    expect(page.html).toContain('The models are not released; all rights reserved.');
    expect(page.html).toContain('CC BY-NC-ND 4.0');
  });

  it('is in Hebrew first', async () => {
    const page = await get('/models');
    expect(page.status).toBe(200);
    expect(page.html).toContain('המודלים ומדדי הביצוע');
    expect(page.html).toContain('המודלים עצמם אינם משוחררים');
  });

  it('every score row has a cell for each column', () => {
    for (const family of MODEL_FAMILIES) for (const table of family.tables) for (const row of table.rows) expect(row.cells.length, table.id).toBe(table.columns.length - 1);
  });
});
