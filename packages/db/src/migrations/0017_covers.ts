/**
 * A sefer's cover from its title page (the shaar): the page of its best
 * PDF that the jobs' `covers` found to be the title page, or the page a
 * keeper chose instead through a suggestion (the work's `cover` field),
 * drawn at two sizes. The pictures are derivations of the PDF (profiles
 * `cover/<page>` and `cover-thumb/<page>`), so they follow its rights: a
 * takedown takes the cover down too.
 *
 *   cover   one row per item with a cover: which file and page it is,
 *           whether a machine or a person chose the page (a machine's
 *           choice is labelled until a person picks), why, and the two
 *           pictures
 *
 * Made by the jobs from files, regenerable, and not catalog data, so not
 * versioned; the person's choice is, in the work itself.
 */
export const up = /* sql */ `
CREATE TABLE cover (
  entity_id TEXT PRIMARY KEY REFERENCES entity (id),
  src_sha256 TEXT NOT NULL REFERENCES file (sha256),
  page INTEGER NOT NULL CHECK (page >= 1),
  chosen_by TEXT NOT NULL CHECK (chosen_by IN ('machine', 'person')),
  -- how sure the machine was, and the cues it went by ("blank page 1", "publisher line")
  score REAL,
  reasons TEXT[] NOT NULL DEFAULT '{}',
  image_sha256 TEXT NOT NULL REFERENCES file (sha256),
  image_width INTEGER NOT NULL,
  image_height INTEGER NOT NULL,
  thumb_sha256 TEXT NOT NULL REFERENCES file (sha256),
  thumb_width INTEGER NOT NULL,
  thumb_height INTEGER NOT NULL,
  -- the tool and its version: cover@1
  encoder TEXT NOT NULL,
  made_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX cover_src ON cover (src_sha256);
`;
