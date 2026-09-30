# Importers

Every importer is a bot: what it reads becomes Suggestions under its own
bot account, approved with `--approve-as <steward>` or left in the review
queue. Running one again changes only what its source changed, and never
overwrites what people have fixed: a field people changed since the bot
last said it stays theirs, an item people moved to a new path stays there,
and one people deleted (merged into another, say) is not made again. RebbeHub keeps no copy of
Sichos-Kodesh's content: each importer reads a Sichos-Kodesh checkout
(`--from`) or a folder made from one, at run time.

```sh
rebbehub import <importer> --from ../Sichos-Kodesh [--approve-as shmuly] [--dry-run]
```

`scripts/import-catalog.sh` runs them in order, and runs each optional
one only when what it reads is given. The **Import the catalog (manual)**
workflow crawls what it can first ([deploy](deploy.md)).

| Importer | Needs | Makes |
| --- | --- | --- |
| `sichos-kodesh-works` | the checkout | the works and their units |
| `likkutei-sichos` | the checkout | a page per Likkutei Sichos sicha the Chabad Library has not typed (vols 1–29), at `/likkutei-sichos/<volume>/<printed page>`, with its PDF and its Hebrew translation's; the words come later from OCR |
| `sichos-kodesh-occasions` | the checkout (`MAFTEIACH_DATA` optional) | farbrengens, recordings, hanachos |
| `otzros` | Drive, listed at run time | Otzros HaRebbe's library: a sefer per folder of PDFs, a page per PDF, and its folders as a tree of Sets |
| `hebrewbooks` | the checkout (`HEBREWBOOKS_SHELF` optional) | HebrewBooks' Chabad shelf, link-only |
| `chabadlibrary` | `CHABADLIBRARY_TREE` | a page per chapter of chabadlibrary.org, with its words where `crawl-library --texts` kept them (the `chabad-library` profile), credited to the library |
| `jem` | `JEM_DB` | JEM's recordings |
| `sefaria` | `SEFARIA_DATA` | Sefaria's Chabad books Sichos-Kodesh does not publish, and with `crawl-sefaria --daily` the texts of Chitas and the Rambam |
| `igros` | `IGROS_DATA` | the letters' dates |
| `archive` | `SK_ARCHIVE_DB` | Sichos-Kodesh's archive history, and the Missing board's Files lost |

## otzros

Lists Otzros HaRebbe's public Drive library of Lubavitch seforim (ספרי
ליובאוויטש) from Drive's folder views at run time; nothing is copied. Each
folder that holds PDFs becomes a sefer (`/otzros/<hash>`) and each PDF a
page of it, linked at the file's own Drive address, which the site's
reader opens through the API ([operations](operations.md#drive-links)).
The folder's trail is the sefer's description.

The library's folders are a first sorting, and come in as one: each folder
that holds other folders of PDFs becomes a Set (`/sets/otzros/<hash>`)
whose parent is the Set of the folder it is in, up to the library's own
Set (`/sets/otzros`); each sefer joins the Set of the folder it is in, as
well as its genre's and the library's. So the library can be browsed as
Drive has it, and sorted from there into the catalog's own sefarim with
the organize and merge tools. A run adds the Sets to sefarim already
imported without moving them. Where people have sorted since - a sefer
moved into other Sets (its `sets` are then kept whole, as people left
them), a Set put under another, a sefer or page given a new path, a
duplicate page deleted - running it again leaves it so.

## hebrewbooks

Reads the Chabad shelf Sichos-Kodesh's `packages/hebrewbooks-index` made
from the Otzaria catalog (`apps/mobile/src/catalog/data/works/shelf.json`
in the checkout). `HEBREWBOOKS_SHELF` names a fresher one; the workflow
reads it from the latest Otzaria release. Each scan becomes a publication
with its HebrewBooks id, place and year printed, and a link to
hebrewbooks.org. The importer copies nothing: HebrewBooks is link-only
([rights](rights.md)); `rebbehub covers` later keeps a private copy of a
scan it draws a sefer's cover from ([operations](operations.md#covers-from-the-shaar)). A series Sichos-Kodesh places in a work joins that
work; the rest become works of their own, in the HebrewBooks Set.

## chabadlibrary

Reads the contents `crawl-library` crawled from chabadlibrary.org
(`CHABADLIBRARY_TREE`) and makes a page for every chapter, letter and
sicha of the works Sichos-Kodesh's registry places there. Where
`crawl-library --texts` kept a page's text, its words go on the page in
the `chabad-library` profile ([data model](data-model.md)). The library
writes its own marks in square brackets, read for what they mean:
`[ftnref_…]` a footnote's marker and `[ftn_…]` where that note begins
(in the text or its haoros, which all become the page's notes),
`[cup]` and `[dibur_maschil]` opening words in bold, `[mafteach_gopage …]`
an index's page reference, `[oldpage_…]` where a page of the printed
edition begins (a marker), and links to the web kept as links. Every page
carries the credit line "ספריית ליובאוויטש" linking back to its page on
chabadlibrary.org, the condition its words are shown on
([rights](rights.md)). A text kept in an older form is read again on the
next `--texts` crawl.

## jem

Reads a crawl of JEM's catalog by Sichos-Kodesh's `packages/jem-index`:

```sh
cd ../Sichos-Kodesh/packages/jem-index && npx tsx bin/crawl.ts --db ../../../jem.db
JEM_DB=../jem.db rebbehub import jem --from ../Sichos-Kodesh --approve-as shmuly
```

Run it after `sichos-kodesh-occasions`. A JEM event that is a farbrengen
already imported (the same file, or the same day with as many farbrengens
on each side) gets only the recordings it lacks, added as further parts.
Every other event becomes a JEM event of its own, in the JEM Set. Each
recording links to JEM's player on Ashreinu, and plays through
Sichos-Kodesh's media proxy. jem-index keeps no video links yet, so none
are imported.

## sefaria

Two steps. `crawl-sefaria` reads Sefaria's table of contents, leaves out
every book Sichos-Kodesh already publishes (and its " on …" companions),
and writes each chapter's texts to `<out>/texts/<sha256>.html` with a
`crawl.json` listing them. It asks politely (a pause between requests)
and keeps every answer in `--cache`, so a second run asks nothing twice.

```sh
rebbehub crawl-sefaria --from ../Sichos-Kodesh --out ../sefaria --cache ../sefaria-cache [--only "Book Title"] [--daily]
SEFARIA_DATA=../sefaria rebbehub import sefaria --from ../Sichos-Kodesh --approve-as shmuly
```

With `--daily` (or `SEFARIA_DAILY=1`), as the catalog import runs it,
the crawl also reads the texts of the daily learning, Chitas and the
Rambam, into a Set of their own, "חת״ת ורמב״ם / Chitas and Rambam"
(`/sets/chitas-rambam`), not the Chabad books' Set or a Chabad kind's:

| Books | Work paths | Hebrew version asked for |
| --- | --- | --- |
| Genesis … Deuteronomy | `/chumash/genesis` … | Tanach with Ta'amei Hamikra (public domain) |
| Rashi on each | `/chumash/rashi-genesis` … | Rosenbaum and Silbermann, 1929-1934 (public domain; its English too) |
| Psalms | `/tehillim` | Tanach with Ta'amei Hamikra |
| Every book of the Mishneh Torah, with its introduction and list of the mitzvos | `/rambam/<book>` (`/rambam/kings-and-wars`) | Torat Emet 363 (public domain) |
| Sefer HaMitzvot | `/sefer-hamitzvos` | Sefer HaMitzvot, Warsaw 1883 (public domain) |

The crawl reads each book's versions from Sefaria
(`/api/texts/versions/<title>`) and asks for the first of these that
Sefaria has under a licence that lets its words be kept, else the most
prominent Hebrew version that may be kept; Sefaria's first Hebrew
Tanach, "Miqra according to the Masorah", is CC BY-SA and would be only
a link. The English is Sefaria's primary one, kept when its licence lets
it be (the JPS Tanakh and Touger's Mishneh Torah are CC BY-NC). Their
keys are their own (`sefaria-daily-work:Genesis`,
`sefaria-daily-unit:Genesis/1`). A unit is a chapter, its verses
numbered as Sefaria numbers them, so a link to verse 5 is `#s-5`. Rashi,
three levels deep, has a section for each verse with comments, whose id
is the verse (`5`), and each comment under it (`5.1`, `5.2`); a verse
without comments has none.

Only a text whose licence lets it be kept (CC BY-NC, CC BY, CC0, public
domain) is written; any other is a link to Sefaria. Each chapter's page
carries its version, licence and a link back, and the item credits
Sefaria (`Sefaria: <version>`), as CC BY-NC asks.

A chapter's words keep Sefaria's structure ([data model](data-model.md#a-pages-words),
profile `sefaria`): its sub-sections as sections, its segments numbered
as Sefaria numbers them (ids from their place, `3.14`, the same in the
Hebrew and the English, so the two stand side by side), footnotes as
notes, page markers as markers, each version with its own credit. The
texts Sichos-Kodesh took from Sefaria come in the same way with
`sichos-kodesh-works`; its other texts keep their paragraphs, headings
and a letter's lines set to the end side (profile `sichos-kodesh`), and
the Mafteiach's outlines their numbered items (profile `outline`).
Segments are counted from the kept documents, where Sefaria's empty
segments are left out, so a chapter with an empty segment numbers the
ones after it one lower until the crawl keeps their numbers.

With `--keep`, each kept text is also stored on RebbeHub's own storage,
`rebbehub-public` at `texts/<sha256>`, checked against its hash first, and
the page then links to that copy. This needs two secrets, set in the
environment (and as repository secrets for the workflow):

- `CLOUDFLARE_ACCOUNT_ID`: the account `rebbehub-public` is in;
- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token with **Workers R2
  Storage: Edit**.

Without them the crawl still runs and the pages link to Sefaria only.

## igros

The letters and their texts come in with `sichos-kodesh-works` (the
`igros-kodesh-rebbe` work). This importer adds each letter's date. It
reads the folder Sichos-Kodesh's `build-igros` writes from the Igros
app's files, which are Shmuly's and in no repository, so it runs only
where they are given:

```sh
npm run build-igros -w @sichos-kodesh/igros-index -- --data <Igros app files> --out ../igros
IGROS_DATA=../igros rebbehub import igros --from ../Sichos-Kodesh --approve-as shmuly
```

It reads `igros/vol-NN.json` only. The Maanos next to them are not cleared
([rights](rights.md)) and are never read. A letter whose date line cannot
be read gets its year alone.

## archive

Reads a copy of Sichos-Kodesh's `services/archive` index
(`raw/index.sqlite`):

```sh
SK_ARCHIVE_DB=../index.sqlite rebbehub import archive --from ../Sichos-Kodesh --approve-as shmuly
SK_ARCHIVE_DB=../index.sqlite rebbehub archive-gaps --db ../index.sqlite
```

Each commit on the archive's main line becomes one Suggestion by
`bot:sk-archive`, titled with its message, author and date, adding a
source to each item it kept a file for (the file's sha256 and size). Run
it last: it only adds to items the other importers made, and skips the
rest. The Maanos are left out.

`archive-gaps` puts the files the archive wanted but could not get onto
the Missing board's **Files lost** tab, each with the address it was last
looked for at, so people who have a copy can bring it.
