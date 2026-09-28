/**
 * Who people are and how they sign in, kept apart from the catalog in a
 * schema of its own (`auth`).
 *
 * The catalog in `public` can be rebuilt from its sources and copied in
 * whole while importers made everything in it (scripts/import-catalog.sh
 * replaces every table in `public`); signing in is not adding to the
 * catalog, so nobody's account, passkeys or session may live there. A
 * person's `public.account` row, which the catalog's suggestions point
 * at, is made again from `auth.person` whenever they are signed in.
 *
 *   auth.person     a person: an id (`u-…`) and the name they go by
 *   auth.passkey    their passkeys (WebAuthn credentials), each a public key
 *   auth.session    signed-in browsers, by the hash of the cookie's token
 *   auth.challenge  one-time WebAuthn challenges, a few minutes each
 */
export const up = `
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE auth.person (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE auth.passkey (
  credential_id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES auth.person (id) ON DELETE CASCADE,
  -- the credential's public key, COSE-encoded, as base64url
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT[] NOT NULL DEFAULT '{}',
  device_type TEXT,
  backed_up BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX passkey_person ON auth.passkey (person_id);

CREATE TABLE auth.session (
  -- sha256 of the cookie's token: the token itself is never stored
  token_hash TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES auth.person (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_agent TEXT
);
CREATE INDEX session_person ON auth.session (person_id);

CREATE TABLE auth.challenge (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'sign-in')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
`;
