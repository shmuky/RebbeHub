import type { Route } from './+types/robots';
import { siteOf } from '../lib/context.server.js';

export function loader({ context }: Route.LoaderArgs) {
  const { siteUrl } = siteOf(context);
  const body = ['User-agent: *', 'Disallow: /search', 'Disallow: /history/', '', `Sitemap: ${siteUrl.replace(/\/$/, '')}/sitemap.xml`, ''].join('\n');
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}
