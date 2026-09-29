/**
 * People asking the machines for work (core/machineWork.ts):
 *
 *   machine_request   "read this scan" (OCR) or "transcribe this
 *                     recording", from the site, the API, the MCP tools or
 *                     the jobs themselves when something new is added. The
 *                     free CPU jobs (services/jobs, .github/workflows) take
 *                     the waiting ones first, oldest first, and mark each
 *                     done or failed. One waiting request per item and
 *                     kind; asking again joins it.
 */
export const up = /* sql */ `
CREATE TABLE machine_request (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('ocr', 'transcript')),
  entity_id TEXT NOT NULL REFERENCES entity (id),
  requested_by TEXT NOT NULL REFERENCES account (id),
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'running', 'done', 'failed')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX machine_request_open ON machine_request (kind, entity_id) WHERE status IN ('waiting', 'running');
CREATE INDEX machine_request_waiting ON machine_request (kind, created_at) WHERE status = 'waiting';
CREATE INDEX machine_request_by ON machine_request (requested_by, created_at);
`;
