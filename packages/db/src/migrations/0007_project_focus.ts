/**
 * A project's focus: the gap it works through (the plan, section 7: "Sync
 * the 5745 farbrengens", the Missing board). `{ "missing": "recordings",
 * "within": "5745" }` makes the project's to-do list the farbrengens of
 * 5745 with no recording, its progress how many of them have one now.
 */
export const up = `
ALTER TABLE project ADD COLUMN focus JSONB;
`;
