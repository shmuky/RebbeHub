/**
 * Platform admins: above stewards. An admin is a steward who also
 * appoints and removes stewards and admins, and whom no steward can
 * suspend or demote. Kept with the person, apart from the catalog, as the
 * steward mark is (migration 0005).
 */
export const up = `
ALTER TABLE auth.person ADD COLUMN admin BOOLEAN NOT NULL DEFAULT FALSE;
`;
