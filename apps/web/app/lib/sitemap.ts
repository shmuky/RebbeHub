/** The kinds of page listed for search engines; the others are reached through them. */
export const SITEMAP_TYPES = ['set', 'author', 'work', 'unit', 'event', 'publication', 'recording'] as const;

/** A sitemap holds at most 50,000 addresses. */
export const SITEMAP_LIMIT = 50_000;

export const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
