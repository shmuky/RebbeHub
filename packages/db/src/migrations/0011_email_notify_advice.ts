/**
 * Email, notifications, the reviewer's advice and takedowns (the plan,
 * sections 7, 9 and 11).
 *
 * In `auth`, apart from the catalog, since they are the person's and a
 * rebuild of the catalog never touches them:
 *
 *   auth.email_address          an address that signs its person in (one person each)
 *   auth.email_link             a sign-in link sent by email: its token's hash, once, for minutes
 *   auth.notification_setting   what a person is told by email of what they follow: off, a daily
 *                               digest, or at once; the last commit they were told of
 *
 * In `public`, beside what they are about:
 *
 *   changeset_advice   a machine's summary of a suggestion for its reviewer: advice, never a merge
 *   takedown           who asked for a takedown and how to answer them, beside its Report
 *                      (reason `rights`); read by stewards alone
 */
export const up = `
CREATE TABLE auth.email_address (
  -- lower-case
  email TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES auth.person (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX email_address_person ON auth.email_address (person_id);

CREATE TABLE auth.email_link (
  -- sha256 of the token in the link: the token itself is never stored
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  -- set when a signed-in person adds this address to their own account
  person_id TEXT REFERENCES auth.person (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);
CREATE INDEX email_link_email ON auth.email_link (email, created_at);
CREATE INDEX email_link_created ON auth.email_link (created_at);

CREATE TABLE auth.notification_setting (
  person_id TEXT PRIMARY KEY REFERENCES auth.person (id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'daily', 'immediate')),
  -- where to write; null: the account's first address
  email TEXT,
  lang TEXT NOT NULL DEFAULT 'he' CHECK (lang IN ('he', 'en')),
  -- the last commit on main the person has been told of
  last_seq BIGINT NOT NULL DEFAULT 0,
  -- when the job last looked for them (a daily digest waits a day from it)
  last_run_at TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ,
  -- the link in every email that stops them, without signing in
  unsubscribe_token TEXT NOT NULL UNIQUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notification_setting_due ON auth.notification_setting (mode, last_run_at);

CREATE TABLE changeset_advice (
  changeset_id BIGINT PRIMARY KEY REFERENCES changeset (id),
  -- null when the machine could not answer (error says why); tried again a few times
  summary TEXT,
  model TEXT NOT NULL,
  -- the sending for review it was written for: sent again, it is written again
  submitted_at TIMESTAMPTZ,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE takedown (
  report_id BIGINT PRIMARY KEY REFERENCES report (id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('rights-holder', 'family', 'representative', 'other')),
  -- what they pointed at, as they gave it (an address on the site, or an id)
  target TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
