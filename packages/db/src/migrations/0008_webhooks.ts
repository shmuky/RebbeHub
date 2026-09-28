/**
 * Webhooks (the plan, section 12, phase 6: "public API + webhooks"): a
 * person registers an address, and every merge to the catalog is posted
 * to it, signed with the hook's own secret, in order and at least once.
 * `last_seq` is the last commit delivered; a hook that keeps failing is
 * switched off.
 */
export const up = `
CREATE TABLE webhook (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES account (id),
  url TEXT NOT NULL CHECK (url ~ '^https://'),
  secret TEXT NOT NULL,
  last_seq BIGINT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  failures INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX webhook_account ON webhook (account_id);
`;
