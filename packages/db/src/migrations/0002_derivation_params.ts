/**
 * What a derivation was made with, beyond its encoder: for a scan's
 * reading copy (straightened, centred, cut free of the scanner's edges),
 * each page's tilt, text box and the transform from the original page to
 * the new one - so a line OCR found on the original can be shown in the
 * right place on the reading copy, and the next OCR run can reuse the
 * measurements instead of making them again.
 */
export const up = /* sql */ `
ALTER TABLE derivation ADD COLUMN params JSONB;
`;
