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
rebbehub dump --tag 2026.40 --out dumps/2026.40 --key release-key.json
```

The dump folder holds the SQLite database, the JSON Lines file, the
Sichos-Kodesh release and a signed `manifest.json`; upload it to R2.

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
derivations; `GET /v1/files/<sha256>` lists them. A takedown of a scan
takes its copy down with it. When pdf-fix improves, its encoder version
goes up and `make` does every file again.

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
