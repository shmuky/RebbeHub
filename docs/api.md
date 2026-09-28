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
  people check them.
- `GET /v1/files/<sha256>`: a file's size, rights and address, what was
  made from it (a scan's reading copy) and its page fix.
- `GET /v1/page-fixes/drive/<Drive id>`: what a PDF on Google Drive needs
  to read straight - the pages to turn, each a PDF matrix (and, for a
  reading copy's placing, the box to cut to) - or the reading copy to open
  instead ([operations](operations.md)).
- `/objects/<sha256>`: a file's bytes, while its rights let it be served.
- `/manifests/<name>/<name>.json`: the published manifests of reading
  copies and page fixes.
- `GET /v1/search/moments?q=…`: where the words are inside the texts: a
  line on a scan's page (open `/text/<scan>?page=<n>&line=<line>`) or a
  paragraph of a text or transcript, with `startMs`, when it is heard.
  `machine: true` until a person has checked it.
- `GET /v1/search/similar?q=…&types=unit,event`: search by meaning.
  `available: false` until it is set up; every result is the machine's
  choice, and says so (`machine: true`), with its `score`.
- `GET /v1/entities/<id>/relations`: an item's links both ways (cites,
  printed in, based on, cited by), each `machine: true` while a machine
  found it and no person has checked it.
- `GET /v1/health`: coverage per year and set, pages nobody has checked,
  recordings not synced, links that do not answer, the oldest open
  suggestions.

## OAI-PMH for libraries

`https://api.rebbehub.org/oai` speaks OAI-PMH 2.0 (when switched on,
[deploy](deploy.md)): sefarim, sichos, farbrengens, printings and
recordings as Dublin Core (`oai_dc`), harvested by the commit that last
changed them (`from`, `until`), by kind (`set=type:unit`) or by set
(`set=set:rh-…`), a hundred at a time with a resumption token. Deleted
items are reported as deleted (`deletedRecord: persistent`); identifiers
are `oai:rebbehub.org:rh-…`. Records are CC0.

```
/oai?verb=Identify
/oai?verb=ListRecords&metadataPrefix=oai_dc&from=2026-09-01
/oai?verb=GetRecord&metadataPrefix=oai_dc&identifier=oai:rebbehub.org:rh-…
```

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
