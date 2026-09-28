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
- teshuros, usually printed for free distribution → `credit`, with a fast
  path for families to ask for a takedown;
- anything in a *locked* set → `preserved`.

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
