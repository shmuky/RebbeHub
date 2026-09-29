# Running RebbeHub

Everything below uses the `rebbehub` command (`services/jobs`). From the
repository: `npm run rebbehub -- <command>`. Every command takes
`--database <postgres URL | PGlite folder>`; the default is
`$DATABASE_URL`, else `.data/pglite`.

## Database

```sh
rebbehub migrate                     # create or update the schema; seeds the built-in schemas as commit 1
rebbehub account --id shmuly --name "Shmuly" --steward
```

Once, after deploying built-in schemas version 5 (a page's words as
structure, no longer wiki markup; [data model](data-model.md#a-pages-words)):

```sh
rebbehub convert-bodies [--chunk 500]   # every page whose words are still markup, as structured words
```

It works in reviewed system changes of `--chunk` pages, and can be
stopped and run again: it takes up only what is left (migration 0015
indexes what is). Until it has run, the API reads those pages into
structure on the way out, so nothing looks different. Where the catalog
is still rebuildable, re-running `sichos-kodesh-works`,
`sichos-kodesh-occasions` and `sefaria` gives the fullest structure
(footnotes, the English beside the Hebrew), which markup had lost.

Production is Postgres on Neon. The revision table is partitioned by time;
`ensureRevisionPartitions(db, [2026, 2027])` (in `@rebbehub/db`) adds
yearly partitions ahead of time.

## Seeding

```sh
rebbehub import sichos-kodesh-works --from ../Sichos-Kodesh --dry-run
rebbehub import sichos-kodesh-works --from ../Sichos-Kodesh --approve-as shmuly
rebbehub import sichos-kodesh-occasions --from ../Sichos-Kodesh --approve-as shmuly   # farbrengens, recordings, hanachos
```

The other importers (HebrewBooks, JEM, Sefaria, the Igros letters' dates,
Sichos-Kodesh's archive) and what each needs are in [importers](importers.md).

Without `--approve-as`, the bot's suggestions wait in the review queue.
Running an import again changes only what the source changed, and never
overwrites what people have fixed.

## The git mirror

```sh
rebbehub mirror --dir ../catalog --git
```

The first run writes the whole catalog; later runs add one git commit per
RebbeHub commit since the one in the mirror's `COMMIT` file, authored as
the suggestion's author. `--full` rewrites it from scratch. Push the
result to the public `rebbehub/catalog` repository.

## Editions and dumps

```sh
rebbehub keygen --out release-key.json        # once; keep it secret, publish the public key
rebbehub edition --by shmuly                  # tags main as e.g. 2026.40
rebbehub dump --tag 2026.40 --out dumps/2026.40 --key release-key.json --upload
```

The dump folder holds the SQLite database, the JSON Lines file, the
same table as Parquet (`rebbehub-<tag>.parquet`: `id`, `type`, `path`,
`rev`, and `data` as JSON, for DuckDB, pandas or Spark), the
Sichos-Kodesh release and a signed `manifest.json`; `--upload` puts them
in the public bucket at `dumps/<tag>/`, where the API serves them at
`/dumps/<tag>/<name>` and lists them, with their sha256, on
`/v1/editions` and `/mirrors`. How others keep a copy: [mirrors](mirrors.md).

## Links, search by meaning and citations

```sh
rebbehub check-links --limit 2000     # whether the catalog's links answer (the health page's dead links)
rebbehub embed --limit 2000           # vectors for search by meaning (Workers AI keys needed)
rebbehub citations                    # citations in the texts, proposed as links for review
rebbehub citations --approve-as shmuly  # ... approved at once, as an import is
```

Each does only what earlier runs have not: `check-links` checks the
links checked longest ago first, `embed` reads items it has not read at
their current revision, `citations` reads items it has not read at their
current revision and never proposes a link that was proposed before
(merged, waiting, or sent back). The *Links, embeddings and citations*
workflow runs `check-links` every night, and `embed` too once the
Workers AI secrets are set; `citations` only when started.

- **Search by meaning** uses BGE-M3 on Cloudflare Workers AI
  (multilingual: Hebrew, Yiddish and English questions find the same
  sichos). The vectors are kept in the `embedding` table as `real[]`;
  where the database has pgvector (Neon), migration 0010 switches it on
  and indexes them, and elsewhere (PGlite, a plain Postgres) they are
  compared in plain SQL. Words whose rights forbid copies are never sent:
  such an item is read by its name alone. The API offers the search once
  its Worker has `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AI_TOKEN`
  ([deploy](deploy.md)); until then the site does not show "By idea".
  Everything it finds is marked as chosen by machine.
- **Citations**: `לקו"ש חי"ב עמ' 123`, `אג"ק ח"ג אגרת תשסד`,
  `תו"מ`, `סה"מ מלוקט`, and sichos by their date (`שיחת י"ט כסלו תשכ"ב`;
  `משיחת…` says the page is based on that farbrengen; `נדפס ב…` says
  where it was printed). Each is linked to the most precise thing the
  catalog holds (the letter, the volume's printing, the farbrengen, else
  the sefer) as a Relation in a suggestion by `bot:citations`, labelled as
  found by machine until a keeper approves it (`packages/core/src/citations.ts`).
- The whole-catalog copy (`scripts/import-catalog.sh`) replaces these
  tables with the build's, which has none: run the jobs again after it.

## The Sichos Kodesh scans and their reading copies

Sichos-Kodesh's archive holds every hanacha scan its catalog links to, in
its own R2 bucket (`sichos-kodesh-archive`, by sha256). The old
typewritten Sichos Kodesh hanachos are open ([rights](rights.md)), so
RebbeHub keeps and serves them, each with a **reading copy** made by
`@rebbehub/pdf-fix`: every page turned level, its text centred with even
margins and the same enlargement on every page, cut free of the
scanner's black edges. The scan itself is untouched - only where it sits
on the page changes - so the copy is lossless and the same size. Each
copy is read back and measured again, and a file whose pages do not all
come out level (two-column typeset pages, whose tilt cannot be read
reliably) keeps no copy. Only the old typewritten set is taken: a label
naming a later printing (the re-typed edition of 5758 on, its Brooklyn
5776 volumes, another publisher's booklet, a memoir) is a publisher scan
and stays out.

```sh
export CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=…   # R2 edit rights on both buckets
rebbehub reading-copies make --from ../Sichos-Kodesh --work .data/reading-copies --shard 0/4   # and 1/4, 2/4, 3/4 side by side
rebbehub reading-copies publish --from ../Sichos-Kodesh --work .data/reading-copies
```

`make` reads the archive's list of what it holds (`objects.json` in the
archive's own bucket; `--archive` names another), copies each scan from
the archive into `rebbehub-public`
(`objects/<sha256>`) and puts its reading copy next to it; a run that
stops goes on where it left off. `publish` writes the manifest -
`manifests/reading-copies/sichos-kodesh.json`, served at
`https://api.rebbehub.org/manifests/reading-copies/sichos-kodesh.json` -
listing every scan, its copy and each page's tilt, text box and transform
(original page → copy, in PDF points), so OCR can reuse the measurements
and show its lines on the copy. Every import then runs `rebbehub
reading-copies register`, which records the scans as files (class
`sichos-kodesh-hanacha`, open) and the copies as their `reading-copy`
derivations, with each page's measurements as the scan's **page fix**;
`GET /v1/files/<sha256>` lists them. A takedown of a scan takes its copy
down with it. When pdf-fix improves, its encoder version goes up and
`make` does every file again.

## Page fixes for linked PDFs

Most PDFs RebbeHub knows it only links to - Otzros HaRebbe's library of
Lubavitch seforim, some 5,400 files on Google Drive, first - so it makes
no copies of them. What it keeps is each file's **page fix**: which pages
lean, and the turn that levels each (a PDF matrix per page). The site's
reader draws the linked file through it; "Show as scanned" shows the file
as it is.

Most files need nothing, and are told apart cheaply
(`services/jobs/src/pageFixes.ts`, `@rebbehub/pdf-fix`'s `inspect.ts` and
`level.ts`):

- a book set in type is passed over from a glance at six pages, without
  drawing anything (`as-is`, `born-digital`);
- a scanned book is drawn at eight pages spread through it, and if none
  leans 0.4° or more it is left as it is (`as-is`, `level`);
- only then is it measured page by page, and only pages leaning 0.3° or
  more are turned, each about its middle. Nothing else changes - no
  centring, enlarging or cutting, since a printed book's layout is its
  publisher's. Each turn is tried and the page measured again; a page that
  does not come out level keeps no turn (`fixed`).

Install Poppler first (`apt-get install poppler-utils`): pdf-fix draws
pages with its `pdftoppm` when it is there, a hundred times faster than
pdf.js on a big compressed scan (a 462-page book of 450 dpi pages: 81 s
against well over an hour). Without it pdf.js draws them, correctly but
slowly.

```sh
rebbehub page-fixes make --work .data/page-fixes --shard 0/4   # and 1/4, 2/4, 3/4 side by side
export CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=…         # R2 edit rights on rebbehub-public
rebbehub page-fixes publish --work .data/page-fixes
```

`make` lists the library from Drive as the importer does (kept in the work
folder, so every shard and the publish use one list), reads each PDF from
Drive, measures it and lets it go; each file is read once. A run skips
what an earlier run finished at the current encoder (`pdf-level@1`), so
after an import adds files the next run reads only the new ones, and a
file Drive would not give is tried again. `publish` writes
`manifests/page-fixes/otzros.json`. Every import runs `rebbehub
page-fixes register`, which records each PDF as a file RebbeHub knows but
does not hold (a publisher's scan: link only, stored nowhere) with its
page fix. `GET /v1/page-fixes/drive/<Drive id>` answers the reader: the
turns, or the reading copy to open instead when RebbeHub serves one.

## Drive links

The catalog stores each PDF on Google Drive at its own address
(`https://drive.google.com/file/d/<id>/view`, as the mafteiach and
Otzros HaRebbe link it), and the site reads it through the API's own
route, `GET /v1/drive/<id>` (`services/api/src/drive.ts`), in place of
Sichos-Kodesh's media proxy:

- it answers only for files an item on main links to (the `drive_file`
  table, kept with every merge, `packages/core/src/driveFiles.ts`), so it
  is not a way to fetch any file from Drive; a file linked with a resource
  key is fetched with it;
- it passes a `Range` on to Drive and answers the part (the player seeks);
  a whole file is kept at Cloudflare's edge for a week;
- a file over `DRIVE_MAX_MB` (300) is refused (413), and `RATE_LIMIT_DRIVE`
  counts files read per address (120 a minute), on top of the address's
  allowance ([configuration](configuration.md));
- Drive answers a file it will not give (too many downloads today, no
  longer shared) with a page: the API says 502, and the reader shows its
  error with the link to the file on Drive.

Imports before this stored Drive PDFs on the media proxy
(`https://sichos-kodesh-media-proxy.shmuky.workers.dev/drive/<id>?…`): a
farbrengen's hanachos, and an Otzros page's reading copy beside its Drive
copy. The reader still opens those through the API, and one job turns
them into Drive links:

```sh
rebbehub relink-drive --dry-run      # counts what it would change, by type
rebbehub relink-drive [--chunk 500]  # one bot Suggestion per 500 items, for review
```

or the **Upkeep (manual)** workflow's `relink-drive-dry-run` and
`relink-drive`. Each link on the proxy becomes the file's Drive link
(with its resource key); a link's `origin`, label and the rest stay as
they are; an Otzros page's reading copy, then the same as its Drive copy,
is dropped. Each Suggestion is the relink bot's (`bot:relink-drive`,
labelled a bot) and is approved like any import: by a steward or the
keepers of the affected Sets. Running it again sends only what is still on
the proxy and not already waiting in one of its Suggestions; once all are
approved it finds nothing. JEM's recordings (`/jem-audio/<file>`) are not
on Drive and stay on the proxy.

On the catalog as the Sichos-Kodesh checkout builds it, that is about
3,300 farbrengens (some 14,000 hanacha links, more with the mafteiach
index's own Drive links) and about 5,400 Otzros pages: some 18
Suggestions. The dry run says the real numbers.

## Text and sync

- `rebbehub ocr --reread` reads again the scans an older version of the
  engine read. The machine layer takes the new reading (its engine and
  version with it); community pages seeded from it take the new lines,
  except every line a person checked, which stays as they left it.
- People upload their own OCR on a scan's text page (hOCR, ALTO, or plain
  text with a form feed between pages); it is kept as its own layer, with
  the program and version they name. The scan's keepers pick which layer
  seeds the community text ("Seed the text from this"); pages people
  already worked on keep their checked lines.
- Pages are proofread once when every line on them is checked, twice when
  a second person reads the page through ("This page is right"); the
  strip of pages on `/text/<scan>` shows each page's level.
- `rebbehub align --approve-as <steward>` hears recordings again with
  Whisper for word times (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_AI_TOKEN) and
  aligns them to the transcripts as they now stand; spans a person locked
  ("Said now" on a farbrengen page) are never moved, and the rest are
  aligned only between them. Where the catalog has the farbrengen's
  hanacha (a `hanacha` text of a unit of the event), it is synced
  paragraph by paragraph by shared words. New transcripts get word
  timings straight away.
- Projects of kind *sync* (recordings of a year to check) and
  *proofreading* (a scan's pages, to once or twice) hand out the next
  recording or page nobody holds; a claim lapses after three hours
  (migration 0013).

## Page images and fingerprints

Every served scan is shown page by page from JPEG **page images** (1600px
wide) with a strip of **thumbnails** (240px), and has a IIIF Presentation
3 manifest at `/manifests/iiif/<scan>.json` built from them. Both are
derivations of the scan's file (profiles `page-image/<n>` and
`thumbnail/<n>`, encoder `page-images@1`), so they follow its rights and
stop being served with it. Rendering a page also gives its page hash, so
`page-images` measures the file for the upload check as it goes.

```sh
export CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=…   # R2 edit rights on rebbehub-public
rebbehub page-images --limit 200                         # or --scan <id>
rebbehub fingerprints --limit 500                        # needs ffmpeg for recordings
```

`fingerprints` measures held files nobody has measured yet: a PDF's page
hashes (`dhash-256@1`, one per page) and a recording's fingerprint
(`rh-audio@1`, decoded with ffmpeg on the jobs machine only). It reads
served files from the files host; with `--preservation-bucket
rebbehub-preservation` (and the R2 keys above) it measures kept files
too. The upload check (`POST /v1/uploads/check`) and the review queue
use them to say "we already have this" or "another scan of this
printing". A rebuild import clears them with the rest of the database;
run both commands again after one. They are machine output and are only
ever shown as a guess.

## Covers from the shaar

A sefer's cover on the site is its **title page** (the shaar), from one
of its PDFs: `rebbehub covers` samples the first ten pages of the best
one (a PDF the site serves before one it only links to; within each, a
preferred, complete scan of its printings first, then a sicha's PDF on
Drive, then a printing's scan on HebrewBooks), reads their ink and their
words (the PDF's own, or the machine OCR of the scan), skips blank pages
and dark cover sheets, and takes the page that looks most like a shaar:
little ink, a few centred lines, "ספר", a publisher, a year. Failing
that, the first real page, else page 1. The page is drawn at 480px and
180px wide into the public bucket, as derivations of the PDF
(`cover/<n>`, `cover-thumb/<n>`, encoder `cover@1`), so a takedown of
the PDF takes the cover down too (migration 0017, table `cover`).

A keeper who disagrees chooses another page on the sefer's page ("Choose
another page as the title page"), a suggestion that sets the work's
`cover` (`{ file, page }`); once approved, the next run draws that page
and keeps it as the person's choice. A cover the machine chose says so.

```sh
export CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=…   # R2 edit rights on rebbehub-public and rebbehub-preservation
rebbehub covers --limit 200                              # or --work <id>; --again after the tool changes
```

A sefer whose PDFs are only linked (`link`: the Otzros library on Drive,
a printing's scan on HebrewBooks) gets its cover too. The job fetches
the PDF from its link (Drive as it gives files to anyone with the link;
HebrewBooks from `download.hebrewbooks.org`), checks it against the
sha256 the catalog has, and keeps it in `rebbehub-preservation`, never
served, as the file's copy (a HebrewBooks scan becomes a file of its
own, from its publication's HebrewBooks id, credited to HebrewBooks.org).
The cover goes into the public bucket and is served; the sefer's page
still links to the source for the PDF ([rights](rights.md)). A PDF
already kept is read back from the preservation bucket, not fetched
again. Without the preservation bucket those sefarim wait, and the log
says how many. A HebrewBooks scan that cannot be fetched is not asked
for again until its publication changes; a PDF whose rights keep no copy
is not fetched, and the log says so.

It runs from the **Upkeep (manual)** workflow ([deploy](deploy.md)),
`covers` job.

## The API

- Local: `npm run dev:api` (PGlite, or `DATABASE_URL`). `DEV_ACCOUNT=me`
  signs every request in as `me` - for local testing only; refused unless
  the server listens on localhost.
- Cloudflare Workers: deployed on every merge to `main`; see
  [deploy.md](deploy.md).
- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AI_TOKEN` switch on search by
  meaning; `OAI_ADMIN_EMAIL` switches on OAI-PMH at `/oai`.

## Status

`/status` on the site (and `GET /v1/status` for programs) says whether
the site, the API, the MCP server, the database, the database's daily
query allowance and the scheduled jobs are working, with ninety days of
it and the latest incidents.

- The API's scheduled run, every five minutes, checks them first
  (`services/api/src/status.ts`) and keeps one report in the public
  bucket at `status/report.json`. `/v1/status` reads only that file, so
  the page answers while the database does not; when the API itself does
  not answer, the page says so from the site.
- The checks cost the database one query a run (`SELECT now()`, which
  Hyperdrive never caches): 288 a day. When the database does not answer,
  the run's jobs (webhooks, email updates, the reviewer's advice) wait
  for the next run rather than spend queries failing.
- The site is asked for `/about` through the `SITE` service binding (it
  needs neither the API nor the database); the API and the MCP server are
  this Worker's own answers to `/openapi.json` and `initialize`.
- Today's queries through Hyperdrive come from Cloudflare's analytics,
  once the `CLOUDFLARE_ANALYTICS_TOKEN` secret is set (a token allowed
  Account Analytics: Read): past 80%, or on pace to run out before 00:00
  UTC, the page says so before the site goes down.
- If `checkedAt` is more than twenty minutes old, the page says the
  checks have stopped: the API's scheduled run is not running.

## The site

`apps/web` reads the catalog only through the API, like any other client.

- Local: `npm run dev:web` (Vite, http://localhost:5173) with the API
  running; `REBBEHUB_API_URL` and `SITE_URL` override the defaults.
- Node: `npm run build:web`, then `npm start -w @rebbehub/web` (port 3000).
- Cloudflare Workers: deployed with the API on every merge to `main`; see
  [deploy.md](deploy.md).

The language is in the address (`?lang=en`), never a cookie, so a cached
page is always in the right language.

## Traffic and crawlers

What happens when many people, or a crawler, come at once: most requests
are answered at Cloudflare's edge and never reach the Worker's code, the
API or Postgres.

### What is cached where

| What | Where it is kept | For how long | Code |
| --- | --- | --- | --- |
| Pages (HTML, and the `.data` React Router fetches) for anyone not signed in | Cloudflare's Workers cache in front of the site's `CachedSite` entrypoint; browsers | 5 minutes at the edge, then served stale for an hour while made again; 1 minute in browsers | `apps/web/server/worker.ts`, `server/cachePolicy.ts`, `app/root.tsx` |
| An item's page (`ITEM_PAGE`), for anyone not signed in | as above | an hour at the edge, then stale for a day while made again (it changes only when a Suggestion about it is approved) | `app/routes/item.tsx` |
| Pages for someone signed in (the `rh_session` cookie) | nowhere (`private, no-cache`) | - | `server/cachePolicy.ts` |
| A page that is not there (404) | as any page | as any page | - |
| `robots.txt`, sitemaps | edge | a day / an hour | `app/routes/robots.ts`, `app/routes/sitemap*.ts` |
| Built files (`/assets/*`, named by content) | browsers and Cloudflare | a year, `immutable` | `apps/web/public/_headers` |
| Fonts, pdf.js files, icons | browsers and Cloudflare | a week / a day | `apps/web/public/_headers` |
| API reads from nobody in particular (no token, no cookie) | Cloudflare's Workers cache in front of the API's `CachedApi` entrypoint; browsers | 2 minutes at the edge, then stale for 10 while fetched again | `services/api/src/worker.ts`, `platform.ts` |
| API sums of the whole catalog (`/v1/stats`, `/v1/health`, `/v1/community`, `/v1/refcounts`) | as above | 10 minutes, then stale for an hour | `platform.ts` (`PUBLIC_SUMMARY`) |
| `/v1/sitemap…`, `/openapi.json`, `/llms.txt` | as above | an hour / 5 minutes / an hour | - |
| File bytes (`/objects/<sha256>`: covers, page images, audio) | edge (whole files) and browsers | a day | `services/api/src/app.ts` |
| Google Drive files the catalog links to (`/v1/drive/<id>`) | edge (whole files) and browsers | a week at the edge, a day in browsers (`immutable`: a Drive id's bytes do not change) | `services/api/src/drive.ts` |
| Reads with a token or a session, and every change | nowhere | - | - |

Each Worker has two entrypoints (`[exports]` in its `wrangler.toml`): the
default one runs on every request, is never cached, and sends what anyone
may have on to the cached one. The cache keeps each answer as long as its
`Cache-Control` says, and collapses a burst of the same request into one
run of the Worker. The site reads the API through its service binding, so
a page made fresh still finds most of its API reads already at the edge.

A merged change shows at once to whoever made it (they are signed in, so
their pages are never served from the cache, and the site asks the API
for them with `Cache-Control: no-cache`, which the API's edge does not
answer), and to everyone else within about five minutes, an item's own
page within about an hour. A new deploy starts with an empty cache (each version has its
own).

### What reaches Postgres

- A page's first view after it expired at the edge: its API reads that
  are not at the API's edge either. An item page makes one to two dozen
  reads, each a lookup by id or an index (`entity_ref`, `entity_path`).
- Everything a signed-in person reads and does.
- Searches (full text, `entity_search`; by meaning, the `embedding` HNSW
  index and a Workers AI call). Each address may search 60 times a minute
  on the site (`RATE_LIMIT_SEARCH` in `apps/web/wrangler.toml`) and on the
  API (`services/api/wrangler.toml`), on top of the API's 300 requests a
  minute. Page views are never limited: crawlers read pages freely.
- Sitemaps: the index is one query over the `entity_type_id` index
  (migration 0019), and each sitemap one more; both are kept an hour.
- Each range of a file a player asks for (they are not cached at the edge)
  looks the file up by its sha256; Hyperdrive's query cache answers most
  of those.

Hyperdrive pools the connections (each Worker request opens one through
it) and caches reads for a minute by default: keep its caching on.

#### The statement budget

On the Workers Free plan Hyperdrive counts every statement the API Worker
sends, cached or not, reads and writes alike, a transaction's BEGIN and
COMMIT included, against 100,000 a day; past that, every query errors
until midnight UTC and the site is down (a 500 on every page and API read
not already at the edge). The plan's other limits bite the same way: a
Worker may make 50 subrequests a request (service-binding calls to the
API count) and use 10 ms of CPU (Cloudflare lets a request over now and
then, and cuts off a Worker that is over steadily: error 1102). One limit
holds on every plan: a request may pass through 32 Worker invocations in
all, and each of the site's calls to the API is one, so a page keeps well
under 32 calls whatever the plan. The jobs (`services/jobs`) connect to
Postgres directly and count against none of these.

So every page has a budget, and the budget is a test:
`apps/web/tests/budget.test.ts` renders each page through the site and
the API in one process, over a small PGlite catalog with the shapes that
matter (a sefer of thirty sichos, a farbrengen of six parts with a synced
hanacha, open suggestions of twenty items), counting every statement the
API sends, every request the site makes and the kilobytes the page is,
and fails when a page goes past its ceiling. A PR that needs more raises the ceiling in the test, on
purpose, saying why; run alone with console output shown
(`npx vitest run apps/web/tests/budget.test.ts --reporter=verbose --silent=false`) it
prints each page's counts and every request the page made.
The same harness over a full catalog (`.data/measure.ts` in a checkout,
not in git: the test's counting wrapper over a PGlite catalog imported
from Sichos Kodesh) gave the counts of 29 Elul 5786 (before and after
that day's changes):

| Page | Statements | API calls |
| --- | --- | --- |
| Home | 62 → 60 | 21 → 21 |
| A sefer | 40 → 24 | 16 → 14 |
| A volume of Igros Kodesh (150 letters) | 177 → 25 | 166 → 16 |
| A sicha or letter | 39 → 23 | 17 → 15 |
| A farbrengen with 40 parts | 80 → 17 | 58 → 15 |
| A set (the farbrengens) | 36 → 12 | 14 → 10 |
| An author | 9 → 8 | 9 → 9 |
| Search | 3 | 4 |
| The apps' catalog manifest (every request) | 7 → 1 | 0 |
| `/v1/commits?limit=12` (the home feed) | 13 → 3 | 0 |

What the budget rules out: opening many suggestions in full (the review
queue once loaded 18 bot imports of 500 items each, 36,000 statements a
view, and used the day's allowance by noon), one request per row of a
list (a farbrengen asked for each part's file and hanacha, 58 requests
for forty parts; a volume's page asked for each sicha's texts, 166 for
a volume of Igros Kodesh: past the plan's 50 subrequests and the 32
invocations of any plan, so those pages errored whatever the quota), and
a commit feed that carries every change of an import (thousands). Batch
routes exist for what pages need many of: `/v1/entities/batch`,
`/v1/entities/batch/linked` (one group of what points at each of many
items: a sefer's sichos' texts, a farbrengen's sichos' words),
`/v1/texts/batch/progress`, `/v1/files/batch`,
`/v1/recordings/batch/hanacha`, `/v1/suggestions?about=`, and
`/v1/commits?changes=`; `/v1/entities/{id}/linked` gives the items
themselves where `backlinks` gives ids to read after. A suggestion is
read a page at a time (`/v1/suggestions/{id}?limit=`), and its summary of
every item only when asked (`summary=1`); the conversation list says of
each what it changes (`types`, `first`), so a page can label and place
suggestions without opening them.

Lists carry an item's facts, not its words. An item's `body` (the words a
page keeps in itself: Sichos-Kodesh's import puts each letter's or sicha's
text in its unit) is kilobytes, and every list route (`/v1/entities`,
`children`, `linked`, `batch/linked`, `/v1/works/{id}/parts/{part}`,
`/v1/events`, search) leaves it out (`FACTS` in
packages/core/src/catalog.ts); an item read by id, or several with
`/v1/entities/batch`, has it. A page carries its loader's data to the
browser, hidden, for hydration, so whatever a loader keeps that the page
does not show is paid twice, in the API's answer and in the page: a volume
of Igros Kodesh was 1.1 MB, 1 MB of it the words of its 150 letters,
listed with each and read by no one; it is 170 kB now, and a third of the
CPU (a request's CPU is limited too; the free plan's 10 ms is what error
1102 "exceeded resource limits" is about). The set of the farbrengens
listed five hundred of its three thousand, 900 kB; a set's page lists its
sefarim and the first sixty of anything else in it, with how many there
are (133 kB). A suggestion's page carries the checks of its own page of
items and the count of them all (`checkCounts`), not one line per item
of an import; `brief=1` gives a feed each item's facts without its words;
the suggestions list carries no checks (six imports' checks were 500 kB).
The budget test holds each page to a size for the same reason, and its
sample sichos have words, so a list that leaks them shows.

The same rule, one level down: a list keeps of each item what its row
shows. A farbrengen's `links` (where it is printed, with each link's
label and page) are four fifths of it, and a row shows an icon; the
calendar's year, the home page's week and a farbrengen's other years keep
each farbrengen as a row (`eventRow` in apps/web/app/components/EventRow.tsx:
its name, its date, the kinds of its links, its recordings), so a year's
calendar carries 43 kB of them, not 108. And what a page computes counts
like what it carries: a suggestion's page compares each item's version
with main's to say what changed, and comparing by writing both out as
canonical JSON, at every level of every field, was a quarter of the home
page's CPU (its feed opens six suggestions); `same` in
packages/core/src/merge.ts walks the two values instead.

Latency comes from the same place: each API read is a Worker call and its
statements are round trips to Postgres in Virginia, one after the other.
Smart Placement (`[placement]` in each `wrangler.toml`) runs the Workers
next to the database; pages and the API's public reads stay cached at
the edge near the reader.

Every answer says what it cost, in production too, in a `Server-Timing`
header (the Timing tab of a browser's DevTools shows it; so does
`curl -sI https://rebbehub.org/ | grep -i server-timing`). The API's
says `db;dur=<ms>;desc="<n> statements"` (its request's own connection,
counted: `measured` in `@rebbehub/db`) and `total`; a page's says `api`
(how many times it asked the API and how long it waited, summed, so side
by side asks can exceed the whole), `db` (the statements and time those
answers report, an answer the edge already had counted as from the edge)
and `total`. An answer the edge serves carries the header of the time it
was made, with `cf-cache-status: HIT`. When a page is slow, this says
whether the time is in the database, in the trips to the API, or in
making the page.

### Crawlers

- `/robots.txt` lets every crawler, AI crawlers too, read items, lists and
  the developer docs, and keeps them out of what is personal, the tools,
  the passages to the API (`/_/`) and what has no end (search, a text's
  every page, comparisons, files). It names `/sitemap.xml`.
- `/sitemap.xml` lists the site's own pages and every set, author,
  person, sefer, unit, farbrengen, printing and recording, 10,000 items to
  a sitemap, each in Hebrew and English (`hreflang`, `x-default` Hebrew)
  with when it last changed.
- Every page has its title, description, canonical address (its own
  language), `hreflang` links, Open Graph and Twitter cards (a sefer's
  shaar as the picture where the jobs have drawn one) and schema.org data:
  `Book` for sefarim and printings, `CreativeWork` for sichos, `Event`
  for farbrengens with their recordings as `AudioObject`s, `Person`,
  `Collection` for sets, `BreadcrumbList` everywhere, and `WebSite` with a
  `SearchAction` on the home page.
- Kept out of search (`noindex, follow`): search results, histories,
  edit pages, empty talk pages, the account, the inbox and the tools,
  embeds, and items with no page of their own. A permanent id
  (`/rh-…`), an old path and a trailing slash are each one 301 to the
  page's address; what is not there is a real 404.
- Search engines are sent the whole page at once (`isbot`), rendered on
  the server; nothing on an item's page needs JavaScript to be read.
- `/llms.txt` and `/llms-full.txt` are for AI agents: what RebbeHub is,
  the OpenAPI document, the MCP server and every developer page.
- **A budget for crawlers.** A page no one has asked for lately costs the
  database one to two dozen reads, and a crawler asks for tens of
  thousands. So when a bot (`isbot`) asks for a page the edge does not
  have, `CachedSite` counts it: each search engine (Googlebot, Bingbot,
  Applebot, DuckDuckBot, Yandex and a few more) has its own budget
  (`RATE_LIMIT_CRAWL_SEARCH`, 6 pages a minute), and every other bot, AI
  crawlers among them, shares one (`RATE_LIMIT_CRAWL`, 2 a minute). Over
  it, the crawler is answered 503 with `Retry-After: 120`, which search
  engines read as "slow down", never as a missing page. Pages already at
  the edge, `robots.txt`, the sitemaps and `llms*.txt` are never counted,
  and people never are. The numbers (in `apps/web/wrangler.toml`) are set
  for Hyperdrive's free 100,000 queries a day, where Google alone could
  otherwise use a day's reads in hours; on a paid plan raise them.
- The API has its own `robots.txt`: crawlers may read its `llms.txt`,
  `openapi.json`, files (`/objects/`, a shaar for link previews) and what
  the Sichos Kodesh apps read (`/v1/app/`), not the other `/v1` routes, which the site's pages already show.
- `/.well-known/security.txt` says where to report a security problem
  (the same private reporting as SECURITY.md), and `/opensearch.xml`
  lets a browser's address bar search the catalog.
- Every answer says `nosniff`, HTTPS only (`Strict-Transport-Security`, a
  year), `strict-origin-when-cross-origin` and no camera, microphone or
  location (`server/handler.ts`; `public/_headers` for the site's files).

### Outside the code

- **Workers Paid.** With the Workers cache on, every request is billed at
  the Workers request rate, cache hits and service-binding calls
  included (hits use no CPU time). The free plan's 100,000 requests a day
  is not enough for real traffic.
- **Neon.** Autoscaling with a minimum of at least 0.5 CU, so the first
  reader after a quiet night does not wait for the database to wake;
  suspend-after-idle off for the production branch once traffic is steady.
- **Search Console and Bing Webmaster Tools.** Verify `rebbehub.org`
  (a DNS TXT record in Cloudflare) and submit `https://rebbehub.org/sitemap.xml`.
- **Cloudflare dashboard.** Leave Bot Fight Mode off, or it may challenge
  good crawlers; if AI crawlers should be kept out after all, say so in
  robots.txt rather than blocking them in the dashboard.
