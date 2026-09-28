# Version control for the catalog

Section 6 of [the plan](plans/rebbehub.md) as built: GitHub's model, over
Postgres, in words non-technical people understand. Code:
`packages/db/src/migrations/0001_catalog.ts` (tables) and
`packages/core/src/catalog.ts` (behaviour).

## The pieces

| GitHub | RebbeHub | Table |
| --- | --- | --- |
| a file's versions | an item's **revisions** - append-only, never changed in place | `entity`, `revision` |
| a pull request | a **suggestion** - revisions proposed together | `changeset` |
| a merge commit on `main` | a **commit** - main is one straight line of them | `commit`, `commit_change` |
| a branch | a **project** - an overlay of revisions on top of main | `project`, `project_head` |
| a review | **Approve** / **Send back** | `review` |
| an issue | a **report** | `report` |
| a tag / release | a **catalog edition** (`2026.40`) | `catalog_edition` |
| watch | **follow** | `follow` |

`entity.main_rev` points at each item's current revision. Each commit lists
what it changed in `commit_change` (the new revision and the one before),
so "the catalog as of commit N" is, per item, its last change at or before
N, and history is a simple query.

## A suggestion's life

1. **Draft** - `createChangeset`, then `putRevision` for each item changed
   (`data: null` deletes). Each revision records the version it was made
   from.
2. **Send for review** - `submit` runs the automatic checks and stores
   them for the reviewer: fields against the type's schema; every link
   points at an item that exists and is of the right type; every date is a
   real Hebrew date; the path is free; a likely duplicate (same external
   id); made by a bot. Failed schema, link, date or path checks block the
   merge; the others are advice.
3. **Review** - `review` shows each item before and after, field by field,
   and anything that clashes with main as it is now.
4. **Approve** - `merge`, by a keeper of every set the suggestion touches or
   a steward; never by its author (stewards excepted) and never by a bot.
   Or **Send back** with a note; the author edits and sends it again.

Trusted contributors' line fixes (`text-page`, `segment`,
`alignment-span`) in *open* sets skip step 4: they merge at once, marked
`post_review: pending`, and a keeper approves or reverts them after.

## Merging

Main may have moved on since a suggestion was written. The merge is
three-way - the version it was made from, main now, and the suggestion:

- different fields merge silently; nested fields (`title.en` and
  `title.he`) merge one by one;
- lists of ids (`sets`, `authors`) merge as sets;
- lists of items with their own `id` (a page's `lines`) merge item by
  item, so two people fixing different lines of one page never clash;
- a real clash - the same field changed two ways - is a choice for the
  reviewer (`{ "/date": { "take": "theirs" } }`), never sent back to the
  contributor.

Merges take a lock, so main stays a single line.

## Undo

- **Revert** undoes a merged suggestion in one step: a new suggestion that
  puts each item back, merged three-way so later unrelated changes stay.
  Reverting a creation deletes the item.
- **Restore** suggests putting an item back as it was at any revision.

## Projects

A keeper opens a project ("Proofread Igros vol. 14"). Suggestions made in
it merge into the project's overlay, not main; reading an item "in the
project" shows its overlay version over main. When the work is done,
`mergeProject` lands all of it on main as one commit, merging each item
three-way against main as it is by then - which is how a project is kept
"rebased" without anyone rebasing.

## Bots

Importers are accounts marked as bots. Their changes are suggestions like
anyone's, and when a source changes they merge against what the bot said
last time, so a field a person fixed stays fixed.

## Exports

After every merge the git mirror gets one git commit, authored as the
suggestion's author and dated when it merged (`rebbehub mirror --git`); see
[operations](operations.md).
