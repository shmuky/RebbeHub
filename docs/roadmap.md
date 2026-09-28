# Roadmap and status

The phases of [the plan](plans/rebbehub.md), section 12, and where each
stands. ✅ built and tested · 🟡 partly · ⬜ not yet.

## Phase 0 - Foundations

| Plan item | Status | Where |
| --- | --- | --- |
| New repository, AGPL, collaboration workflow (issues, PRs, branches, CI, CODEOWNERS) | ✅ | `.github/`, `CONTRIBUTING.md`, `GOVERNANCE.md` |
| `@rebbehub/model` from Sichos-Kodesh's `packages/works`, with Publication, Scan, Text layer, Recording, Sync added | ✅ | `packages/model` - [data model](data-model.md) |
| Schema as data (JSON Schema per type, changed through suggestions) | ✅ | `packages/model/src/schemas`, `schema` items in the catalog |
| Postgres schema of section 6 | ✅ | `packages/db` - [versioning](versioning.md) |
| ID scheme (`rh-` Crockford ids, readable paths with redirects) | ✅ | `packages/model/src/ids.ts`, `paths.ts` |
| Rights policy | ✅ | `packages/model/src/rights.ts` - [rights](rights.md) |
| Hebrew dates, numerals, normalisation (`packages/hebrew`) | ✅ | `packages/hebrew` |
| The catalog engine: suggestions, checks, review, three-way merge, history, revert, projects, reports, trust | ✅ | `packages/core` |
| Importers as bot commits: the works Sichos-Kodesh knows (82 works, their units) | ✅ | `packages/importers` - verified on the real checkout |
| Importers: farbrengens with their recordings and hanachos (3,330 farbrengens 5710-5752, 6,454 recording parts), from the catalog Sichos-Kodesh's app is built from | ✅ | `packages/importers/src/sichosKodeshOccasions.ts` |
| Importers: JEM's whole tree, Igros (11,059 letters), Sefaria texts, HebrewBooks (~1,450 books), chabadlibrary.org tree, archive history | ⬜ | next; each is a new `Importer` over its Sichos-Kodesh indexer (see below) |

## Phase 1 - Read

| Plan item | Status | Where |
| --- | --- | --- |
| Public read API (REST + OpenAPI) | ✅ | `services/api` |
| Search (built-in Postgres full text over normalised names, text and dates; Hebrew and English date queries) | 🟡 | `core` search, the site's `/search`; Meilisearch when the catalog outgrows it |
| Permanent links (ids, paths, redirects) | ✅ | `core`, `api /v1/resolve` |
| Git mirror (JSON per item, texts as Markdown, sync as WebVTT; one git commit per merge) | ✅ | `packages/mirror`, `rebbehub mirror` |
| First dump (signed SQLite + JSON Lines; Sichos-Kodesh release) | ✅ | `rebbehub edition`, `rebbehub dump` |
| Parquet dump | ⬜ | with the first public edition |
| Public site: sets, events calendar, item and publication pages, search, permanent links | ✅ | `apps/web` (React Router 7, server-rendered; Node or Workers) |
| The site as Sichos-Kodesh's app works: this week first (today's parsha, the kvius year, every year), farbrengen pages, one player across pages, smart search by parsha, chag, date and year | ✅ | `apps/web/app/routes/home.tsx`, `views/EventPage.tsx`, `player/`, `lib/smartSearch.ts` |
| Audio player (recordings by part, video links at the moment) | ✅ | `apps/web/app/components/AudioPlayer.tsx`; words highlighted as spoken come with sync (phase 5) |
| Scan viewer (served scans in the browser's PDF viewer by page; link-only scans at their source) | 🟡 | `ScanViewer.tsx`; IIIF and page images come with uploads (phase 3) |
| SEO: canonical and hreflang links, schema.org data, sitemaps, robots.txt | ✅ | `apps/web/app/lib/seo.ts`, `/sitemap.xml` |
| Report a problem on every page (no account, works without JavaScript) | ✅ | `ReportForm.tsx` |

## Phase 2 - Contribute

The engine behind it is built and tested (suggestions, review queue,
history, revert, trust levels, follows, anonymous reports with captcha
and rate limits, all over the API). Signing in with a passkey or with
Google is built ([accounts](accounts.md); Google shows once its keys are
set). *Suggest a fix* is on farbrengen pages (name and date), and
`/review` lists what waits for review, before and after in words, with
*Approve* and *Send back* for the set's keepers. Still to come: Suggest a
fix on the other kinds of page, signing in by email link, notifications
for follows, the reviewer's AI summary.

## Phases 3-6

Uploads and dedup (the `file` tables, rights tiers and takedowns are in
place), IIIF, OCR and community text, sync, and the network - as the plan
describes.

## Importers still to write

Each reads the output of the matching Sichos-Kodesh indexer from a
checkout, as `sichos-kodesh-works` does, and yields keyed records:

| Importer | Reads | Yields |
| --- | --- | --- |
| `mafteiach` | `packages/mafteiach-index` | events (farbrengens, with occasion ids), units of the collections the phone browses, their PDF editions |
| `jem` | `packages/jem-index` | recordings with their JEM links, video links |
| `igros` | `packages/igros-index` | 11,059 letter units with dates (text withheld per rights) |
| `sefaria` | `packages/sefaria-index` | texts and segments, CC BY-NC with credit |
| `hebrewbooks` | `packages/hebrewbooks-index` | publications with HebrewBooks ids, link-only scans |
| `archive` | `services/archive` SQLite | history as bot commits; `wanted` becomes the Missing board |
