/**
 * Where a person stopped (the reader and the player): the page of a PDF
 * they were reading and the moment of a farbrengen they were hearing, kept
 * for their account so another device opens there too, and so the home
 * page can offer "continue". One row per thing, the latest place only;
 * the site also keeps the same in the browser for people not signed in.
 * `place` is what the page needs to reopen there (a page number, or a
 * queue, a part and a time), small and never read by the database.
 *
 * Kept with the person in `auth`, not in `public`, which a rebuild of the
 * catalog replaces whole (migration 0005): a rebuild never loses anyone's
 * places. `account_id` is the person's id, which their catalog account
 * shares.
 */
export const up = `
CREATE TABLE auth.reading_place (
  account_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('read', 'listen')),
  key TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 1000),
  title TEXT NOT NULL,
  sub TEXT,
  href TEXT NOT NULL,
  place JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, kind, key)
);
CREATE INDEX reading_place_recent ON auth.reading_place (account_id, updated_at DESC);
`;
