/**
 * Personal API tokens (docs/developers/auth.md): a person makes one on
 * their account page so a script or an agent can read what is theirs and
 * send suggestions as them, under the same review rules as the site. A
 * token is shown once, when it is made; only its sha256 is kept, with its
 * first characters to tell tokens apart on the account page.
 *
 *   scopes      'read' (what is the person's own: places, follows,
 *               webhooks) and 'write' (suggestions, fixes, comments,
 *               uploads). Reading the catalog needs no token at all.
 *   expires_at  optional; a token past it no longer signs in.
 *   revoked_at  set when the person (or a steward suspending them)
 *               revokes it; kept, so the account page shows it was.
 *
 * Kept with the person in `auth`, not in `public`, which a rebuild of the
 * catalog replaces whole (migration 0005).
 */
export const up = `
CREATE TABLE auth.api_token (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES auth.person (id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  -- the token's first characters (rhp_ and four more), to recognise it; never enough to use it
  prefix TEXT NOT NULL,
  -- sha256 of the token: the token itself is never stored
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL CHECK (scopes <@ ARRAY['read', 'write']::text[] AND cardinality(scopes) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX api_token_person ON auth.api_token (person_id, created_at DESC);
`;
