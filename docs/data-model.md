# The data model

`@rebbehub/model` defines every kind of item, twice: as TypeScript types
(`packages/model/src/entities.ts`) for code, and as JSON Schema
(`packages/model/src/schemas/builtin.ts`) for the catalog, which checks
every suggestion against them. A test keeps the two in step.

## Kinds of item

**Content** - what was said or written

| Type | Is | Key fields |
| --- | --- | --- |
| `author` | a Rebbe, a chossid, an editor, a family, an institution | `name`, `kind`, `rebbe` (1-7), `slug` |
| `work` | a sefer or a series | `title`, `slug`, `authors`, `genre`, `levels` (`['volume','sicha']`), `cover` (`{ file, page }`: the title page a person chose) |
| `unit` | a sicha, maamar, letter, chapter, story, diary entry | `work`, `position` (one step per level), `order`, `label`, `date`, `events` |
| `event` | a farbrengen, yechidus, simcha, the writing of a letter | `kind`, `title`, `date`, `place`, `occasion` |

**Print** - what exists on paper and in files

| Type | Is | Key fields |
| --- | --- | --- |
| `publication` | a volume, kovetz, issue, booklet, teshura | `kind`, `title`, `work`, `publisher`, `date`, `printing`, `identifiers`, `simcha` |
| `scan` | one PDF of one publication | `publication`, `file` (sha256), `completeness`, `preferred`, `pageLabels` |
| `contents-map` | pages of a publication ↔ a unit | `publication`, `pages`, `unit` |

**Text** - the words, versioned in small pieces

| Type | Is | Key fields |
| --- | --- | --- |
| `text-layer` | the text of one scan: machine OCR, uploaded OCR, or community text | `scan`, `kind`, `engine` |
| `text-page` | one page of a layer, line by line with positions | `layer`, `page`, `lines[{id,text,box}]`, `proofread` |
| `text` | the text of a unit (or a recording's transcript) | `kind`, `unit`, `publication`, `language`, `licence` |
| `segment` | one paragraph of a text, with a permanent id | `text`, `order`, `kind`, `content`, `proofread` |

**Media**

| Type | Is | Key fields |
| --- | --- | --- |
| `recording` | audio of an event, plus video links elsewhere | `event`, `file` or `url`, `durationMs`, `part`, `videos` |
| `alignment` | a recording synced to a text | `recording`, `text`, `granularity` (word, paragraph) |
| `alignment-span` | where one segment is heard | `alignment`, `segment`, `startMs`, `endMs`, `words`, `locked` |

**Glue**: `relation` (based on, printed in, translation of, answer to,
cites, same recording as, reproduces), `person`, `place`, `topic`,
`source` (the registry of sources and their terms), `set` (what people
browse; keepers and policy), and `schema` (the kinds of item themselves).

Every catalog item may also carry `sets`, `externalIds` (the ids other
systems know it by), `sources` (provenance), `topics` and a `note`.
Anything a machine made carries `origin: { by, checked }`.

## A page's words

Every item is a page people read, and many carry their own words in
`body`: a letter, a chapter of a sefer, a farbrengen's outline. The words
are structure, never markup (`packages/model/src/pageText.ts`, checked by
the `pageText` schema):

```json
{
  "profile": "sefaria",
  "versions": [
    {
      "id": "he", "language": "he", "title": "Torat Emet", "credit": "Sefaria: Torat Emet",
      "licence": "cc-by-nc", "url": "https://www.sefaria.org/…",
      "segments": [
        { "id": "14", "kind": "section", "n": 14, "text": [{ "text": "פרק יד" }], "children": [
          { "id": "14.3", "kind": "verse", "n": 3,
            "text": [{ "text": "והנה", "marks": ["b"] }, { "text": " …" }, { "note": "n1" }, { "marker": "[כ:]" }] }
        ] }
      ],
      "notes": [{ "id": "n1", "kind": "note", "n": 1, "text": [{ "text": "…" }] }]
    },
    { "id": "en", "language": "en", "segments": [ … the same ids … ] }
  ]
}
```

- **Versions**: a page's languages and editions (a chapter's Hebrew and
  its English). The same place has the same segment id in every version,
  so versions stand side by side.
- **Segments** form a tree: `section` (a title, and the segments in it),
  `heading`, `paragraph`, `verse` (a numbered segment), `item` (an
  outline's line), `note` (a footnote, in the version's `notes`). Each has
  an `id` that stays put, `n` when the source numbers it, `end` for a line
  set to the end side (a letter's date and signature), and `origin` when a
  machine made it.
- **Words** are runs: `{ text, marks?, href? }` with only the marks `b`,
  `i`, `u`, `small`, `sup`, `sub`, and a link only to the web, a site path
  or an item id (`rh-…`, counted as a reference like any other);
  `{ note }` a footnote's marker; `{ marker }` a source's own marker (a
  page of the printed edition, a day of the study cycle); `{ br: true }`.
  Nothing in them is ever drawn as HTML.
- **Profile**: the display rules of where the words came from. `sefaria`:
  sections under their titles, numbered segments (in Hebrew letters in
  the Hebrew), footnotes, the Hebrew and English side by side or one at a
  time, each version's credit and licence. `sichos-kodesh`: the texts
  Sichos-Kodesh publishes, paragraphs and headings, versions one at a
  time. `chabad-library`: chabadlibrary.org's texts, paragraphs and
  headings like `sichos-kodesh`, its footnotes and haoros as notes, the
  printed edition's old page numbers as markers, and the credit line
  "ספריית ליובאוויטש" ("The Lubavitch Library") linking back to the page
  on chabadlibrary.org, as docs/rights.md requires. `outline`: a
  farbrengen's contents from the Mafteiach, numbered items under titles.
  `plain`: what people write here.
- `bodySource` records where the words were imported from, with the copy
  RebbeHub keeps and the rights that decide whether they are shown.

Because segments are keyed lists, a change is diffed and merged segment
by segment: the reviewer sees `Words › he › 14.3` before and after, and
two people fixing different segments never clash. On a page's Edit tab a
person clicks a segment, fixes it in place and sends it for review
(`POST /v1/suggestions/words`); every segment has an anchor, so
`/sefaria/…/14#s-14.3` links to one verse.

Bodies were a string of wiki markup until built-in schemas version 5.
`rebbehub convert-bodies` turns the catalog's over as reviewed system
changes (docs/operations.md); until it has run, the API reads any it
meets into structure on the way out, and a suggestion sent with one has
it read on the way in.

## Ids and paths

- **Ids** are permanent and opaque: `rh-7k2m9q4d` - Crockford base32, 40
  bits, never reused. Read forgivingly (`RH-7K2M-9Q4D` works). Importers
  derive ids from their source's own ids (`idFromSeed`), so importing twice
  never duplicates.
- **Paths** are readable and may change: `/likkutei-sichos/12/3`,
  `/events/5742-05-10`. An old path keeps working as a redirect. Nothing
  stores a path where it could store an id.

## Dates

A date key is how an item is filed by Hebrew date - `5742` (a year),
`5742-05` (Shevat 5742), `5742-05-10` (10 Shevat 5742), `5741-06B-14`
(Purim in a leap year). Months count from Tishrei, with a leap year's Adar
as `06A`/`06B` - the numbering Sichos-Kodesh's catalog uses, so keys match
across both. `@rebbehub/hebrew` validates them against the calendar, sorts
them, converts them to civil dates, and reads dates as people write them
(`יו"ד שבט תשכ"ב`, `10 Shvat 5722`).

## Order

Units and segments carry a fractional `order` key (base 62), so an item is
inserted between two others without renumbering anything.

## Schema as data

The built-in schemas are seeded into the catalog as `schema` items on its
first commit. From then on a schema is changed like any other item - by a
suggestion that a steward approves - so a new kind of item ("maaneh",
"manuscript page") is a schema change, not a code release.
