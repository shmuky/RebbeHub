# Deploying to Cloudflare

RebbeHub runs as two Cloudflare Workers - `rebbehub-api` (the API and the
media proxy) and `rebbehub-web` (the site) - on a Postgres database at
Neon, reached through Cloudflare Hyperdrive, with files in R2.

Cloudflare builds and deploys both from this repository on every push to
`main` (Workers Builds). No API token is kept anywhere: Cloudflare reads
the repository through its GitHub app.

| Worker | Build command | Deploy command |
| --- | --- | --- |
| `rebbehub-api` | `npm run build && npm run rebbehub -- migrate` | `npx wrangler deploy -c services/api/wrangler.toml` |
| `rebbehub-web` | `npm run build && npm run build:web` | `npx wrangler deploy -c apps/web/wrangler.toml` |

The API's build migrates the database before its deploy, so the schema is
always ahead of the code that uses it - for builds of `main` only. Cloudflare
also builds every other branch as a preview; those skip the migration, so
unmerged code never changes the live database.

**Preview builds are off** (in each project: **Settings → Build → Branch
control → Builds for non-production branches**). Every pull request is
already tested by the GitHub checks, and only `main` goes live. If they are
ever turned back on, each project needs a Preview command pointing at its
own config, with a workaround for a Cloudflare bug that makes preview
uploads fail with "The name in your wrangler.toml file must match the name
of your Worker"
([cloudflare/workers-sdk#15682](https://github.com/cloudflare/workers-sdk/issues/15682)):

| Worker | Preview command |
| --- | --- |
| `rebbehub-api` | `env -u WRANGLER_CI_MATCH_TAG npx wrangler versions upload -c services/api/wrangler.toml` |
| `rebbehub-web` | `env -u WRANGLER_CI_MATCH_TAG npx wrangler versions upload -c apps/web/wrangler.toml` |

(Not `wrangler preview`: it needs a separate `[previews]` configuration.)

## One-time setup

### 1. The database (Neon)

Use the **direct** connection string (Vercel's Neon integration calls it
`DATABASE_URL_UNPOOLED`; its host has no `-pooler`), since Hyperdrive does
the pooling.

### 2. Storage and the connection (Cloudflare dashboard)

- **R2 → Create bucket**: `rebbehub-public`, then `rebbehub-preservation`.
- **Hyperdrive → Create → public database**: name `rebbehub`, the
  connection string from step 1. Its id is in `services/api/wrangler.toml`
  (`a06ec525…`); if you ever make a new one, put its id there.

### 3. The two Workers (Workers & Pages → Create → Import a repository)

Create `rebbehub-api` first: the site binds to it. For each, pick
`shmuky/RebbeHub`, leave the root directory at the repository root, and set:

- **Project name**: exactly `rebbehub-api` / `rebbehub-web` (it must match
  the `name` in its `wrangler.toml`);
- **Build command** and **Deploy command**: from the table above;
- **Build variables**:
  - `NODE_VERSION` = `22` (both);
  - `DATABASE_URL` = the connection string from step 1, as a **secret**
    (`rebbehub-api` only - its build migrates the database).

### 4. The site's address

The site is at **https://rebbehub.org** and the API at
**https://api.rebbehub.org/v1** (custom domains on the two Workers).
`SITE_URL` in `apps/web/wrangler.toml` is the site's address, which
canonical links and sitemaps are made from; change it there if the
domain ever changes.

### 5. Optional secrets for the API

In **rebbehub-api → Settings → Variables and Secrets**:

- `REPORT_SALT` - any long random string (`openssl rand -hex 32`); hashes
  reporters' addresses for rate limits;
- `TURNSTILE_SECRET` - a [Turnstile](https://developers.cloudflare.com/turnstile/)
  secret, for a captcha on anonymous reports.

### 6. Fill the catalog

The database starts with the built-in schemas only. The **Import the
catalog (manual)** workflow fills it from Sichos-Kodesh, and brings it up
to date when run again. Cloudflare's build cannot do this: it has the
database address but cannot read the private Sichos-Kodesh repository.

1. In **GitHub → Settings → Secrets and variables → Actions**, add two
   repository secrets:
   - `DATABASE_URL`: the direct connection string from step 1 (the same
     one the `rebbehub-api` build has);
   - `SICHOS_KODESH_TOKEN`: a
     [fine-grained token](https://github.com/settings/personal-access-tokens/new)
     with access to `shmuky/Sichos-Kodesh` only and **Contents: Read-only**.
2. **Actions → Import the catalog (manual) → Run workflow**. It takes
   about five minutes. While the live catalog is empty, the workflow
   builds the catalog in a database next to itself and copies it in
   whole: item by item across the internet it would take hours. The copy
   runs in one transaction that first checks the live catalog is still
   empty, so it never replaces anything. Once the catalog holds items,
   later runs update it in place (`scripts/import-catalog.sh`).

Or, from a computer with this repository and a Sichos-Kodesh checkout:

```sh
export DATABASE_URL='postgresql://…'   # the direct connection string
npm run rebbehub -- account --id shmuly --name "Shmuly" --steward
npm run rebbehub -- import sichos-kodesh-works --from ../Sichos-Kodesh --approve-as shmuly
```

## A domain of your own

**Workers & Pages → rebbehub-web → Settings → Domains & Routes → Add →
Custom domain** (e.g. `rebbehub.org`), and the same for `rebbehub-api`
(e.g. `api.rebbehub.org`). Then update `SITE_URL` and merge.

## Files

Files that may be served live in `rebbehub-public` under
`objects/<sha256>`. The API serves them at `/objects/<sha256>` only while
their rights allow, so a takedown stops serving a file at once. Nothing
binds `rebbehub-preservation`: what is kept there is never served.

## Deploying by hand (fallback)

`.github/workflows/deploy.yml` does the same deploy from GitHub Actions,
run by hand (**Actions → Deploy (manual) → Run workflow**), for when
Cloudflare's builds are unavailable. It needs repository secrets
`CLOUDFLARE_API_TOKEN` (a custom token with Workers Scripts Edit, Workers
R2 Storage Edit, Hyperdrive Edit and Account Settings Read),
`CLOUDFLARE_ACCOUNT_ID` and `DATABASE_URL`, and optionally `REPORT_SALT`
and `TURNSTILE_SECRET`.

## Running the Workers locally

```sh
# the API, in the Workers runtime, against a local Postgres
cd services/api
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgres://localhost/rebbehub \
  npx wrangler dev --port 8788

# the site, bound to it (after npm run build:web)
cd apps/web && npx wrangler dev --port 8789
```
