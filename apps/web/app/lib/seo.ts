import type { MetaDescriptor } from 'react-router';
import type { Lang } from './i18n.js';

export interface PageMeta {
  title: string;
  description?: string;
  /** The page's path, without the language. */
  path: string;
  lang: Lang;
  siteUrl: string;
  /** schema.org data for search engines. */
  jsonLd?: Record<string, unknown>;
  noindex?: boolean;
}

/**
 * Title, description, the canonical address, the page in the other
 * language, social previews and structured data - the same on every page.
 */
export function pageMeta(page: PageMeta): MetaDescriptor[] {
  const base = page.siteUrl.replace(/\/$/, '');
  const he = `${base}${page.path}`;
  const en = `${base}${page.path}${page.path.includes('?') ? '&' : '?'}lang=en`;
  const title = page.title ? `${page.title} · RebbeHub` : 'RebbeHub';
  const out: MetaDescriptor[] = [
    { title },
    { property: 'og:title', content: title },
    { property: 'og:site_name', content: 'RebbeHub' },
    { property: 'og:type', content: 'website' },
    { property: 'og:url', content: page.lang === 'en' ? en : he },
    { property: 'og:locale', content: page.lang === 'en' ? 'en_US' : 'he_IL' },
    { tagName: 'link', rel: 'canonical', href: page.lang === 'en' ? en : he },
    { tagName: 'link', rel: 'alternate', hrefLang: 'he', href: he },
    { tagName: 'link', rel: 'alternate', hrefLang: 'en', href: en },
    { tagName: 'link', rel: 'alternate', hrefLang: 'x-default', href: he },
  ];
  if (page.description) out.push({ name: 'description', content: page.description }, { property: 'og:description', content: page.description });
  if (page.noindex) out.push({ name: 'robots', content: 'noindex' });
  if (page.jsonLd) out.push({ 'script:ld+json': { '@context': 'https://schema.org', ...page.jsonLd } });
  return out;
}
