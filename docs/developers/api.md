# Conventions

What every route of `https://api.rebbehub.org` shares. The
[OpenAPI document](https://api.rebbehub.org/openapi.json) describes each
route; a test in the repository fails when a route is not in it.

## Stability

- The API is **version 1**, under `/v1`. Within it, changes only
  **add**: new routes, new fields in answers, new optional parameters.
  Nothing is renamed or removed, and no field changes its meaning.
- Write clients that ignore fields they do not know.
- Should something in /v1 have to go, it is marked first: the route is
  `deprecated` in the OpenAPI document and answers with `Deprecation` and
  `Sunset` headers for at least six months, and the change is in the
  [changelog](https://github.com/shmuky/RebbeHub/blob/main/CHANGELOG.md).
  A change that cannot be made by adding becomes `/v2`, beside /v1.
- `GET /v1` says the API's version; `@rebbehub/client` says the version
  it was generated from (`API_VERSION`).
- Routes outside /v1 (`/objects`, `/dumps`, `/manifests`, `/oai`, `/mcp`)
  follow their own standards and keep their addresses.
- The site's own sign-in (`/v1/auth/*`) and the stewards' tools
  (`/v1/admin/*`) are listed in the OpenAPI document for completeness,
  but are the site's, not for other clients, and may change with it.

## Errors

Every error has one shape, with the HTTP status of its kind:

```json
{ "error": "not-found", "message": "rh-zzzzzzzz not found" }
```

| Status | `error` | When |
| --- | --- | --- |
| 400 | `bad-request` | a mistake in the request: an id that is not one, a missing field |
| 401 | `unauthorized` | not signed in, or a token that is unknown, revoked or expired |
| 403 | `forbidden` | not allowed: a read-only token, not a keeper of the set, a captcha not solved |
| 404 | `not-found` | not there, or withheld for its rights |
| 409 | `conflict`, `state` | a suggestion that clashes with main (`conflicts` lists the fields), or is not in a state for this |
| 422 | `invalid` | the catalog's checks refused it (`detail` says which) |
| 429 | `rate-limited` | too many requests: wait `Retry-After` seconds |
| 500 | `internal` | our mistake; please report it |

`message` is for people and may change; `error` is for programs and does
not.

## Pages

Lists that can be long come a page at a time, in a stable order:
`/v1/entities`, `/v1/entities/<id>/children`, `/v1/commits` and
`/v1/suggestions`. Each answer has `next`: pass it back as `cursor` for
the next page; it is `null` on the last. A `Link: <…>; rel="next"` header
says the same.

```sh
curl 'https://api.rebbehub.org/v1/entities?type=work&limit=100'
curl 'https://api.rebbehub.org/v1/entities?type=work&limit=100&cursor=c1.WyIvbGlra3V0ZWktc2ljaG9zcmgtN2sybTlxNGQiXQ'
```

Cursors are opaque: do not build or change them. They do not expire. A
list keeps its order while you page through it, so a new item appears in
the page it belongs to (or not, if that page is behind you).
`/v1/commits` also takes `since=<seq>`, to start after any commit.
Search (`/v1/search`) is ranked, not paged: ask for more with `limit`.

## Caching

- Every JSON answer to a GET has an `ETag`. Send it back as
  `If-None-Match` and an unchanged answer is `304 Not Modified`, with no
  body.
- Answers to anonymous requests are `Cache-Control: public, max-age=60,
  s-maxage=120, stale-while-revalidate=600`, and are kept at Cloudflare's
  edge that long (sums of the whole catalog - `/v1/stats`, `/v1/health`,
  `/v1/community`, `/v1/refcounts` - ten minutes; routes that never change
  say more: file bytes and dumps are immutable). So a change can take a
  couple of minutes to show to anonymous readers. The newest page of
  `/v1/commits` is kept only ten seconds: it and webhooks are the way to
  follow changes as they happen. Answers to
  signed-in requests are `private, no-cache` and never kept at the edge,
  and personal ones (`/v1/places`, `/v1/tokens`) `no-store`. `Vary:
  Authorization, Cookie` keeps them apart in shared caches.

## CORS

Any site's pages may call the API, with a token in `Authorization`:
answers carry `Access-Control-Allow-Origin: *`, and preflight requests are
answered for every method. Cookies are never allowed across sites.

## Ids, dates and languages

- Ids are `rh-` and Crockford base32, read forgivingly (`RH-7K2M-9Q4D`).
- Hebrew date keys: `5742`, `5742-05`, `5742-05-10`, `5741-06B-14`
  ([data model](../data-model.md), Dates).
- Names are `{ "he": "…", "en": "…" }`, Hebrew always there, English when
  known.

## Machine output

Anything a machine made says so until a person checks it: `origin: { by,
checked }` on items, `machine: true` on search moments, relations and the
reviewer's advice, `checked: false` on OCR lines and transcript
paragraphs. Show the label wherever you show the words.
