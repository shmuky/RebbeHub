/**
 * An index of the versions whose words a machine wrote (OCR, an import
 * read from a scan), so the list of what waits for a person's check finds
 * them in a lookup.
 *
 * A page's words say who wrote them on the version or on each segment
 * (`origin.by`, packages/model/src/pageText.ts). Finding those pages read
 * every version's words (145,000 versions, most of them a sefer's sichos):
 * about two seconds of the database each time the home page's list was
 * made. The predicate is the one `machineToCheck` asks
 * (packages/core/src/toCheck.ts, MACHINE_WORDS); the two must stay
 * word for word the same, or the planner will not use it.
 */
export const up = /* sql */ `
CREATE INDEX revision_machine_words ON revision (entity_id)
  WHERE jsonb_path_exists(data, 'lax $.body.versions[*].**.origin.by');
`;
