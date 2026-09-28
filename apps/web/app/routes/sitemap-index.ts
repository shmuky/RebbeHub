import type { Route } from './+types/sitemap-index';
import { siteOf } from '../lib/context.server.js';
import { SITEMAP_TYPES } from '../lib/sitemap.js';

/** One sitemap per kind of page that search engines should know. */
export async function loader({ context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const base = siteUrl.replace(/\/$/, '');
  const { counts } = await api.stats();
  const entries = SITEMAP_TYPES.filter((type) => counts[type]).map((type) => `  <sitemap><loc>${base}/sitemaps/${type}.xml</loc></sitemap>`);
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</sitemapindex>\n`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}
