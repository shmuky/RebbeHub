/**
 * Stewards, kept with the person. The catalog's `account.is_steward` is
 * in `public`, which a rebuild of the catalog replaces whole
 * (scripts/import-catalog.sh); a person's steward mark lives here, apart
 * from the catalog, and is copied to their catalog account whenever they
 * are signed in.
 */
export const up = `
ALTER TABLE auth.person ADD COLUMN steward BOOLEAN NOT NULL DEFAULT FALSE;
`;
