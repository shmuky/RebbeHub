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

Both Workers bind the same Hyperdrive config and the public and archive
buckets (`[[hyperdrive]]`, `[[r2_buckets]]` in each `wrangler.toml`): the
site answers a page's reads itself, with the API running inside it over
one connection a page (docs/operations.md, "Traffic and crawlers"), and
goes through the `API` service binding for the rest.

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
  secret, for a captcha on anonymous reports;
- `RESEND_API_KEY` - a [Resend](https://resend.com) API key, for signing in
  by email link, email updates and takedown receipts (and optionally the
  variable `EMAIL_FROM`); see [accounts](accounts.md#email-updates);
- `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_AI_TOKEN` - Workers AI, the same
  pair the transcription uses (step 7): for the reviewer's advice on
  suggestions (see [accounts](accounts.md#the-reviewers-advice)) and for
  search by meaning, where the API turns each question into a vector.
  Without them the site does not offer "By idea";
- `OAI_ADMIN_EMAIL` - the address OAI-PMH gives libraries for the
  repository's administrators; without it, `/oai` is not offered.

Each is off until its secret is set; nothing on the site shows it before.

For mirrors, three public values (not secrets) go in `[vars]` of
`services/api/wrangler.toml` once they exist: `CATALOG_GIT_URL`,
`RELEASE_PUBLIC_KEYS` and, if dumps live elsewhere, `DUMPS_BASE_URL`
([mirrors](mirrors.md)). Until then `/mirrors` says they are coming.

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
2. **Actions → Import the catalog (manual) → Run workflow** (never
   **Re-run** an old run: it runs the code of its day). It takes about five
   minutes: the works, and every farbrengen with its recordings and
   hanachos. While everything in the live catalog came from importers, the
   workflow rebuilds it in a database next to itself and copies it in
   whole: item by item across the internet it would take hours. The copy
   runs in one transaction that first checks people have still added
   nothing, so it never replaces their work. Once they have, runs update
   the catalog in place (`scripts/import-catalog.sh`).

   Each run also crawls, politely and cached, what the other importers
   read: the mafteiach index, chabadlibrary.org's contents and texts, JEM's
   catalog, HebrewBooks' shelf and Sefaria's Chabad books
   ([importers](importers.md)). To keep Sefaria's and the Chabad Library's
   texts on RebbeHub's own storage, add `CLOUDFLARE_ACCOUNT_ID` and
   `CLOUDFLARE_API_TOKEN` (a token with **Workers R2 Storage: Edit**);
   without them the pages link to Sefaria, and the Chabad Library's pages
   carry their words with no copy of their own to link to.

Or, from a computer with this repository and a Sichos-Kodesh checkout:

```sh
export DATABASE_URL='postgresql://…'   # the direct connection string
npm run rebbehub -- account --id shmuly --name "Shmuly" --steward
npm run rebbehub -- import sichos-kodesh-works --from ../Sichos-Kodesh --approve-as shmuly
npm run rebbehub -- import sichos-kodesh-occasions --from ../Sichos-Kodesh --approve-as shmuly
```

### 7. Machine OCR and transcription

- **Machine OCR** runs every night by itself (the *Machine OCR* workflow):
  first the scans people asked for, then the newest served scans that
  have no text yet, with Tesseract; it needs only `DATABASE_URL`. **Run
  workflow** reads more at once.
- **Machine transcription** transcribes recordings with Whisper. Every
  night it takes the recordings people asked for, then the newest with no
  transcript, `TRANSCRIBE_NIGHTLY` for each worker (a repository
  *variable*, 1 when unset, 0 to turn the nightly run off), always with
  the free local engine, then times the words people corrected
  (`rebbehub align`) so they become training clips. `TRANSCRIBE_WORKERS`
  (1, 2, 4, 8 or 16; 1 when unset) splits the nightly run into workers
  side by side, each with its own recordings. Started by hand, it takes
  any engine, limit and number of **workers**; the limit is per worker,
  and a worker gets through about six hours of recordings in a run.
  Its **engine** box picks who hears them: `local` (the default), ivrit.ai's
  Yiddish Whisper on the runner's CPU, free, about a quarter of the
  recording's length ([transcription](transcription.md)); or `workers-ai`,
  Whisper on Cloudflare Workers AI, which is paid by the minute of audio (about
  $0.0005 a minute; an hour-long farbrengen, about 3 cents), so it runs
  only when started, for as many recordings as asked. Workers AI needs two
  more repository secrets:
  - `CLOUDFLARE_ACCOUNT_ID`: the account the Workers are in;
  - `CLOUDFLARE_AI_TOKEN`: a Cloudflare API token with **Workers AI:
    Read** and **Workers AI: Edit** only.

  The local engine hears best with the models fine-tuned on the Rebbe's
  voice, kept private in `rebbehub-preservation` under
  `models/rebbehub-whisper-v1/`, `-v2/` and on; the workflow picks the
  highest version there. To let the workflow fetch it, add the
  bucket's S3 endpoint as `R2_ENDPOINT` (`https://<account>.r2.cloudflarestorage.com`)
  and an R2 API token that can only read that bucket, as `R2_ACCESS_KEY_ID`
  and `R2_SECRET_ACCESS_KEY`. Without them the run stops rather than
  transcribe with ivrit.ai's far weaker model (a transcript is made once),
  unless started by hand with **base_model** ticked.

  Its **align** box then runs `rebbehub align` too, with the same keys:
  word timings for transcripts that have none (made before word timings,
  or corrected since) and the farbrengen's hanacha synced paragraph by
  paragraph where the catalog has its text. Without the two secrets
  neither runs, and the site shows paragraph-level sync only.

Both mark what the machine made as machine output on the site until
people check it.

- **Asking the machines.** Anyone signed in can ask for a scan to be read
  or a recording transcribed: the button on a scan's text page and under
  a farbrengen's parts, `POST /v1/machine/requests`, the `ask_machine` MCP
  tool, or `rebbehub machine ask`. The nightly runs take requests first.
  To start the free job at once instead, give the API a GitHub token as
  the secret `GITHUB_DISPATCH_TOKEN`: a fine-grained token for this
  repository with **Actions: Read and write** only (and `GITHUB_REPO` in
  `[vars]` if the repository is not `shmuky/RebbeHub`). A request then
  starts the workflow with `requested: true`, which reads or transcribes
  only what was asked, on the runner's CPU. Nothing a request starts
  costs money beyond the repository's Actions minutes (free once it is
  public); Workers AI and rented GPUs are only ever started by hand.

- **Links, embeddings and citations** runs every night: it checks the
  catalog's links for the health page (`/health`), and, once the two
  Workers AI secrets above are set, reads items for search by meaning
  (BGE-M3, a fraction of a cent per thousand items). **Run workflow**
  also proposes the citations found in the texts as links, for keepers to
  review ([operations](operations.md)).

### 8. After a deploy: upkeep

Some of the catalog's upkeep runs only when started, from **Actions →
Upkeep (manual) → Run workflow**, one job a run (two runs never overlap:
the second waits):

1. **`convert-bodies`**, once after the redesign's schemas are deployed:
   it turns every page whose words are still wiki markup into structured
   words, as reviewed system changes. It needs only `DATABASE_URL`, and
   running it again changes nothing that is already done.
2. Then **`covers`** and **`page-images`**, as often as wanted, each for
   `limit` sefarim or scans a run (empty: the command's own default):
   `covers` draws sefarim's covers from their title pages - from a PDF
   only linked too, which it fetches and keeps in `rebbehub-preservation`,
   never served ([operations](operations.md#covers-from-the-shaar)) - and
   `page-images` draws served scans' pages for the viewer. Both put their
   pictures in `rebbehub-public`, so they need `CLOUDFLARE_ACCOUNT_ID`
   and `CLOUDFLARE_API_TOKEN` (a token with **Workers R2 Storage: Edit**,
   as for the import's stored texts) besides `DATABASE_URL`; without them
   the run stops at once and says which secret to add.

## A domain of your own

**Workers & Pages → rebbehub-web → Settings → Domains & Routes → Add →
Custom domain** (e.g. `rebbehub.org`), and the same for `rebbehub-api`
(e.g. `api.rebbehub.org`). Then update `SITE_URL` and merge.

## Files

Files that may be served live in `rebbehub-public` under
`objects/<sha256>`. The API serves them at `/objects/<sha256>` only while
their rights allow, so a takedown stops serving a file at once. Nothing
binds `rebbehub-preservation`: what is kept there is never served. The
jobs write to it (a linked PDF a cover is drawn from) and read it back
with their own token.

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
