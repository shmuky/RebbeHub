export { analyzePage, findMarks, inkMask, isScanMark, measureAngle, MAX_ANGLE, type Box, type PageAnalysis, type PageBitmap } from './analyze.js';
export { hasPoppler, PAGE_IMAGES_ENCODER, parsePgm, renderPageImages, renderPages, type EncodedImage, type PageImage, type PageImageOptions, type RenderedPage, type RenderOptions } from './render.js';
export { checkFixed, fileScale, fixPdf, LEVEL_TOLERANCE, planPage, type CheckResult, type FixOptions, type FixReport, type PagePlan } from './fix.js';
export { inspectPdf, SCAN_COVER, spread, type PdfKind } from './inspect.js';
export { levelPdf, levelTransform, measureAngles, MIN_TURN, type LevelOptions, type LevelReport, type PageTurn } from './level.js';
export { pageTexts, pdfPageTotal } from './text.js';

/** The tool and its version, as a derivation's `encoder`: bumped whenever a reading copy would come out differently. */
export const PDF_FIX_ENCODER = 'pdf-fix@1';

/** The same for a book's page turns (level.ts), which are measured and kept separately. */
export const PDF_LEVEL_ENCODER = 'pdf-level@1';
