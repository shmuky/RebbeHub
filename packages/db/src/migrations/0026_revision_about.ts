/**
 * Indexes over what a version points at, so an item's page finds the
 * suggestions about it by looking them up.
 *
 * "The suggestions about an item" are the suggestions with a version of
 * it, or of what is in it: a unit of the work (`data->>'work'`), a text
 * of the unit (`unit`), a segment of the text (`text`), a recording of
 * the farbrengen (`event`). Finding them read every version in the
 * database (141,000, most of them a sefer's sichos from an import) and
 * unpacked each one's data twice a page: ten seconds of the database for
 * every item page. These four indexes make each of those a lookup.
 */
export const up = /* sql */ `
CREATE INDEX revision_about_work ON revision ((data->>'work'));
CREATE INDEX revision_about_unit ON revision ((data->>'unit'));
CREATE INDEX revision_about_text ON revision ((data->>'text'));
CREATE INDEX revision_about_event ON revision ((data->>'event'));
`;
