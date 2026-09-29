/**
 * Indexes for the lists that crawlers and busy pages read whole.
 *
 *   entity_type_id     items of a type in id order: the sitemaps
 *                      (core/sitemap.ts) count and cut a type into pages
 *                      from this index alone, however many there are.
 *   entity_type_order  items of a type in path order (GET /v1/entities,
 *                      Catalog.list): each page is read on from where the
 *                      last ended, instead of every item of the type being
 *                      sorted again for each page.
 */
export const up = `
CREATE INDEX entity_type_id ON entity (type, id) WHERE main_rev IS NOT NULL AND NOT deleted;
CREATE INDEX entity_type_order ON entity (type, (coalesce(path, '') || id)) WHERE main_rev IS NOT NULL AND NOT deleted;
`;
