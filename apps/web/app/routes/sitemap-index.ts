import type { Route } from './+types/sitemap-index';
import { siteOf } from '../lib/context.server.js';
import { escapeXml, xmlResponse } from '../lib/sitemap.js';

/** The sitemaps: the site's own pages, then every kind of item a page at a time, each with when it last changed. */
export async function loader({ context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const base = siteUrl.replace(/\/$/, '');
  const { sitemaps } = await api.sitemaps();
  const newest = sitemaps.map((s) => s.lastmod).filter((m): m is string => Boolean(m)).sort().at(-1);
  const entry = (name: string, lastmod?: string | null) => `  <sitemap><loc>${escapeXml(`${base}/sitemaps/${name}.xml`)}</loc>${lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : ''}</sitemap>`;
  const entries = [entry('pages', newest), ...sitemaps.map((s) => entry(`${s.type}-${s.page}`, s.lastmod))];
  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</sitemapindex>\n`);
}
