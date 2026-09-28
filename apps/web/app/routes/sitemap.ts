import { data } from 'react-router';
import type { Route } from './+types/sitemap';
import { siteOf } from '../lib/context.server.js';
import { SITEMAP_LIMIT, SITEMAP_TYPES, escapeXml } from '../lib/sitemap.js';

/** Every item of one kind, in Hebrew with its English alternate. */
export async function loader({ params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const type = params.type;
  if (!(SITEMAP_TYPES as readonly string[]).includes(type)) throw data('not found', { status: 404 });
  const base = siteUrl.replace(/\/$/, '');
  const urls: string[] = [];
  let after: string | undefined;
  while (urls.length < SITEMAP_LIMIT) {
    const page = await api.list({ type, after, limit: 500 });
    for (const item of page.items) {
      const loc = escapeXml(`${base}${item.path ?? `/${item.id}`}`);
      urls.push(
        `  <url><loc>${loc}</loc><xhtml:link rel="alternate" hreflang="he" href="${loc}"/><xhtml:link rel="alternate" hreflang="en" href="${loc}?lang=en"/></url>`,
      );
    }
    if (!page.next || page.items.length < 500) break;
    after = page.next;
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
}
