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
- `GET /v1/mirrors`, `/v1/editions`, `/v1/editions/<tag>/manifest.json`,
  `/v1/editions/<tag>/SHA256SUMS`, `/dumps/<tag>/<name>`: the git mirror,
  every catalog edition's dumps with their sha256, and the keys they are
  signed with ([mirrors](mirrors.md)).
- `/manifests/iiif/<scan>.json`: a served scan as a IIIF Presentation 3
  manifest (right to left, page images, the PDF as its rendering, the
  credit as its required statement), for any IIIF viewer.
- `GET /v1/scans/<id>/pages`: a scan's pages, with their page images and
  thumbnails.
- `GET /v1/files/<sha256>/similar`: other files that look like this one
  (the same pages, or the same recording), a machine guess.

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

## Translations

A unit's translation is a text of its own (`kind: translation`) with its
`language`, `credit` and `licence` (none: the translator's own, CC BY-SA).
`POST /v1/units/<id>/translations` with `{ language, credit, licence?,
translationOf?, content, machine? }` sends one for review, a blank line
between paragraphs; `machine` names the tool when a machine made it, and
its paragraphs are marked so until a person checks each.
`POST /v1/translations/fix` with `{ segment, content }` suggests a fix to
one paragraph. Only licences that let RebbeHub keep a copy are taken
(public domain, CC0, CC BY, CC BY-NC); see [rights](rights.md).

## Where you stopped

`GET /v1/places`, `PUT /v1/places`, `DELETE /v1/places?kind=&key=`: where
the signed-in person stopped reading (a PDF's page) and listening (a
farbrengen's part and moment), the latest 60, so every device reopens
there. Personal: never cached, never exported.

## Adding

With a signed-in session:

- `POST /v1/uploads/check` (`{ sha256, pageHashes?, work?, publication? }`):
  before an upload, whether RebbeHub has the file or one like it, and
  whether it looks like another scan of a printing, a new printing or a
  new teshura.
- `POST /v1/suggestions/contents-map`: *Map pages*, what pages of a
  publication hold, as a suggestion.
- `POST /v1/teshuros/<id>/family-request` (no account, captcha as for
  reports): a family asks that a teshura stop being shown
  ([rights](rights.md)).

## People and conversations

It works the way GitHub works. Suggestions are pull requests and Reports
are issues, numbered together (`#12` is one or the other, never both;
`GET /v1/threads/12` says which). Imports are not conversations and have
no number. Reading needs no account (private issues aside); writing
needs a signed-in session. People are named by their handle
([accounts](accounts.md#handles-and-mentions)).

**People**

- `GET /v1/people?q=men&thread=changeset:<id>`: people to @mention,
  those already in the conversation first.
- `GET /v1/people/<handle>`: a person's public page (an old handle finds
  them too, with `movedFrom`).
- `GET /v1/threads?q=`: suggestions and issues to #mention, by number or
  words.

**Suggestions**

- `GET /v1/suggestions?state=open|closed|all&author=&reviewer=&q=`:
  the list, with each one's number, reviewers, approvals, comments and
  the issues it closes, and the open and closed counts. Without `state`
  the older list (`status=`) answers as before.
- `GET /v1/suggestions/<id>/conversation`: the timeline in order
  (comments, reviews, and events: sent for review, review requested,
  renamed, referenced from elsewhere, merged, withdrawn, reverted), who
  is asked to review, and the issues it closes.
- `POST /v1/suggestions/<id>/reviews`:
  `{ verdict: "approve" | "request_changes" | "comment", body?, comments?: [{ entity, field, body }] }`,
  a whole review in one: Approve merges it (as `/approve` does), Request
  changes sends it back (as `/send-back` does), and the comments on
  fields are kept with the review.
- `POST /v1/suggestions/<id>/comments`: `{ body, parent?, anchor?: { entity, field } }`.
- `POST /v1/suggestions/<id>/review-requests` `{ reviewers: [handle] }`
  (asking someone who reviewed asks again),
  `DELETE /v1/suggestions/<id>/review-requests/<handle>`.
- `PATCH /v1/suggestions/<id>` `{ title?, description? }`. `Fixes #12`
  (or `closes`, `resolves`, `סוגר`, `מתקן`…) in the description links
  issue 12; merging the suggestion closes it.

When a suggestion is sent for review, the keepers of the sets it touches
are asked to review it on their own (as CODEOWNERS are), except for a
bot's suggestions. When it comes back after changes were requested,
those who requested them are asked again.

**Issues**

- `GET /v1/issues?state=&label=&type=&set=&entity=&assignee=&author=&q=`:
  newest first, with the open and closed counts; `assignee=none` for
  those nobody has taken.
- `GET /v1/issues/templates`: the kinds of issue and the words each
  starts with.
- `POST /v1/issues` `{ title, body?, type, entityId?, labels? }`.
- `GET /v1/issues/<number>`: the issue, its timeline, the suggestions
  that close it, and `rights`: what the reader may do.
- `PATCH /v1/issues/<number>` `{ title?, body? }`,
  `POST …/state` `{ state: "open" | "completed" | "not_planned", note? }`,
  `PUT …/labels` `{ labels }`, `PUT …/assignees` `{ assignees }`,
  `POST …/visibility` `{ private }`, `POST …/comments` `{ body, parent? }`.
- `GET /v1/labels`; stewards make them with `POST /v1/labels`.

Issues are public, as on GitHub, except those about rights or offensive
content, which only stewards, the set's keepers, the reporter and those
assigned may read. Every report sent before issues existed stays private.
`POST /v1/reports` (no account) still works and now takes a `title` too;
it answers with the new issue's `number`.

**Comments and the inbox**

- `PATCH /v1/comments/<id>` `{ body }` (its writer);
  `POST /v1/comments/<id>/resolve` `{ resolved }` (a comment on a field).
- `GET /v1/inbox?filter=unread|all|mention|review_requested|assigned|…`,
  `GET /v1/inbox/count`, `POST /v1/inbox/read`
  `{ ids? | subject?: { kind, id } | all?, unread? }`.
- `POST /v1/follows` takes `{ kind: "report", id }` for an issue.

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
