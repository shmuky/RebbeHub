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

Production is Postgres on Neon. The revision table is partitioned by time;
`ensureRevisionPartitions(db, [2026, 2027])` (in `@rebbehub/db`) adds
yearly partitions ahead of time.

## Seeding

```sh
rebbehub import sichos-kodesh-works --from ../Sichos-Kodesh --dry-run
rebbehub import sichos-kodesh-works --from ../Sichos-Kodesh --approve-as shmuly
rebbehub import sichos-kodesh-occasions --from ../Sichos-Kodesh --approve-as shmuly   # farbrengens, recordings, hanachos
```

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
Sichos-Kodesh release and a signed `manifest.json`; `--upload` puts them
in the public bucket at `dumps/<tag>/`, where the API serves them at
`/dumps/<tag>/<name>` and lists them, with their sha256, on
`/v1/editions` and `/mirrors`. How others keep a copy: [mirrors](mirrors.md).

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

`make` copies each scan from the archive into `rebbehub-public`
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

## The API

- Local: `npm run dev:api` (PGlite, or `DATABASE_URL`). `DEV_ACCOUNT=me`
  signs every request in as `me` - for local testing only; refused unless
  the server listens on localhost.
- Cloudflare Workers: deployed on every merge to `main`; see
  [deploy.md](deploy.md).

## The site

`apps/web` reads the catalog only through the API, like any other client.

- Local: `npm run dev:web` (Vite, http://localhost:5173) with the API
  running; `REBBEHUB_API_URL` and `SITE_URL` override the defaults.
- Node: `npm run build:web`, then `npm start -w @rebbehub/web` (port 3000).
- Cloudflare Workers: deployed with the API on every merge to `main`; see
  [deploy.md](deploy.md).

Pages are cached for a minute and served stale for ten while they
refresh. The language is in the address (`?lang=en`), never a cookie, so a
cached page is always in the right language.
