# RebbeHub

**The open, community-built index of Chabad Torah and media.** Every sefer
and every printing of it, every scan, the text of each, every farbrengen
and every recording synced to its words - from the Baal Shem Tov and the
Maggid, through every Rebbe, to the chassidim's seforim, kovtzim, yomanim
and the thousands of teshuros printed for simchos.

It works the way GitHub works, without anyone having to know GitHub:

| You see | You do |
| --- | --- |
| **Report a problem** | One button, one sentence. No account needed. |
| **Suggest a fix** | Edit the page or a line of text, press *Send for review*. |
| **Approve** / **Send back** | A set keeper sees before and after, side by side, and decides. |
| **History** | Who changed what and when, with *Restore this version*. |
| **Project** | A group effort ("Proofread Igros vol. 14"), merged as one when done. |
| **Catalog edition** | A dated snapshot anyone can download. |

Three promises: **everything findable** (one permanent page per item),
**anyone can help and nothing breaks** (every change reviewed or
reversible, and credited), and **it belongs to the community** (the whole
catalog and all community text are exported openly, so it can never be
locked away).

The full plan is in [docs/plans/rebbehub.md](docs/plans/rebbehub.md).
What is built so far, and what comes next: [docs/roadmap.md](docs/roadmap.md).

## Helping

- **Found a mistake, or something missing?** [Open a report](https://github.com/shmuky/RebbeHub/issues/new/choose) -
  plain words are enough.
- **Want to write code?** See [CONTRIBUTING.md](CONTRIBUTING.md).
- **How decisions are made**, who keeps which set, and the content policy:
  [GOVERNANCE.md](GOVERNANCE.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## What is in this repository

```
packages/
  hebrew/      Hebrew dates (5742-05-10), numerals, date parsing, search normalisation
  model/       every kind of item as TypeScript and JSON Schema; ids, paths, rights
  db/          the versioned Postgres schema and its migrations
  core/        the catalog engine: suggestions, review, merge, history, projects, reports
  mirror/      the open exports: git mirror, signed dumps, the Sichos-Kodesh release
  importers/   bot contributors that seed and sync the catalog
apps/
  web/         the public site (React Router 7, server-rendered, Hebrew first)
services/
  api/         the public API (Hono; Cloudflare Workers or Node)
  jobs/        the `rebbehub` command line and, later, the queue workers
docs/          the plan, the design, and how the pieces fit
```

## Running it

You need Node 22. No database server is needed to start: RebbeHub runs on
PGlite (Postgres in WebAssembly) until you point it at a real Postgres.

```sh
npm install
npm run check                      # types, tests, schemas

npm run rebbehub -- migrate        # creates .data/pglite
npm run rebbehub -- account --id me --name "Me" --steward
npm run rebbehub -- import sichos-kodesh-works --from ../Sichos-Kodesh --approve-as me
npm run dev:api                    # http://127.0.0.1:8787/v1
npm run dev:web                    # http://localhost:5173 (reads the API above)
```

Set `DATABASE_URL=postgres://…` to use a Postgres server instead. See
[docs/operations.md](docs/operations.md) for the mirror, editions and dumps.

## Licences

- Code: [AGPL-3.0](LICENSE), so hosted copies stay open.
- Catalog facts: CC0. Community text, corrections and sync: CC BY-SA 4.0.
  Texts from other sources keep their own licence.
