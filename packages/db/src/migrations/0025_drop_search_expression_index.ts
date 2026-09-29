/**
 * Drops the search index migration 0001 made over an expression
 * (entity_search: the words of search_text, computed by Postgres for
 * every search and again for every write). Search reads what is kept in
 * entity.search_tsv since migration 0024, and no Worker has read the old
 * index since 29 Elul 5786; keeping it only made each write compute the
 * words twice and kept a second index of every item's words on disk.
 */
export const up = /* sql */ `
DROP INDEX IF EXISTS entity_search;
`;
