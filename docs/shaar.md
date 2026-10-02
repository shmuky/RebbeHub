# The shaar: a sefer's README

A repository on GitHub has a README; a sefer in RebbeHub has a **shaar**.
It is one file per sefer, written the same way for every sefer, that the
catalog reads, checks and shows. Where a README says what a project is
and how it is laid out, a shaar says what a sefer is: its name and its
title page, who wrote it, what it is about, how it is built, its
printings and where its texts come from.

Every text-based sefer has one (a shelf of recordings does not). A sefer
no person has written one for shows the one the catalog makes from what
it knows, marked as made by the catalog until a person reads it.

## The file

```
---
shaar: 1
title: תניא
title-en: Tanya
subtitle: ליקוטי אמרים
subtitle-en: Likkutei Amarim
by: rh-7k2m9q4d (אדמו"ר הזקן)
by-line: מאת כ"ק אדמו"ר הזקן
genre: chassidus
---

## על הספר | About

The written Torah of Chabad Chassidus.

## סדר הספר | Structure

הספר מחולק לחלקים, וכל חלק לפרקים.

## הדפסות | Printings

- 5557, Slavita: the first printing.
- 5574, Shklov.

## מקורות | Sources

The text is Sefaria's: https://www.sefaria.org/Tanya

## הערות | Notes

Anything else a reader should know.
```

### The header

Between two lines of three dashes, one field a line: its name, a colon,
its value. The fields, in the order the catalog writes them:

| Field | Holds | Kept as |
| --- | --- | --- |
| `shaar` | The version of these rules: `1`. Needed. | - |
| `title` | The sefer's name in Hebrew. Needed. | the work's `title.he` |
| `title-en` | Its name in English. | `title.en` |
| `subtitle`, `subtitle-en` | The title page's second line. | `shaar.subtitle` |
| `by` | An author, by his id (`rh-…`); one line for each. His name may follow in brackets, for the reader: the id is what counts. | the work's `authors` |
| `by-line`, `by-line-en` | The author as the title page names him. | `shaar.byLine` |
| `genre` | The kind of sefer: `chassidus`, `maamarim`, `sichos`, `igros`, `halacha`, `siddur`, `minhagim`, `history`, `diaries`. Needed. | the work's `genre` |

An English field needs its Hebrew one. A field is given once, except
`by`. A field the rules do not have is refused, as is a field without a
value (leave the line out instead). Values are one line, up to 500
characters.

The header's fields are the sefer's own: changing `title` in the shaar
renames the sefer, and changing `by` changes its authors. So the shaar
and the catalog never disagree.

### The sections

After the header, the sections, each under its heading: two hashes, a
space, and its name in Hebrew or English or both (`## על הספר`,
`## About`, `## על הספר | About`):

| Section | Says |
| --- | --- |
| `על הספר` / About | What the sefer is. |
| `סדר הספר` / Structure | How it is built: volumes, parts, sichos. |
| `הדפסות` / Printings | Its printings and their story. The printings themselves are listed on the sefer's page from the catalog. |
| `מקורות` / Sources | Where its texts and scans come from. |
| `הערות` / Notes | Anything else. |

Every section may be left out; each may appear once. The catalog writes
them in this order whatever order they came in. Words come under a
heading, never before the first one, and nothing else starts with `#`.

A section's words are plain: paragraphs split by an empty line, and
lines that start with `- ` as a list. A web address (`https://…`) and an
item's id (`rh-…`) become links. There is no other markup: nothing in a
shaar is drawn as HTML. A section holds up to 20,000 characters.

## How the catalog reads it

`readShaar` (`packages/model/src/shaar.ts`) reads a file strictly: it
gives the fields when every line is right, and otherwise every line that
is not and why, in Hebrew and English. A shaar the catalog cannot read is
never taken, so every shaar in the catalog is one it can read, and
`writeShaar` writes every one the same way.

The file is not kept as text. Its header is the work's own fields and
`shaar` on the work (`subtitle`, `byLine`, `sections`, and `origin` for
one the catalog made), checked by the work's schema (built-in schemas
version 11), diffed field by field in review, like every other item.

## Where it is

- **On the sefer's page**, under its contents, as a README is under a
  repository's files; its subtitle and by-line on the title page drawn
  at the top. It costs the page nothing: the shaar is part of the sefer.
- **`/shaar/<id>`** on the site: the file as it is written, and, signed
  in, the file to edit, read as it is typed so every line the catalog
  cannot read is named before it is sent. It goes for review as a
  Suggestion of its own.
- **The API**: `GET /v1/entities/<id>/shaar` (`?format=text` for the
  file itself), and `POST /v1/suggestions/shaar` with the whole file
  (`before`: the file as it was opened, so a change made since is never
  overwritten).
- **The MCP server**: `get_shaar` and `suggest_shaar`.
- **The git mirror**: `shaars/<shard>/<id>.md`.

## A shaar made from the catalog

`rebbehub shaars` (and **Actions → Upkeep → shaars**) gives every sefer
that has no shaar the one the catalog makes from its data: its
description under About, and how it is divided under Structure (from its
levels: `הספר מחולק לכרכים, וכל כרך לשיחות.`). It is kept with
`origin: { by: 'catalog', checked: false }` and shown as made by the
catalog. A person who opens it, reads it, and sends it on (changed or
not) makes it theirs. The job works in system changes of `--chunk`
sefarim, can be stopped and run again, and `--dry-run` only counts.
