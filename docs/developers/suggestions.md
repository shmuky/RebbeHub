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

## Organizing the catalog

Moving, renaming, ordering, merging and splitting are plans of operations,
done in order, each seeing what the ones before it did. A plan becomes
**one** suggestion, however many items it touches.

```ts
// See where things are: the top sets, or one set or sefer, with counts.
const tree = await rh.catalogTree({ root: otzros, depth: 1 });

const plan = {
  operations: [
    { op: 'create-set', key: 'ls', name: { he: 'לקוטי שיחות', en: 'Likkutei Sichos' }, slug: 'likkutei-sichos-set', parent: sichos },
    { op: 'move', items: [volume12, volume13], from: otzros, to: 'new:ls' },
    { op: 'merge', from: otzrosCopy, into: likkuteiSichos },
    { op: 'rename', item: likkuteiSichos, name: { en: 'Likkutei Sichos' }, slug: 'likkutei-sichos' },
  ],
  description: 'Sorting the Otzros books into the sefarim we have',
};
const preview = await rh.previewOrganize({ body: plan }); // item by item, before and after; saves nothing
const made = await rh.organize({ body: plan });            // { suggestion, merged, mayApprove, preview }
```

| Operation | Does |
| --- | --- |
| `move { items, to, from?, mode?, position? }` | into a set (with `from`, leaving it; `mode: "only"` makes it the one set); `to: null` with `from` takes it out; a set under a set, or to the top (`to: null`); a unit to another work, a printing to a work, a scan to a printing, a recording to an event |
| `move-up { items, from? }` | a set to its parent's parent; an item out of a set into that set's parent |
| `rename { item, name?, slug?, path? }` | new names; a new slug or path moves the paths made from it (a sefer's units) along |
| `reorder { items, parent?, position? }` | the items take their own places in the order given; with `position` (`"start"`, `"end"`, `{ after }`, `{ before }`) they go there together |
| `create-set { key?, name, slug, parent?, items? }` | a new set at `/sets/<slug>`, kept like its parent; later operations name it `new:<key>` |
| `delete-set { item }` | a set that holds nothing; its path leads to its parent |
| `merge { from, into }` | everything under or pointing at `from` moves to `into`, lists are joined, `from` is deleted and its paths lead to `into` |
| `split { work, units? \| range, title, slug }` | some of a sefer's units into a new sefer beside it |

Ordering uses fractional keys (`order`), so only the items whose place
changes are changed. A set never goes under its own descendant, and an
item moves only into the kind of parent it has. Every old path redirects
once the suggestion is approved, and `GET /v1/entities/<id>` of a merged
item answers 404 with `detail.mergedInto`. `apply: true` approves it at
once when you may approve your own (stewards); otherwise the keepers of
the sets it touches review it, and stewards review changes to sets.

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
