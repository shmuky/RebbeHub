/**
 * Page fixes: what a scanned PDF needs to read straight, measured once per
 * file by pdf-fix (packages/pdf-fix). The verdict says what was found: a
 * file `fixed` has a turn (and, for a reading copy, a placing and a cut)
 * for each page it changes; one `as-is` needs nothing (set in type, or
 * already level); one `failed` could not be fixed safely. The pages are
 * kept whether or not RebbeHub holds the file: a reader draws a linked
 * file through them, OCR draws its lines through them, and nothing is
 * measured twice. A file with a reading copy also has its `reading-copy`
 * derivation.
 */
export const up = /* sql */ `
CREATE TABLE page_fix (
  sha256 TEXT PRIMARY KEY REFERENCES file (sha256),
  encoder TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('fixed', 'as-is', 'failed')),
  reason TEXT,
  pages JSONB NOT NULL DEFAULT '[]',
  made_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
