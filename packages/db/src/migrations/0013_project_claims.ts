/**
 * Who is working on what in a project (the plan, section 7: the project
 * page "hands out the next unclaimed page or recording"). A person asks
 * for the next one and it is theirs for a while, so two people are not
 * given the same recording to sync or the same page to proofread. A claim
 * lapses on its own (the code reads it as live for a few hours), so
 * nothing needs to hand it back.
 */
export const up = `
CREATE TABLE project_claim (
  project_id BIGINT NOT NULL REFERENCES project (id),
  item TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES account (id),
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, item)
);
CREATE INDEX project_claim_account ON project_claim (account_id, claimed_at DESC);
`;
