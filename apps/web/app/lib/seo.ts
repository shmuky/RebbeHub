import type { MetaDescriptor } from 'react-router';
import type { Lang } from './i18n.js';

export interface PageMeta {
  title: string;
  description?: string;
  /** The page's path, without the language. */
  path: string;
  lang: Lang;
  siteUrl: string;
  /** schema.org data for search engines: one thing, or several (they go out as one @graph). */
  jsonLd?: Record<string, unknown> | Array<Record<string, unknown>>;
  /** A picture for link previews (a sefer's shaar), as an absolute address. */
  image?: { url: string; width?: number; height?: number; alt?: string } | null;
  /** What the page is, for link previews: most pages are a `website`, a sefer a `book`. */
  type?: 'website' | 'article' | 'book' | 'music.song' | 'profile';
  noindex?: boolean;
}

/** The site's own picture, for pages without one of their own. */
const SITE_IMAGE = '/icon-512.png';

/** A description short enough for a search result and a preview. */
export function clip(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30))}…`;
}

/**
 * Title, description, the canonical address, the page in the other
 * language, social previews and structured data - the same on every page.
 *
 * The language is in the address (`?lang=en`), so each language is its own
 * page: each is canonical to itself and names the other (hreflang), with
 * Hebrew as the default. A page kept out of search (`noindex`) is still
 * followed, so what it links to is found.
 */
export function pageMeta(page: PageMeta): MetaDescriptor[] {
  const base = page.siteUrl.replace(/\/$/, '');
  const he = `${base}${page.path}`;
  const en = `${base}${page.path}${page.path.includes('?') ? '&' : '?'}lang=en`;
  const self = page.lang === 'en' ? en : he;
  const title = page.title ? `${page.title} · RebbeHub` : 'RebbeHub';
  const image = page.image ?? { url: `${base}${SITE_IMAGE}`, width: 512, height: 512, alt: 'RebbeHub' };
  const out: MetaDescriptor[] = [
    { title },
    { property: 'og:title', content: title },
    { property: 'og:site_name', content: 'RebbeHub' },
    { property: 'og:type', content: page.type ?? 'website' },
    { property: 'og:url', content: self },
    { property: 'og:locale', content: page.lang === 'en' ? 'en_US' : 'he_IL' },
    { property: 'og:locale:alternate', content: page.lang === 'en' ? 'he_IL' : 'en_US' },
    { property: 'og:image', content: image.url },
    ...(image.width ? [{ property: 'og:image:width', content: String(image.width) }] : []),
    ...(image.height ? [{ property: 'og:image:height', content: String(image.height) }] : []),
    ...(image.alt ? [{ property: 'og:image:alt', content: image.alt }] : []),
    // A sefer's shaar is tall: the large card shows it; the site's icon is small and square.
    { name: 'twitter:card', content: page.image ? 'summary_large_image' : 'summary' },
    { name: 'twitter:title', content: title },
    { name: 'twitter:image', content: image.url },
    { tagName: 'link', rel: 'canonical', href: self },
    { tagName: 'link', rel: 'alternate', hrefLang: 'he', href: he },
    { tagName: 'link', rel: 'alternate', hrefLang: 'en', href: en },
    { tagName: 'link', rel: 'alternate', hrefLang: 'x-default', href: he },
  ];
  if (page.description) {
    const description = clip(page.description);
    out.push({ name: 'description', content: description }, { property: 'og:description', content: description }, { name: 'twitter:description', content: description });
  }
  if (page.noindex) out.push({ name: 'robots', content: 'noindex, follow' });
  if (page.jsonLd) {
    const things = Array.isArray(page.jsonLd) ? page.jsonLd : [page.jsonLd];
    out.push({ 'script:ld+json': things.length === 1 ? { '@context': 'https://schema.org', ...things[0] } : { '@context': 'https://schema.org', '@graph': things } });
  }
  return out;
}

/** The way to a page, as search engines show it under the page's name (schema.org BreadcrumbList). */
export function breadcrumbs(siteUrl: string, steps: Array<{ name: string; path: string }>): Record<string, unknown> {
  const base = siteUrl.replace(/\/$/, '');
  return {
    '@type': 'BreadcrumbList',
    itemListElement: steps.filter((s) => s.name).map((s, i) => ({ '@type': 'ListItem', position: i + 1, name: s.name, item: `${base}${s.path}` })),
  };
}
