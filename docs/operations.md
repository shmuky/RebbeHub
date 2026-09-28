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

## The API

- Local: `npm run dev:api` (PGlite, or `DATABASE_URL`). `DEV_ACCOUNT=me`
  signs every request in as `me` - for local testing only; refused unless
  the server listens on localhost.
- Cloudflare Workers: `services/api/wrangler.toml`, with a Hyperdrive
  binding to Neon and the secrets `REPORT_SALT` and `TURNSTILE_SECRET`.

## The site

`apps/web` reads the catalog only through the API, like any other client.

- Local: `npm run dev:web` (Vite, http://localhost:5173) with the API
  running; `REBBEHUB_API_URL` and `SITE_URL` override the defaults.
- Node: `npm run build:web`, then `npm start -w @rebbehub/web` (port 3000).
- Cloudflare Workers: `apps/web/wrangler.toml` - static assets from
  `build/client`, `API_URL` and `SITE_URL` as vars, and optionally a
  service binding to the API Worker.

Pages are cached for a minute and served stale for ten while they
refresh. The language is in the address (`?lang=en`), never a cookie, so a
cached page is always in the right language.
