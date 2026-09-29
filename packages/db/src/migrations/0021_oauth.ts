/**
 * Connecting an app with OAuth (docs/developers/auth.md): how Claude and
 * other agents act as a person without the person copying a token by
 * hand. The app sends the person to RebbeHub; they see which app it is and
 * where it will send them back, and say yes or no on the site's own page;
 * the app gets tokens that act as them, under the same review rules as a
 * personal API token (migration 0018).
 *
 *   oauth_client      an app: registered by itself (RFC 7591), or known by
 *                     the address of its own description (a Client ID
 *                     Metadata Document), then `id` is that address and the
 *                     description is read again after a day. Only the
 *                     sha256 of a client secret is kept, when it has one.
 *   oauth_request     one asking, while the person decides (half an hour),
 *                     and then its one-time code (ten minutes): who said
 *                     yes, with the PKCE challenge the code is traded
 *                     against. A code used twice ends the connection made
 *                     from it.
 *   oauth_connection  a person's yes to an app: its current access token
 *                     (an hour) and refresh token (turned over at each use),
 *                     sha256 only. It is what the account page lists and
 *                     revokes, beside the personal tokens.
 *
 * Kept with the person in `auth`, not in `public`, which a rebuild of the
 * catalog replaces whole (migration 0005).
 *
 * And what such an app, or a personal API token, sends for the person
 * (packages/core/src/via.ts): `via` on each suggestion, comment, issue and
 * review says which token or connected app sent it. The person is still
 * its author; `via` says it was not their own hands, so the site shows it
 * as the agent's, "Claude · for @shmuly". Null for what a person did on
 * the site's own pages, and for the importers' bots.
 *
 *   via  { "kind": "token" | "oauth", "id": "tok-…" | "oac-…", "name": …, "client"?: … }
 */
export const up = `
CREATE TABLE auth.oauth_client (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('registered', 'metadata')),
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  uri TEXT,
  redirect_uris TEXT[] NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 20),
  -- sha256 of the client secret, for apps that keep one; public apps (PKCE alone) have none
  secret_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- when a metadata document was last read
  fetched_at TIMESTAMPTZ
);

CREATE TABLE auth.oauth_connection (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES auth.person (id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES auth.oauth_client (id) ON DELETE CASCADE,
  scopes TEXT[] NOT NULL CHECK (scopes <@ ARRAY['read', 'write']::text[] AND cardinality(scopes) > 0),
  -- what the tokens were given for (RFC 8707): the MCP server alone, or the whole API
  resource TEXT NOT NULL,
  access_hash TEXT NOT NULL UNIQUE,
  access_expires_at TIMESTAMPTZ NOT NULL,
  refresh_hash TEXT NOT NULL UNIQUE,
  refresh_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX oauth_connection_person ON auth.oauth_connection (person_id, created_at DESC);

CREATE TABLE auth.oauth_request (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES auth.oauth_client (id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  scopes TEXT[] NOT NULL,
  state TEXT,
  code_challenge TEXT NOT NULL,
  resource TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  -- set when the person decides
  person_id TEXT REFERENCES auth.person (id) ON DELETE CASCADE,
  decided_at TIMESTAMPTZ,
  code_hash TEXT UNIQUE,
  code_expires_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  connection_id TEXT REFERENCES auth.oauth_connection (id) ON DELETE SET NULL
);
CREATE INDEX oauth_request_expires ON auth.oauth_request (expires_at);

ALTER TABLE changeset ADD COLUMN via JSONB;
ALTER TABLE comment ADD COLUMN via JSONB;
ALTER TABLE report ADD COLUMN via JSONB;
ALTER TABLE review ADD COLUMN via JSONB;
`;
