/**
 * Scans and files, the plan's phase 3 (sections 7 and 8).
 *
 *   file_fingerprint  what a held file was measured to be, once: a PDF's
 *                     page count, a recording's length and its audio
 *                     fingerprint (@rebbehub/model, fingerprints.ts), so
 *                     the same recording in other bytes is caught
 *   file_page         one row per page of a PDF: its size, its perceptual
 *                     hash cut in bands (a GIN index finds near pages
 *                     without comparing every one), and, for a served
 *                     scan, its page image and thumbnail - derivations,
 *                     regenerable from the PDF, and what the scan's IIIF
 *                     manifest is made of
 *   family_request    a family's request that a teshura not be shown
 *                     (docs/rights.md): the Report it came as, and the
 *                     files whose serving it paused at once
 *
 * All of it is made from files by the jobs or asked by people; none of it
 * is catalog data, so none of it is versioned.
 */
export const up = /* sql */ `
CREATE TABLE file_fingerprint (
  sha256 TEXT PRIMARY KEY REFERENCES file (sha256),
  kind TEXT NOT NULL CHECK (kind IN ('pdf-pages', 'audio')),
  -- the tool and its version: dhash-256@1, rh-audio@1
  encoder TEXT NOT NULL,
  pages INTEGER CHECK (pages >= 0),
  duration_ms BIGINT CHECK (duration_ms >= 0),
  -- a recording's sub-fingerprints, one per 93 ms
  audio INTEGER[],
  made_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX file_fingerprint_audio ON file_fingerprint (duration_ms) WHERE kind = 'audio';

CREATE TABLE file_page (
  sha256 TEXT NOT NULL REFERENCES file (sha256),
  page INTEGER NOT NULL CHECK (page >= 1),
  -- the page as it shows (its /Rotate applied), in PDF points
  width_pt REAL NOT NULL,
  height_pt REAL NOT NULL,
  -- 64 hex digits; null for a blank page
  hash TEXT CHECK (hash ~ '^[0-9a-f]{64}$'),
  bands INTEGER[],
  -- a served scan's page image and thumbnail (JPEG files, derivations of the PDF)
  image_sha256 TEXT REFERENCES file (sha256),
  image_width INTEGER,
  image_height INTEGER,
  thumb_sha256 TEXT REFERENCES file (sha256),
  thumb_width INTEGER,
  thumb_height INTEGER,
  PRIMARY KEY (sha256, page)
);
CREATE INDEX file_page_bands ON file_page USING gin (bands);

CREATE TABLE family_request (
  report_id BIGINT PRIMARY KEY REFERENCES report (id),
  publication_id TEXT NOT NULL REFERENCES entity (id),
  -- how the person asking is related ("the chosson's father"), in their words
  relation TEXT,
  -- how to reach them, if they gave it: read by stewards only, never shown
  contact TEXT,
  -- the files whose serving the request paused
  paused TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX family_request_publication ON family_request (publication_id);
`;
