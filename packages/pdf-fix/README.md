# @rebbehub/pdf-fix

A scan's **reading copy**: each page turned level, its text moved to the
middle with even margins and the same enlargement on every page, and cut
to the text, which drops the scanner's black edges. The scan itself is
never touched. Each page's content is wrapped in one transform and one
clip (`q … cm … re W n … cm <the page as it was> Q`), so the copy is
lossless and the same size (+~1 KB).

1. **Measure** (`analyze.ts`, `render.ts`): pdf.js draws each page in grey
   at 90 dpi. Ink is what is clearly darker than the paper around it (per
   32 px block). The scanner's own marks are set aside: anything touching
   the image's edge, long thin lines, large dark areas. The tilt is the
   angle whose row profile is sharpest (0.1° steps over ±5°, then 0.02°).
   The text box is taken from the letters' corners once turned; dust
   counts only near the letters.
2. **Lay out** (`fix.ts`): one enlargement for the whole file (the median
   fit of its fuller half of pages, at most ×1.6), each box centred across
   with its top at a 5% margin.
3. **Check** (`checkFixed`): the copy is drawn and measured again; every
   changed page must be level within 0.3° with its text on the page.

Each page's plan carries its `transform` - the PDF matrix from the
original page to the copy - so a line found on the original (OCR, search
hits) is drawn in the right place on the copy. `PDF_FIX_ENCODER`
(`pdf-fix@1`) goes up whenever a copy would come out differently.

Used by `rebbehub reading-copies` (services/jobs); see docs/operations.md.
