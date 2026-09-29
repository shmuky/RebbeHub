/**
 * Where a merged or emptied item's readers go (core/organize.ts).
 *
 *   entity_forward   "B was merged into A": written with the suggestion
 *                    that merges B into A (or deletes an empty set, into
 *                    its parent), and acted on only when that suggestion
 *                    is approved: B's old paths then redirect to A.
 */
export const up = `
CREATE TABLE entity_forward (
  changeset_id BIGINT NOT NULL REFERENCES changeset (id),
  from_id TEXT NOT NULL REFERENCES entity (id),
  to_id TEXT NOT NULL REFERENCES entity (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (changeset_id, from_id)
);
CREATE INDEX entity_forward_from ON entity_forward (from_id);
`;
