/**
 * A page's words became structure (built-in schemas version 5,
 * @rebbehub/model's pageText.ts): versions of segments with a few marks,
 * where they had been one string of wiki markup. The words themselves are
 * turned over by `rebbehub convert-bodies` (core's convertLegacyBodies),
 * as reviewed system changes in the history like any other, a batch at a
 * time; this index finds the versions still holding a string body, so
 * each batch starts at once however large the history is, and a check
 * that none is left on main is quick.
 */
export const up = `
CREATE INDEX revision_legacy_body ON revision (entity_id) WHERE jsonb_typeof(data->'body') = 'string';
`;
