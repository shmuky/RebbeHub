import type { Route } from './+types/opensearch';
import { siteOf } from '../lib/context.server.js';
import { escapeXml } from '../lib/sitemap.js';

/**
 * RebbeHub as a search engine of the browser's own (OpenSearch 1.1): the
 * address bar can search the catalog, as the home page's SearchAction
 * tells search engines. root.tsx links it from every page.
 */
export function openSearchXml(siteUrl: string): string {
  const base = escapeXml(siteUrl.replace(/\/$/, ''));
  return `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/" xmlns:moz="http://www.mozilla.org/2006/browser/search/">
  <ShortName>RebbeHub</ShortName>
  <Description>Search the open index of Chabad Torah and media: sefarim, sichos, letters, farbrengens and recordings.</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <Image width="192" height="192" type="image/png">${base}/icon-192.png</Image>
  <Url type="text/html" method="get" template="${base}/search?q={searchTerms}"/>
  <Url type="application/opensearchdescription+xml" rel="self" template="${base}/opensearch.xml"/>
  <moz:SearchForm>${base}/search</moz:SearchForm>
</OpenSearchDescription>
`;
}

export function loader({ context }: Route.LoaderArgs) {
  return new Response(openSearchXml(siteOf(context).siteUrl), {
    headers: { 'content-type': 'application/opensearchdescription+xml; charset=utf-8', 'cache-control': 'public, max-age=86400' },
  });
}
