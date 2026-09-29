import { data, redirect } from 'react-router';
import type { Route } from './+types/sitemap';
import { siteOf } from '../lib/context.server.js';
import { DOC_PAGES } from '../lib/developerDocs.js';
import { SITEMAP_LIMIT, sitemapName, urlEntries, urlset, xmlResponse } from '../lib/sitemap.js';

/** The site's own pages worth finding: the lists, the docs for developers, and what the site is. */
const PAGES = ['/', '/sets', '/calendar', '/projects', '/missing', '/health', '/status', '/issues', '/suggestions', '/about', '/help', '/takedown', '/mirrors', '/connect', '/developers/reference'];

/** One sitemap: the site's own pages, or one page of one kind of item, each in Hebrew with its English beside it. */
export async function loader({ params, context }: Route.LoaderArgs) {
  const { api, siteUrl } = siteOf(context);
  const base = siteUrl.replace(/\/$/, '');
  const name = sitemapName(params.name);
  if (!name) throw data('not found', { status: 404 });
  if (name.kind === 'legacy') {
    const first = await api.sitemapPage(name.type, 1).catch(() => null);
    if (!first) throw data('not found', { status: 404 });
    throw redirect(`/sitemaps/${name.type}-1.xml`, 301);
  }
  if (name.kind === 'pages') {
    const paths = [...PAGES, ...DOC_PAGES.map((p) => `/developers${p.slug ? `/${p.slug}` : ''}`)];
    return xmlResponse(urlset([...new Set(paths)].flatMap((path) => urlEntries(base, path))));
  }
  const page = await api.sitemapPage(name.type, name.page).catch(() => null);
  if (!page) throw data('not found', { status: 404 });
  const entries = page.items.flatMap((item) => urlEntries(base, item.path ?? `/${item.id}`, item.lastmod)).slice(0, SITEMAP_LIMIT);
  return xmlResponse(urlset(entries));
}
