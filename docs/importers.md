# Importers

Every importer is a bot: what it reads becomes Suggestions under its own
bot account, approved with `--approve-as <steward>` or left in the review
queue. Running one again changes only what its source changed, and never
overwrites what people have fixed. RebbeHub keeps no copy of
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
| `sichos-kodesh-occasions` | the checkout (`MAFTEIACH_DATA` optional) | farbrengens, recordings, hanachos |
| `otzros` | the checkout | the Otzros scans |
| `hebrewbooks` | the checkout (`HEBREWBOOKS_SHELF` optional) | HebrewBooks' Chabad shelf, link-only |
| `chabadlibrary` | `CHABADLIBRARY_TREE` | a page per chapter of chabadlibrary.org, with its words where `crawl-library --texts` kept them (the `chabad-library` profile), credited to the library |
| `jem` | `JEM_DB` | JEM's recordings |
| `sefaria` | `SEFARIA_DATA` | Sefaria's Chabad books Sichos-Kodesh does not publish |
| `igros` | `IGROS_DATA` | the letters' dates |
| `archive` | `SK_ARCHIVE_DB` | Sichos-Kodesh's archive history, and the Missing board's Files lost |

## hebrewbooks

Reads the Chabad shelf Sichos-Kodesh's `packages/hebrewbooks-index` made
from the Otzaria catalog (`apps/mobile/src/catalog/data/works/shelf.json`
in the checkout). `HEBREWBOOKS_SHELF` names a fresher one; the workflow
reads it from the latest Otzaria release. Each scan becomes a publication
with its HebrewBooks id, place and year printed, and a link to
hebrewbooks.org. Nothing is copied: HebrewBooks is link-only
([rights](rights.md)). A series Sichos-Kodesh places in a work joins that
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
rebbehub crawl-sefaria --from ../Sichos-Kodesh --out ../sefaria --cache ../sefaria-cache [--only "Book Title"]
SEFARIA_DATA=../sefaria rebbehub import sefaria --from ../Sichos-Kodesh --approve-as shmuly
```

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
