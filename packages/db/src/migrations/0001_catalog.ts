/**
 * The versioned catalog (docs/plans/rebbehub.md, section 6).
 *
 * Nothing is updated in place except pointers: an entity's `main_rev`, a
 * changeset's status, a project's overlay. Every version of every item is
 * a row in `revision`, every merge is a row in `commit` with its changes
 * listed in `commit_change`, so "the catalog as of commit N" is the last
 * `commit_change` per entity with `commit_seq <= N`, and any version can
 * be restored.
 *
 *   account          people and bots; trust is earned, stewards appointed
 *   entity           what exists: id, type, current revision on main, path
 *   revision         every version of every entity (partitioned by time)
 *   changeset        a Suggestion: revisions proposed together for review
 *   commit           main, a linear sequence of merges
 *   commit_change    what each merge changed, entity by entity
 *   project          a branch: an overlay of revisions over main
 *   project_head     the overlay: each entity's revision within a project
 *   review, comment, report, follow, audit_log
 *   file, file_source, derivation      bytes, by sha256, with rights
 *   catalog_edition  a dated, tagged commit (a release) and its dumps
 *   entity_ref       main's links between entities, for backlinks and sets
 *   entity_external_id  main's ids from other systems, for duplicate checks
 *   path_redirect    old paths that still lead to their entity
 */
export const up = /* sql */ `
CREATE TABLE account (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email TEXT UNIQUE,
  -- earned: contributor on sign-in, trusted after enough approved suggestions and no reverts
  trust TEXT NOT NULL DEFAULT 'contributor' CHECK (trust IN ('contributor', 'trusted')),
  is_steward BOOLEAN NOT NULL DEFAULT FALSE,
  -- importers, OCR, sync: labelled, and never merge their own work
  is_bot BOOLEAN NOT NULL DEFAULT FALSE,
  approved_count INTEGER NOT NULL DEFAULT 0,
  reverted_count INTEGER NOT NULL DEFAULT 0,
  suspended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE entity (
  id TEXT PRIMARY KEY CHECK (id ~ '^rh-[0-9a-hjkmnp-tv-z]{6,16}$'),
  type TEXT NOT NULL,
  -- null until the entity's first revision is merged to main
  main_rev BIGINT,
  -- the current path on main; old ones live in path_redirect
  path TEXT,
  -- normalised text of main's revision, for the built-in search
  search_text TEXT,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_seq BIGINT
);
CREATE UNIQUE INDEX entity_path ON entity (path) WHERE path IS NOT NULL AND NOT deleted;
CREATE INDEX entity_type ON entity (type) WHERE main_rev IS NOT NULL AND NOT deleted;
CREATE INDEX entity_search ON entity USING gin (to_tsvector('simple', coalesce(search_text, '')));

CREATE TABLE changeset (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  author TEXT NOT NULL REFERENCES account (id),
  -- draft: being written; open: sent for review; merged; sent_back: returned with a note; withdrawn
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'merged', 'sent_back', 'withdrawn')),
  -- suggestion: a person's; import: a bot's; revert: undoing a merged one; live: a trusted fix that went live and is reviewed after
  kind TEXT NOT NULL DEFAULT 'suggestion' CHECK (kind IN ('suggestion', 'import', 'revert', 'live')),
  project_id BIGINT,
  -- the main commit it was written against
  base_commit BIGINT NOT NULL DEFAULT 0,
  merged_commit BIGINT,
  reverts_changeset BIGINT REFERENCES changeset (id),
  -- a live change (trusted, open set) is merged first and reviewed after
  post_review TEXT CHECK (post_review IN ('pending', 'done')),
  -- results of the automatic checks, shown to the reviewer
  checks JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);
CREATE INDEX changeset_status ON changeset (status, submitted_at);
CREATE INDEX changeset_author ON changeset (author, created_at DESC);
CREATE INDEX changeset_project ON changeset (project_id) WHERE project_id IS NOT NULL;

-- Append-only. Partitioned by time so tens of millions of revisions stay cheap to hold.
CREATE TABLE revision (
  id BIGINT GENERATED ALWAYS AS IDENTITY,
  entity_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  -- the revision this one was made from; null for an entity's first
  parent_rev BIGINT,
  -- a merge that combined two lines of change records the other one here
  merge_rev BIGINT,
  -- null: this revision deletes the entity
  data JSONB,
  path TEXT,
  hash TEXT NOT NULL,
  changeset_id BIGINT NOT NULL,
  author TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
CREATE TABLE revision_default PARTITION OF revision DEFAULT;
CREATE INDEX revision_id ON revision (id);
CREATE INDEX revision_entity ON revision (entity_id, id DESC);
CREATE INDEX revision_changeset ON revision (changeset_id, entity_id, id DESC);
-- a text's segments and an alignment's spans, at any commit (the git mirror renders them together)
CREATE INDEX revision_segment_text ON revision ((data->>'text')) WHERE entity_type = 'segment';
CREATE INDEX revision_span_alignment ON revision ((data->>'alignment')) WHERE entity_type = 'alignment-span';

CREATE TABLE commit (
  seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changeset_id BIGINT NOT NULL REFERENCES changeset (id),
  merged_by TEXT NOT NULL REFERENCES account (id),
  message TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE commit_change (
  commit_seq BIGINT NOT NULL REFERENCES commit (seq),
  entity_id TEXT NOT NULL REFERENCES entity (id),
  -- the revision it became (a deletion is a revision with no data)
  rev_id BIGINT NOT NULL,
  prev_rev_id BIGINT,
  PRIMARY KEY (commit_seq, entity_id)
);
CREATE INDEX commit_change_entity ON commit_change (entity_id, commit_seq DESC);

CREATE TABLE project (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  goal TEXT,
  set_id TEXT REFERENCES entity (id),
  keepers TEXT[] NOT NULL DEFAULT '{}',
  base_commit BIGINT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'merged', 'closed')),
  created_by TEXT NOT NULL REFERENCES account (id),
  merged_commit BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE changeset ADD CONSTRAINT changeset_project_fk FOREIGN KEY (project_id) REFERENCES project (id);

CREATE TABLE project_head (
  project_id BIGINT NOT NULL REFERENCES project (id),
  entity_id TEXT NOT NULL REFERENCES entity (id),
  rev_id BIGINT NOT NULL,
  -- main's revision when the project first changed this entity: the base of its eventual merge
  base_rev BIGINT,
  PRIMARY KEY (project_id, entity_id)
);

CREATE TABLE review (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  changeset_id BIGINT NOT NULL REFERENCES changeset (id),
  reviewer TEXT NOT NULL REFERENCES account (id),
  verdict TEXT NOT NULL CHECK (verdict IN ('approve', 'send_back', 'comment')),
  body TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX review_changeset ON review (changeset_id, created_at);

CREATE TABLE comment (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('changeset', 'report', 'entity', 'project')),
  target_id TEXT NOT NULL,
  parent_id BIGINT REFERENCES comment (id),
  author TEXT NOT NULL REFERENCES account (id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  hidden_at TIMESTAMPTZ
);
CREATE INDEX comment_target ON comment (target_kind, target_id, created_at);

CREATE TABLE report (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_id TEXT REFERENCES entity (id),
  -- the set whose inbox it lands in
  set_id TEXT REFERENCES entity (id),
  reason TEXT NOT NULL CHECK (reason IN ('wrong-fact', 'missing-page', 'bad-scan', 'audio-problem', 'wrong-text', 'duplicate', 'rights', 'offensive', 'other')),
  note TEXT,
  -- null for an anonymous report
  reporter TEXT REFERENCES account (id),
  -- a salted hash of the address, for rate limits; never the address itself
  reporter_hash TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_by TEXT REFERENCES account (id),
  resolution_changeset BIGINT REFERENCES changeset (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);
CREATE INDEX report_inbox ON report (set_id, status, created_at);
CREATE INDEX report_entity ON report (entity_id, status);

CREATE TABLE follow (
  account_id TEXT NOT NULL REFERENCES account (id),
  target_kind TEXT NOT NULL CHECK (target_kind IN ('entity', 'set', 'project', 'changeset')),
  target_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, target_kind, target_id)
);
CREATE INDEX follow_target ON follow (target_kind, target_id);

CREATE TABLE audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_log_target ON audit_log (target_kind, target_id, at);

CREATE TABLE file (
  sha256 TEXT PRIMARY KEY CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  bytes BIGINT NOT NULL CHECK (bytes >= 0),
  mime TEXT NOT NULL,
  rights_state TEXT NOT NULL CHECK (rights_state IN ('open', 'credit', 'link', 'preserved')),
  credit TEXT,
  -- where the bytes are: public bucket, preservation bucket, or not held (link only)
  storage_tier TEXT NOT NULL CHECK (storage_tier IN ('public', 'preservation', 'none')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  rights_changed_at TIMESTAMPTZ,
  rights_changed_by TEXT REFERENCES account (id)
);

CREATE TABLE file_source (
  sha256 TEXT NOT NULL REFERENCES file (sha256),
  source TEXT NOT NULL,
  url TEXT,
  etag TEXT,
  fetched_at TIMESTAMPTZ,
  uploaded_by TEXT REFERENCES account (id),
  -- the rights statement the uploader ticked
  attestation TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX file_source_sha256 ON file_source (sha256);
CREATE UNIQUE INDEX file_source_url ON file_source (source, url) WHERE url IS NOT NULL;

CREATE TABLE derivation (
  src_sha256 TEXT NOT NULL REFERENCES file (sha256),
  profile TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes BIGINT NOT NULL,
  encoder TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (src_sha256, profile)
);

CREATE TABLE catalog_edition (
  tag TEXT PRIMARY KEY CHECK (tag ~ '^\\d{4}\\.\\d{2}(\\.\\d+)?$'),
  commit_seq BIGINT NOT NULL REFERENCES commit (seq),
  created_by TEXT NOT NULL REFERENCES account (id),
  notes TEXT,
  -- the signed manifest of its dumps, once they are made
  manifest JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- main's links, rebuilt for an entity whenever a merge changes it
CREATE TABLE entity_ref (
  from_id TEXT NOT NULL REFERENCES entity (id),
  field TEXT NOT NULL,
  to_id TEXT NOT NULL,
  PRIMARY KEY (from_id, field, to_id)
);
CREATE INDEX entity_ref_to ON entity_ref (to_id, field);

-- main's external ids (a mafteiach occasion, a HebrewBooks book), for spotting the same thing twice
CREATE TABLE entity_external_id (
  entity_id TEXT NOT NULL REFERENCES entity (id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (entity_id, key)
);
CREATE INDEX entity_external_id_value ON entity_external_id (key, value);

CREATE TABLE path_redirect (
  path TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entity (id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The system account that seeds the schema registry, and the author of machine merges.
INSERT INTO account (id, display_name, is_steward) VALUES ('system', 'RebbeHub', TRUE);
`;
