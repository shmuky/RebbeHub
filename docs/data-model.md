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
| `work` | a sefer or a series | `title`, `slug`, `authors`, `genre`, `levels` (`['volume','sicha']`) |
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
