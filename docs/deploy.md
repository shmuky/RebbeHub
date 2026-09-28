# Deploying to Cloudflare

RebbeHub runs as two Cloudflare Workers - `rebbehub-api` (the API and the
media proxy) and `rebbehub-web` (the site) - on a Postgres database at
Neon, reached through Cloudflare Hyperdrive, with files in R2.

Every merge to `main` deploys automatically (`.github/workflows/deploy.yml`):

1. the database is migrated;
2. `scripts/cloudflare-setup.sh` makes sure the R2 buckets
   (`rebbehub-public`, `rebbehub-preservation`) and the Hyperdrive config
   (`rebbehub`) exist, creating any that are missing;
3. the API is deployed, then the site, which reaches the API through a
   service binding.

Until the secrets below are set, the workflow warns and deploys nothing.
You can also run it by hand: **Actions → Deploy → Run workflow**.

## One-time setup

### 1. A Postgres database (Neon)

Create a project at [neon.tech](https://neon.tech) and copy its
**connection string** - the direct one, not the pooled one, since
Hyperdrive does the pooling. It looks like
`postgresql://user:password@ep-….neon.tech/neondb?sslmode=require`.

### 2. Cloudflare

- **R2**: open R2 once in the dashboard and enable it (Cloudflare asks
  once per account, even on the free tier).
- **Workers subdomain**: open Workers & Pages once; the first time, it asks
  you to choose your `*.workers.dev` subdomain.
- **Account ID**: shown on the right of the account's home page.
- **API token**: My Profile → API Tokens → Create Token → *Create Custom
  Token*, for your account only, with:

  | Scope | Permission | Access |
  | --- | --- | --- |
  | Account | Workers Scripts | Edit |
  | Account | Workers R2 Storage | Edit |
  | Account | Hyperdrive | Edit |
  | Account | Account Settings | Read |

  Add *Zone → Workers Routes → Edit* (and *DNS → Edit*) for your domain
  later, when you attach one.

### 3. GitHub secrets

In the repository: **Settings → Secrets and variables → Actions**. The
token goes here and only here - never into a file, an issue or a chat.

| Secret | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | the token from step 2 |
| `CLOUDFLARE_ACCOUNT_ID` | the account id from step 2 |
| `DATABASE_URL` | the Neon connection string from step 1 |
| `REPORT_SALT` | any long random string (`openssl rand -hex 32`); hashes reporters' addresses for rate limits |
| `TURNSTILE_SECRET` | optional: a [Turnstile](https://developers.cloudflare.com/turnstile/) secret, for a captcha on anonymous reports |

And one **variable** (the *Variables* tab), once you know the site's address:

| Variable | Value |
| --- | --- |
| `SITE_URL` | the site's public address, e.g. `https://rebbehub-web.<your-subdomain>.workers.dev`, later your own domain; used for canonical links and sitemaps |

### 4. First deploy

Run **Actions → Deploy → Run workflow**. When it is green:

- the API answers at `https://rebbehub-api.<your-subdomain>.workers.dev/v1`;
- the site is at `https://rebbehub-web.<your-subdomain>.workers.dev`.

Set `SITE_URL` to the site's address and run it once more.

### 5. Fill the catalog

The database starts with the built-in schemas only. From a computer with
this repository and a Sichos-Kodesh checkout:

```sh
export DATABASE_URL='postgresql://…'   # the same Neon connection string
npm run rebbehub -- account --id shmuly --name "Shmuly" --steward
npm run rebbehub -- import sichos-kodesh-works --from ../Sichos-Kodesh --approve-as shmuly
```

## A domain of your own

In the dashboard: **Workers & Pages → rebbehub-web → Settings → Domains &
Routes → Add → Custom domain** (e.g. `rebbehub.org`), and the same for
`rebbehub-api` (e.g. `api.rebbehub.org`). Then set `SITE_URL` to the new
address and deploy again.

## Files

Files that may be served live in `rebbehub-public` under
`objects/<sha256>`. The API serves them at `/objects/<sha256>` only while
their rights allow, so a takedown stops serving a file at once. Nothing
binds `rebbehub-preservation`: what is kept there is never served.

## Running the Workers locally

```sh
# the API, in the Workers runtime, against a local Postgres
cd services/api
sed 's/HYPERDRIVE_ID/0123456789abcdef0123456789abcdef/' wrangler.toml > wrangler.local.toml
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgres://localhost/rebbehub \
  npx wrangler dev -c wrangler.local.toml --port 8788

# the site, bound to it (after npm run build:web)
cd apps/web && npx wrangler dev --port 8789
```
