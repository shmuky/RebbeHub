# Contributing to RebbeHub

Thank you for helping. There are two kinds of contribution, and the first
needs no technical knowledge at all.

## 1. Fixing and adding to the catalog

The catalog - every sefer, printing, scan, text, farbrengen and recording -
is not kept in this repository's files. It lives in RebbeHub's own
versioned database, where every change is a **suggestion** that a **set
keeper** approves, and every version is kept (see
[docs/versioning.md](docs/versioning.md)). An export of the whole catalog
is published after every change for anyone to download.

Until the RebbeHub site opens for contributions (phase 2 of the
[roadmap](docs/roadmap.md)), use GitHub issues:

- **Something is wrong** - a date, a name, a missing page, a bad scan:
  [open a report](https://github.com/shmuky/RebbeHub/issues/new?template=1-catalog-report.yml).
- **Something is missing**: [tell us](https://github.com/shmuky/RebbeHub/issues/new?template=2-missing.yml).
- **A rights question or takedown**: [ask here](https://github.com/shmuky/RebbeHub/issues/new?template=3-rights.yml).

A keeper turns each report into a suggestion and credits you.

Please never attach files you do not have the right to share, and never
paste the text of a copyrighted sefer. Link to where it is instead.

## 2. Working on the code

### Getting started

```sh
git clone https://github.com/shmuky/RebbeHub && cd RebbeHub
npm install
npm run check        # typecheck, tests, schema check - the same as CI
```

Node 22 is all you need; tests run on PGlite, an in-process Postgres. To
test against a Postgres server too, set `REBBEHUB_TEST_DATABASE_URL` to an
**empty** database (the tests drop its `public` schema):

```sh
REBBEHUB_TEST_DATABASE_URL=postgres://localhost/rebbehub_test npx vitest run --no-file-parallelism
```

### The flow

1. **Find or open an issue** for what you want to change, so the work is
   visible and nobody does it twice. For anything larger than a fix, say
   how you plan to do it before you start.
2. **Branch** from `main`, named for what it does:
   `fix/segment-order-after-revert`, `feat/iiif-manifests`,
   `docs/rights-policy`, `chore/update-vitest`.
3. **Commit** in small steps with messages that say what and why:
   a short first line ("Keep path redirects when an item is deleted"),
   then, if needed, a paragraph on the reason.
4. **Open a pull request** early - a draft is fine - using the template.
   CI runs the checks on PGlite and on Postgres 16.
5. **Review**: a maintainer (see [CODEOWNERS](.github/CODEOWNERS)) reviews.
   Changes to the data model, the database schema, rights or governance
   need a steward's approval.
6. **Merge**: squash-merged into `main` by a maintainer once CI is green and
   the review is approved.

### Rules of the house

- **TypeScript everywhere**, strict, ES modules; npm workspaces; vitest.
  Match the style of the code around you: plain-language doc comments that
  say *why*, in the words of the plan.
- **Tests with every change** of behaviour. Tests run against package
  sources (`vitest.config.ts` aliases), so nothing needs building first.
- **Migrations are never edited once released.** Change the schema with a
  new migration in `packages/db/src/migrations/`.
- **The model is shared with Sichos-Kodesh.** The works contract in
  `packages/model/src/works.ts` changes only together with it
  ([docs/sichos-kodesh.md](docs/sichos-kodesh.md)).
- **Machine output is labelled** until a person checks it. Never present
  OCR, transcription or sync as the Rebbe's words.
- **No restricted content in the repository**: no texts, scans or
  recordings. Tests use short made-up or public-domain samples.
- **Secrets never in git**: signing keys, database URLs, API tokens.

### Labels

`report`, `missing`, `rights` (catalog issues) · `bug`, `idea` (software) ·
`good first issue`, `help wanted` · `model`, `db`, `api`, `mirror`,
`importers`, `hebrew` (area) · `phase-1` … `phase-6` (roadmap).

## Conduct

Everyone here follows the [community and content policy](CODE_OF_CONDUCT.md).
