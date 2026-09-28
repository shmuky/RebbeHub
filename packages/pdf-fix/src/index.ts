export { analyzePage, findMarks, inkMask, isScanMark, measureAngle, MAX_ANGLE, type Box, type PageAnalysis, type PageBitmap } from './analyze.js';
export { renderPages, type RenderedPage, type RenderOptions } from './render.js';
export { checkFixed, fileScale, fixPdf, LEVEL_TOLERANCE, planPage, type CheckResult, type FixOptions, type FixReport, type PagePlan } from './fix.js';

/** The tool and its version, as a derivation's `encoder`: bumped whenever a reading copy would come out differently. */
export const PDF_FIX_ENCODER = 'pdf-fix@1';
