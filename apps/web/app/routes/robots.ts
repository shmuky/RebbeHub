import type { Route } from './+types/robots';
import { siteOf } from '../lib/context.server.js';

/**
 * What crawlers may read. Every item, list, and the developer docs are
 * open to all of them, AI crawlers among them (/llms.txt is for those).
 * Kept out: what is someone's own (account, inbox), the stewards' and
 * reviewers' tools, forms, the site's passages to the API (/_/), and pages
 * with no end to them (search, a text's every page and line, comparisons,
 * every file) - each of those is either found through an item's page or
 * says nothing an item's page does not.
 */
export const DISALLOWED = [
  '/_/',
  '/account',
  '/inbox',
  '/admin',
  '/review',
  '/signin',
  '/add',
  '/search',
  '/read',
  '/edit/',
  '/history/',
  '/compare/',
  '/text/',
  '/files/',
  '/embed/',
  '/issues/new',
  '/suggestions/',
] as const;

export function robotsTxt(siteUrl: string): string {
  const base = siteUrl.replace(/\/$/, '');
  return ['User-agent: *', 'Allow: /', ...DISALLOWED.map((path) => `Disallow: ${path}`), '', `Sitemap: ${base}/sitemap.xml`, ''].join('\n');
}

export function loader({ context }: Route.LoaderArgs) {
  return new Response(robotsTxt(siteOf(context).siteUrl), {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400' },
  });
}
