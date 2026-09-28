/**
 * The files Sichos-Kodesh's archive wants and upstream would not give
 * (its `wanted` list, less what it holds): a hanacha whose Drive link is
 * gone, a recording JEM's CDN no longer answers for. They feed the Missing
 * board, where someone who has the file can add it. The list is the
 * archive's, loaded whole each time (`rebbehub archive-gaps`); `entity_id`
 * is the RebbeHub item the file belongs to, when there is one.
 */
export const up = `
CREATE TABLE archive_gap (
  collection TEXT NOT NULL,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  entity_id TEXT,
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  label TEXT,
  hebrew_date TEXT,
  status TEXT NOT NULL CHECK (status IN ('unresolved', 'error')),
  http_status INTEGER,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  checked_at TIMESTAMPTZ,
  loaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (collection, item_id, kind, source_id, role)
);
CREATE INDEX archive_gap_entity ON archive_gap (entity_id);
`;
