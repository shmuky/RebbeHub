# The API for developers

`https://api.rebbehub.org` serves the whole catalog, read without an
account; `/openapi.json` lists every route. What changes the catalog
needs a signed-in session, from the site's own pages.

## Reading

- `GET /v1/entities/<id>`, `/v1/resolve?path=…`, `/v1/search?q=…`,
  `/v1/events?within=5742`: items, by id, path, words or date.
- `GET /v1/entities/<id>/history`: every version, who made it and what
  changed.
- `GET /v1/commits?since=<seq>`: every merge after `seq`, in order: the
  way to follow the catalog without webhooks.
- `GET /v1/missing?kind=recordings|texts|scans`, `/v1/projects`.
- `GET /v1/scans/<id>/text?page=<n>`, `/v1/recordings/<id>/transcript`:
  a scan's text and a recording's transcript, machine lines marked until
  people check them. A scan's page gives each line's proofread level (0,
  1, 2) and the scan's text layers; a transcript gives each paragraph's
  sync, word by word where it has word timings, and whether a person
  locked or checked it.
- `GET /v1/scans/<id>/progress`: how far each page is proofread.
- `GET /v1/recordings/<id>/hanacha`: the farbrengen's hanacha, paragraph
  by paragraph with where each is heard in the recording.
- `GET /v1/units/<id>/printings`, `/v1/compare?a=…&b=…`: the printings of
  a sicha or letter whose text the catalog has (`text:<id>`, or
  `scan:<id>:<from>-<to>` for pages of a scan), and two of them compared
  word by word, the Hebrew way.
- `GET /v1/projects/<slug>`: a project, its progress and what is left;
  signed in, `POST /v1/projects/<slug>/next` hands out the next item
  nobody holds.
- Signed in: `POST /v1/scans/<id>/ocr` (your own OCR: hOCR, ALTO, or
  plain text with form feeds between pages), `/v1/scans/<id>/text/confirm`
  ("this page is right"), `/v1/recordings/<id>/sync/anchor` ("the Rebbe is
  saying this line now", with the moment in milliseconds) and
  `/v1/recordings/<id>/sync/confirm`. Each is a suggestion, reviewed.
- `GET /v1/files/<sha256>`: a file's size, rights and address, what was
  made from it (a scan's reading copy) and its page fix.
- `GET /v1/page-fixes/drive/<Drive id>`: what a PDF on Google Drive needs
  to read straight - the pages to turn, each a PDF matrix (and, for a
  reading copy's placing, the box to cut to) - or the reading copy to open
  instead ([operations](operations.md)).
- `/objects/<sha256>`: a file's bytes, while its rights let it be served.
- `/manifests/<name>/<name>.json`: the published manifests of reading
  copies and page fixes.

## Webhooks

On `/account` (*For developers: webhooks*), or `POST /v1/webhooks` with
`{ "url": "https://…" }`, a signed-in person registers up to five
addresses. Every merge from then on is posted to each, in order and at
least once, every few minutes:

```http
POST <your address>
Content-Type: application/json
X-RebbeHub-Signature: sha256=<HMAC-SHA256 of the body, keyed with the hook's secret>

{ "commits": [ { "seq": 9, "at": "…", "message": "…", "author": "…", "mergedBy": "…",
                 "changes": [ { "id": "rh-…", "type": "event", "path": "/events/…", "rev": 22993, "data": { … } } ] } ] }
```

The secret is shown once, when the address is added. Answer with a 2xx
status; anything else is tried again, and after 20 failures in a row the
hook is switched off. Words withheld for rights are left out, as in
`/v1/commits`.

## Embeds

Every sefer, sicha, farbrengen and set can be shown on another site
(*Embed on another site*, at the foot of its page):

```html
<iframe src="https://rebbehub.org/embed/rh-…" width="100%" height="320" style="border:0" loading="lazy" title="RebbeHub"></iframe>
```

A farbrengen's recordings play in place. `/embed/…` is the only page
other sites may frame; every other page refuses (`frame-ancestors 'self'`).
