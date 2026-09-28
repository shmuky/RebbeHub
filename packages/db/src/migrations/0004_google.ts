/**
 * Signing in with Google (docs/accounts.md): a Google account, known by
 * the id Google gives it (`sub`), belongs to one person. Its email is kept
 * only to show the person which Google account they linked.
 *
 * A Google sign-in's one-time state (what the browser is sent to Google
 * with, and must bring back) is a challenge like a passkey's, so the
 * challenge table takes a third purpose.
 */
export const up = `
CREATE TABLE auth.google_account (
  sub TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES auth.person (id) ON DELETE CASCADE,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX google_account_person ON auth.google_account (person_id);

ALTER TABLE auth.challenge DROP CONSTRAINT challenge_purpose_check;
ALTER TABLE auth.challenge ADD CONSTRAINT challenge_purpose_check CHECK (purpose IN ('register', 'sign-in', 'google'));
`;
