import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import type { ServerBuild } from 'react-router';
import { createSiteHandler } from './handler.js';

/**
 * The site on Node: `npm run build -w @rebbehub/web && npm start -w @rebbehub/web`.
 *
 *   REBBEHUB_API_URL   the API (default http://127.0.0.1:8787)
 *   SITE_URL           this site's public address (default http://localhost:3000)
 *   PORT               default 3000
 */
// @ts-ignore - made by `react-router build`
const build = (await import('../build/server/index.js')) as ServerBuild;
const port = Number(process.env.PORT ?? 3000);
const handler = createSiteHandler(build, {
  apiUrl: process.env.REBBEHUB_API_URL ?? 'http://127.0.0.1:8787',
  siteUrl: process.env.SITE_URL ?? `http://localhost:${port}`,
});

const app = new Hono();
// Built assets have content hashes in their names, so they can be cached for good.
app.use('/assets/*', serveStatic({ root: './build/client', onFound: (_path, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable') }));
// The rest of public/ (icons, the web app manifest, the service worker, the reader's pdf.js files); a miss goes on to the pages.
app.use('*', serveStatic({ root: './build/client' }));
app.all('*', (c) => handler(c.req.raw));

serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '127.0.0.1' });
console.log(`RebbeHub site on http://127.0.0.1:${port}`);
