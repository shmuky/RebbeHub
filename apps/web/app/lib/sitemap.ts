/**
 * Sitemaps (sitemaps.org): /sitemap.xml lists them, and each lists up to
 * 10,000 items (the API's /v1/sitemap cuts each kind of item into pages of
 * that size) in both languages, so no sitemap comes near the protocol's
 * 50,000 addresses or 50 MB. They are kept at the edge an hour.
 */

/** A sitemap holds at most 50,000 addresses. */
export const SITEMAP_LIMIT = 50_000;

export const SITEMAP_CACHE = 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400';

export const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** `/sitemaps/unit-3.xml` is units' third page; `pages` is the site's own pages. */
export function sitemapName(name: string): { kind: 'pages' } | { kind: 'items'; type: string; page: number } | { kind: 'legacy'; type: string } | null {
  if (name === 'pages') return { kind: 'pages' };
  const paged = /^([a-z][a-z-]*?)-([1-9][0-9]{0,5})$/.exec(name);
  if (paged) return { kind: 'items', type: paged[1]!, page: Number(paged[2]) };
  // Before sitemaps were paged, each kind had one (`/sitemaps/work.xml`); it is its first page now.
  if (/^[a-z][a-z-]*$/.test(name)) return { kind: 'legacy', type: name };
  return null;
}

/** One page, in Hebrew and in English, each naming the other (and Hebrew as the default). */
export function urlEntries(base: string, path: string, lastmod?: string | null): string[] {
  const he = escapeXml(`${base}${path}`);
  const en = escapeXml(`${base}${path}${path.includes('?') ? '&' : '?'}lang=en`);
  const alternates = `<xhtml:link rel="alternate" hreflang="he" href="${he}"/><xhtml:link rel="alternate" hreflang="en" href="${en}"/><xhtml:link rel="alternate" hreflang="x-default" href="${he}"/>`;
  const mod = lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : '';
  return [`  <url><loc>${he}</loc>${mod}${alternates}</url>`, `  <url><loc>${en}</loc>${mod}${alternates}</url>`];
}

export const urlset = (entries: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join('\n')}\n</urlset>\n`;

export const xmlResponse = (body: string) => new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': SITEMAP_CACHE } });
