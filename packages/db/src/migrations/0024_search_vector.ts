/**
 * The search index, kept once instead of made again on every search.
 *
 *   entity.search_tsv   the words of `search_text` as Postgres searches
 *                       them (to_tsvector, 'simple'), written with
 *                       search_text (Catalog.updateMain) and indexed
 *                       (entity_search_tsv). Search ranked its matches by
 *                       re-reading every matching item's words: a common
 *                       word matches fourteen thousand sichos, and ranking
 *                       them took thirteen seconds on the live database.
 *                       Ranked from this column, it reads what is kept.
 *
 * The old expression index (entity_search, migration 0001) stays until
 * the code that reads it is gone from every Worker; the next migration
 * drops it.
 */
export const up = /* sql */ `
ALTER TABLE entity ADD COLUMN search_tsv tsvector;
UPDATE entity SET search_tsv = to_tsvector('simple', coalesce(search_text, '')) WHERE search_text IS NOT NULL;
CREATE INDEX entity_search_tsv ON entity USING gin (search_tsv);
`;
