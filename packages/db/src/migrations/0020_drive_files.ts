/**
 * The Google Drive files the catalog links to, kept as main changes
 * (packages/core/src/driveFiles.ts): the API reads a public Drive file
 * for the site's reader and player only when an item links to it, so it
 * never fetches just any file from Drive. A file linked with a resource
 * key keeps it, since Drive gives such a file only with its key.
 *
 * Filled here from what main holds now: every Drive file address in an
 * item, as the file's own address or as Sichos-Kodesh's media proxy's,
 * which older imports stored.
 */
export const up = /* sql */ `
CREATE TABLE drive_file (
  file_id TEXT NOT NULL,
  entity_id TEXT NOT NULL REFERENCES entity (id),
  resource_key TEXT,
  PRIMARY KEY (file_id, entity_id)
);
CREATE INDEX drive_file_entity ON drive_file (entity_id);

INSERT INTO drive_file (file_id, entity_id, resource_key)
SELECT DISTINCT ON (m.file_id, m.entity_id) m.file_id, m.entity_id, m.resource_key
FROM (
  SELECT e.id AS entity_id, hit[1] AS file_id, substring(hit[2] from '[?&]resourcekey=([A-Za-z0-9_-]{1,64})') AS resource_key
  FROM entity e
  JOIN revision r ON r.id = e.main_rev
  CROSS JOIN LATERAL regexp_matches(r.data::text, '(?:drive\\.google\\.com/file/d/|\\.workers\\.dev/drive/)([A-Za-z0-9_-]{10,64})([^" ]*)', 'g') AS hit
  WHERE NOT e.deleted AND r.data IS NOT NULL AND r.data::text LIKE '%drive%'
) m
ORDER BY m.file_id, m.entity_id, m.resource_key IS NULL;
`;
