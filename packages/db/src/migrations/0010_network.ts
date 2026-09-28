/**
 * What the machines keep about the catalog for phase 6 (the plan, section
 * 9, "Making it smart"), none of it catalog facts, all of it rebuilt by
 * running the job again:
 *
 *   embedding     each item's meaning as a vector, for "find sichos about
 *                 this idea". Kept as a plain `real[]`, so any Postgres
 *                 (PGlite in tests included) can compare them; where the
 *                 pgvector extension can be had (Neon), it is switched on
 *                 and an index makes the comparison fast.
 *   link_check    every address the catalog links to, and whether it
 *                 still answers: the health page's dead links.
 *   machine_pass  which revision of an item a machine has already read
 *                 (citations), so a run reads only what changed.
 *
 * And two indexes: relations by their ends, so a citation the machine
 * found is never proposed twice, even after a person sent it back; and
 * items by the commit that last changed them, which is how libraries
 * harvest the catalog (OAI-PMH: "what changed since").
 */
export const up = /* sql */ `
CREATE TABLE embedding (
  entity_id TEXT PRIMARY KEY REFERENCES entity (id),
  -- the revision whose words were embedded; a newer main_rev is embedded again
  rev BIGINT NOT NULL,
  model TEXT NOT NULL,
  -- unit length, so a dot product is the cosine
  vector REAL[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX embedding_model ON embedding (model);

-- pgvector where it can be had; without it, semantic search compares the arrays in plain SQL.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
  EXECUTE 'CREATE INDEX embedding_hnsw ON embedding USING hnsw ((vector::vector(1024)) vector_cosine_ops)';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector is not available here: semantic search compares vectors without it';
END
$$;

CREATE TABLE link_check (
  url TEXT PRIMARY KEY,
  -- the items that link to it, as of the last check
  entity_ids TEXT[] NOT NULL DEFAULT '{}',
  status INTEGER,
  ok BOOLEAN NOT NULL,
  error TEXT,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- when it first failed in the current run of failures; null while it answers
  failing_since TIMESTAMPTZ
);
CREATE INDEX link_check_failing ON link_check (failing_since) WHERE NOT ok;

CREATE TABLE machine_pass (
  job TEXT NOT NULL,
  entity_id TEXT NOT NULL REFERENCES entity (id),
  rev BIGINT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (job, entity_id)
);

CREATE INDEX revision_relation_ends ON revision ((data->>'from'), (data->>'to')) WHERE entity_type = 'relation';
CREATE INDEX entity_updated ON entity (updated_seq, id) WHERE updated_seq IS NOT NULL;
`;
