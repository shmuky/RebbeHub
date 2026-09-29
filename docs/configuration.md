# Configuration

Every setting RebbeHub reads, where it is set, and whether it is a
secret. Secrets are never in the repository: they live in Cloudflare
(Workers → Settings → Variables and Secrets), in GitHub (repository
secrets, for the workflows), or in your shell. Everything optional is off
until it is set, and nothing on the site shows it before.
[Deploying](deploy.md) says how to set up rebbehub.org from nothing.

## Values that belong to one deployment

The repository deploys rebbehub.org as it is (Cloudflare Workers Builds
reads the `wrangler.toml` files on every push to main). A copy of
RebbeHub elsewhere changes these, and nothing else:

| Value | Where | Is |
| --- | --- | --- |
| Hyperdrive id | `services/api/wrangler.toml`, `[[hyperdrive]] id` | which Hyperdrive config (pooling the Neon Postgres) the API uses; not a secret, the connection string stays in Cloudflare |
| Bucket names `rebbehub-public`, `rebbehub-preservation`, `sichos-kodesh-archive` | `services/api/wrangler.toml`, `[[r2_buckets]]` | the R2 buckets for servable files, private uploads, and Sichos-Kodesh's archive (read only) |
| Rate limit namespaces `1001`, `1002` | `services/api/wrangler.toml`, `[[ratelimits]]` | tell the two counters apart within the Cloudflare account |
| `SITE_URL` | both `wrangler.toml` files, `[vars]` | the site's address: passkeys are bound to its domain, canonical links and sitemaps use it |
| `API_URL` | `apps/web/wrangler.toml`, `[vars]` | the API's public address; the site reaches it through the `API` service binding when there is one |
| `SITE_URL` | GitHub repository variable | for the workflows' links |
| The domains `rebbehub.org`, `api.rebbehub.org` | Cloudflare, custom domains on the two Workers | - |

## The API (services/api)

On Workers, from `wrangler.toml` and the Worker's settings; with
`npm run dev:api`, from the environment.

| Name | Secret | Does |
| --- | --- | --- |
| `HYPERDRIVE` (binding) | - | Postgres, pooled; `DATABASE_URL` under Node (without it, PGlite in `.data/pglite`) |
| `FILES_PUBLIC`, `FILES_PRESERVATION`, `SK_ARCHIVE` (bindings) | - | the buckets above; `FILES_DIR` under Node stands in for the first two |
| `SITE_URL` | no | as above |
| `REPORT_SALT` | yes | hashes reporters' addresses for the hourly limits (`openssl rand -hex 32`) |
| `TURNSTILE_SECRET` | yes | a captcha on anonymous reports and takedown requests |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | yes | signing in with Google ([accounts](accounts.md)) |
| `RESEND_API_KEY`, `EMAIL_FROM` | key yes | email sign-in links, email updates, takedown receipts |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN` | yes | Workers AI: the reviewer's advice and search by meaning |
| `OAI_ADMIN_EMAIL` | no | switches on OAI-PMH at `/oai` ([developers/oai-pmh](developers/oai-pmh.md)) |
| `CATALOG_GIT_URL`, `RELEASE_PUBLIC_KEYS`, `DUMPS_BASE_URL` | no | what `/v1/mirrors` names ([mirrors](mirrors.md)) |
| `FILES_BASE_URL` | no | where file bytes are served, when not the API itself |
| `RATE_LIMIT_ADDRESS`, `RATE_LIMIT_TOKEN`, `RATE_LIMIT_SEARCH` (bindings) | - | rate limits per address, per API token, and for searching per address ([developers/rate-limits](developers/rate-limits.md)); without them nothing is counted |
| `RATE_LIMIT_ADDRESS_PER_MINUTE`, `RATE_LIMIT_TOKEN_PER_MINUTE`, `RATE_LIMIT_SEARCH_PER_MINUTE` | no | what those bindings allow, for the `RateLimit-Policy` header; keep them equal to the bindings' limits |

Under Node only: `PORT`, `HOST`, `PGLITE_DIR`, `DEV_ACCOUNT` (signs every
request in as one account, on localhost only), `DEV_EMAIL=1` (prints
email instead of sending it), `RATE_LIMIT=1` (counts requests in memory).

## The site (apps/web)

| Name | Does |
| --- | --- |
| `API_URL` (Workers) or `REBBEHUB_API_URL` (Node) | the API |
| `API` (service binding) | the API inside Cloudflare, without a public round trip |
| `SITE_URL` | the site's address |

## The command line and the workflows (services/jobs)

| Name | Secret | Does |
| --- | --- | --- |
| `DATABASE_URL` | yes | the database; without it, PGlite in `.data/pglite` |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | yes | R2 uploads (page images, reading copies, dumps, texts) |
| `CLOUDFLARE_AI_TOKEN` | yes | Workers AI, with `CLOUDFLARE_ACCOUNT_ID`: transcription and embeddings |
| `SICHOS_KODESH_DIR` | no | a checkout of Sichos-Kodesh, which importers read at run time |
| `SICHOS_KODESH_TOKEN` | yes | GitHub token the import workflow checks Sichos-Kodesh out with |
| `JEM_DB`, `IGROS_DATA`, `SK_ARCHIVE_DB`, `SEFARIA_DATA`, `HEBREWBOOKS_SHELF`, `CHABADLIBRARY_TREE`, `MAFTEIACH_DATA` | no | where each importer's input is ([importers](importers.md)) |
| `REBBEHUB_TEST_DATABASE_URL` | yes | tests on a Postgres server as well as PGlite; an empty database, its schemas are dropped |

Signing keys for editions are passed to `rebbehub dump --key <key.json>`
from a file outside the repository, never set as a variable here
([mirrors](mirrors.md)).

## Upstream addresses

A few public addresses belong to Sichos-Kodesh, not to a deployment, and
are written in the code and in the catalog's own data (recordings' and
PDFs' URLs):

- `https://sichos-kodesh-media-proxy.shmuky.workers.dev`: Sichos-Kodesh's
  media proxy, which the recordings and linked PDFs the importers bring
  are played and read through (`SICHOS_KODESH_MEDIA_PROXY` in
  `packages/importers`, and the site's reader);
- `https://sichos-kodesh-pack-api.shmuky.workers.dev/v1/objects.json`:
  Sichos-Kodesh's archive list, which `rebbehub reading-copies` reads
  (`--archive` names another).

Should they move, they change together with Sichos-Kodesh
([sichos-kodesh](sichos-kodesh.md)).
