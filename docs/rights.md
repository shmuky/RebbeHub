# Rights

Rights are RebbeHub's biggest risk, so every file carries a rights state
and every export passes a gate. Code: `packages/model/src/rights.ts`,
`packages/core/src/files.ts`, `packages/mirror/src/gate.ts`.

## States

| State | Served? | Bytes kept in |
| --- | --- | --- |
| `open` | yes | the public bucket |
| `credit` | yes, with its credit shown | the public bucket |
| `link` | no - RebbeHub points at the source | the preservation bucket if a copy was uploaded, else nowhere |
| `preserved` | no, until cleared | the preservation bucket |

## Where a file starts

The stricter of what its licence allows and what was decided for its
source - the same answers as Sichos-Kodesh's per-edition gate, whose four
decisions map one to one (`ship`→`open`, `ship-with-credit`→`credit`,
`link-only`→`link`, `local-only`→`preserved`):

- public domain, CC0, facts-and-links → `open`; CC BY and CC BY-NC (Sefaria) → `credit`;
- free-to-read, site terms, unknown → `link`; commercial → `preserved`;
- HebrewBooks and chabadlibrary.org → `link` whatever else is said;
- the Igros app's files → `preserved` (Sichos-Kodesh decides its own apps);
- hanachos and publisher scans → `link` (a copy preserved);
- the old typewritten Sichos Kodesh hanachos (5710-5741) → `open`: the
  chozrim wrote them under no organisation, the typewritten set was printed
  privately in 1985, and nobody holds rights in them (the re-typed edition
  published since 1998 is a publisher scan);
- teshuros, usually printed for free distribution → `credit`, with a fast
  path for families to ask for a takedown;
- anything in a *locked* set → `preserved`.

## Uploads

"Add a recording" (farbrengen pages) and "Add a scan" (sefer pages) take
a file with a rights statement, which sets its licence:

| The uploader says | Licence | Starts as |
| --- | --- | --- |
| I made this copy and give it freely | CC0 | `open` |
| Printed or recorded for free distribution | (teshura class) | `credit` |
| It is in the public domain | public domain | `open` |
| I am not sure | unknown | `link`, kept privately |

The bytes go to the public bucket only when the state may be served, and
otherwise to the preservation bucket, which the API writes and never
reads (`services/api/src/uploads.ts`). A file already known is not taken
twice: the uploader is shown where it is. The file joins the catalog
through a suggestion, reviewed like any other.

A new teshura ("Add a teshura" on the Teshuros set, or a scan the upload
check takes for one) is always a teshura scan: `credit`, credited to the
families ("משפחות כהן – לוי"), whatever rights statement comes with it.
Page images and thumbnails made from a scan are derivations and follow
its state.

## A family's request

Every teshura page has *A family's request*: no account, works without
JavaScript, captcha and rate limit as for reports. The teshura's served
scans (and their page images) move to `preserved` at once, as the
`system` actor in the audit log; a rights report and a
`family_request` row are kept for the stewards, who may restore the
state with `setRights` if the request was not from the family. Nothing
is deleted (`familyRequest` in `packages/core/src/print.ts`). Requests
about anything other than a teshura use the general report form.

## Changing it

Only stewards change a file's state (`setRights`), and every change is in
the audit log. A takedown moves a file to `preserved`: it stops being
served at once and is never deleted.

## Exports

The git mirror and the dumps carry catalog facts always, file hashes but
never files, and words only when their rights allow: a text copied from a
source keeps that source's licence (site-terms and commercial texts are
listed as withheld), community text is CC BY-SA, and OCR pages follow
their scan's file.
