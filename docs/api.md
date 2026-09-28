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
- `/objects/<sha256>`: a file's bytes, while its rights let it be served.

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
