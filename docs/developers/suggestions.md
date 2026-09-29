# Sending suggestions

Nothing in the catalog changes without a **suggestion**, from the site or
from the API alike. A suggestion is one or more items' new versions, with
a title and a note on why. It runs the automatic checks (the item's
schema, its references, its dates, duplicates), then waits for the
**keepers** of the item's sets to **approve** it or **send it back** with a
note; every version stays in the history, and any merge can be undone.
In an *open* set, a trusted person's line fixes go live at once and are
reviewed after ([governance](https://github.com/shmuky/RebbeHub/blob/main/GOVERNANCE.md)).

All of this needs a [token](auth.md) with the `write` scope.

## A fix to one item

Send the item's whole new `data` (read it first; change what is wrong):

```sh
curl -X POST https://api.rebbehub.org/v1/suggestions/quick \
  -H "Authorization: Bearer $REBBEHUB_TOKEN" -H 'Content-Type: application/json' \
  -d '{ "entityId": "rh-7k2m9q4d", "title": "Fix the date", "note": "As printed in Sichos Kodesh 5742, vol. 2, p. 45",
        "data": { "kind": "farbrengen", "date": "5742-05-10", "title": { "he": "יו״ד שבט תשמ״ב" } } }'
```

```ts
const item = await rh.getItem({ id: 'rh-7k2m9q4d' });
const suggestion = await rh.suggestFix({
  body: { entityId: item.id, data: { ...item.data, date: '5742-05-10' }, title: 'Fix the date', note: 'As printed in Sichos Kodesh 5742, vol. 2, p. 45' },
});
// { id: 812, status: 'open', checks: [...] }  - waiting for review at https://rebbehub.org/review?s=812
```

Say where it comes from in `note`: the keepers read it.

## Several items at once

```ts
const draft = await rh.createSuggestion({ body: { title: 'Add the recordings of 10 Shevat 5742' } });
await rh.putSuggestionItem({ id: draft.id, body: { type: 'recording', data: { event, part: 1, title: { he: 'חלק א' }, url } } });
await rh.putSuggestionItem({ id: draft.id, body: { type: 'recording', data: { event, part: 2, title: { he: 'חלק ב' }, url: url2 } } });
const sent = await rh.submitSuggestion({ id: draft.id });
```

`putSuggestionItem` without an `id` makes a new item (its id comes back);
`data: null` deletes one. Items are checked against their type's JSON
Schema (`GET /v1/types`); a failing check is in `checks`, and the keepers
see it.

## Words: lines, paragraphs, sync

- `POST /v1/scans/<id>/text/fix` `{ page, line, text }`: one line of a
  scan's text.
- `POST /v1/scans/<id>/text/confirm` `{ page, fixes? }`: "this page is
  right" (proofread once; twice by someone else).
- `POST /v1/scans/<id>/ocr`: your own OCR of a scan (hOCR, ALTO or plain
  text), as a layer of its own.
- `POST /v1/recordings/<id>/transcript/fix` `{ segment, content }`,
  `/sync/anchor` `{ segment, atMs }`, `/sync/confirm`.
- `POST /v1/units/<id>/translations`, `/v1/translations/fix`.

## After

- `GET /v1/suggestions?author=<your id>&status=open`, and
  `GET /v1/suggestions/<id>` for the review view (before and after, the
  checks, the reviewer's notes).
- `POST /v1/suggestions/<id>/withdraw` to take it back.
- Follow it (`POST /v1/follows { kind: 'changeset', id }`) to be told by
  email when it is decided, if you asked for email updates.
- Comment on an item's talk page: `POST /v1/entities/<id>/talk { body }`.

## Being careful

- Change what you know is wrong, and say how you know. A bot or an agent
  should say so in its token's name and in its notes.
- Never send words you may not copy: see [rights](../rights.md). Machine
  output you send (your own OCR, a machine translation) must say so
  (`engine`, `machine`), and is marked until people check it.
- Big imports are importers, not suggestions by hand: talk to the
  stewards first ([CONTRIBUTING](https://github.com/shmuky/RebbeHub/blob/main/CONTRIBUTING.md)).
