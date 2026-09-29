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
| Importers: JEM's whole tree, Igros (11,059 letters), Sefaria texts, HebrewBooks (~1,450 books), chabadlibrary.org tree, archive history | ✅ | each a new `Importer` over its Sichos-Kodesh indexer (see below, and [importers](importers.md)); igros and archive run when Shmuly's files are given |

## Phase 1 - Read

| Plan item | Status | Where |
| --- | --- | --- |
| Public read API (REST + OpenAPI) | ✅ | `services/api`; v1 is stable: one error shape, cursors, ETags, CORS, rate limits - [developers](developers/api.md) |
| Search (built-in Postgres full text over normalised names, text and dates; Hebrew and English date queries); hits in scans open at the lit-up line, in transcripts at the moment heard | ✅ | `core` search and `moments.ts`, the site's `/search`; Meilisearch only if the catalog outgrows it |
| Permanent links (ids, paths, redirects) | ✅ | `core`, `api /v1/resolve` |
| Git mirror (JSON per item, texts as Markdown, sync as WebVTT; one git commit per merge) | ✅ | `packages/mirror`, `rebbehub mirror` |
| First dump (signed SQLite + JSON Lines; Sichos-Kodesh release) | ✅ | `rebbehub edition`, `rebbehub dump` |
| Parquet dump | ✅ | `rebbehub dump` writes `rebbehub-<tag>.parquet` beside SQLite and JSON Lines |
| Public site: sets, events calendar, item and publication pages, search, permanent links | ✅ | `apps/web` (React Router 7, server-rendered; Node or Workers) |
| The site as Sichos-Kodesh's app works: this week first (today's parsha, the kvius year, every year), farbrengen pages, one player across pages, smart search by parsha, chag, date and year | ✅ | `apps/web/app/routes/home.tsx`, `views/EventPage.tsx`, `player/`, `lib/smartSearch.ts` |
| Audio player (recordings by part, video links at the moment) | ✅ | `apps/web/app/components/AudioPlayer.tsx`; words highlighted as spoken in `Transcripts.tsx` |
| Scan viewer (served scans page by page from page images, with a strip of pages and a IIIF manifest; link-only scans at their source) | ✅ | `ScanViewer.tsx`, `rebbehub page-images`, `/manifests/iiif/<scan>.json` |
| The reader (`/read`, Sichos-Kodesh's PDF reader): dark, sepia and grey pages, stronger contrast; reopens where you stopped, per device and on your account; "Continue where you stopped" on the home page; the player plays on from where you stopped | ✅ | `routes/read.tsx`, `reader/look.ts`, `lib/places.ts`, `components/ContinueRow.tsx`, `/v1/places` |
| Installable app (PWA): manifest, icons, a service worker that keeps the app and every page read for offline use | ✅ | `public/manifest.webmanifest`, `public/sw.js`, `lib/pwa.ts` |
| SEO: canonical and hreflang links, schema.org data, sitemaps, robots.txt | ✅ | `apps/web/app/lib/seo.ts`, `/sitemap.xml` |
| Report a problem on every page (no account, works without JavaScript) | ✅ | `ReportForm.tsx` |

## Phase 2 - Contribute

The engine behind it is built and tested (suggestions, review queue,
history, revert, trust levels, follows, anonymous reports with captcha
and rate limits, all over the API). Signing in with a passkey or with
Google is built ([accounts](accounts.md); Google shows once its keys are
set). *Suggest a fix* is on farbrengen pages (name and date), and
`/review` lists what waits for review, before and after in words, with
*Approve* and *Send back* for the set's keepers; every kind of page has
it now. *Follow* is on every sefer, sicha, farbrengen, set and person,
and the account page lists what someone follows and what changed in it
(a sefer's sichos included). Signing in by email link (Resend; one
account per person, matched with Google by address), email updates of
what someone follows (off, daily or at once, sent by the API's cron),
the reviewer's AI summary on `/review` (Workers AI, marked as
machine-written, advice only), live line fixes by Trusted people kept or
undone on `/review`, new-account holds and daily limits on uploads, and
the public takedown form with a steward's one-click takedown are built
([accounts](accounts.md)); email and the summary show once their secrets
are set.

## Phases 3-6

- **The Sichos Kodesh scans** ✅: 2,710 old typewritten hanachos, open,
  2,573 with a lossless **reading copy** (pages straightened, centred, cut
  free of the scanner's edges), and every page's measurements kept
  (`@rebbehub/pdf-fix`, `rebbehub reading-copies`; see
  [operations](operations.md)).
- **Page fixes for linked PDFs**: the Otzros library's PDFs measured once
  each and let go; books set in type and level scans left alone, a
  scan's leaning pages turned level as the site's reader draws them, with
  "Show as scanned" (`rebbehub page-fixes`).
- **Uploads** ✅: "Add a recording" on farbrengen pages, "Add a scan" on
  sefer pages; hashed and kept once, stored by their rights, added through
  a suggestion (docs/rights.md, Uploads).
- **Missing board and projects** ✅: `/missing` (farbrengens without a
  recording or a text, sefarim without a scan) and `/projects` (a gap
  worked through, with progress and what is next).
- **Machine OCR and Fix this line** ✅: `rebbehub ocr` and the nightly
  *Machine OCR* workflow read served scans with Tesseract (Hebrew) into a
  machine layer; `/text/<scan>` shows it page by page, marked as machine
  reading, and a signed-in reader fixes a line into the community layer,
  reviewed like any suggestion.
- **Transcription and sync** ✅: `rebbehub transcribe` and the *Machine
  transcription (manual)* workflow (Whisper on Workers AI) turn a
  recording into a transcript of paragraphs, each synced to where it is
  heard; farbrengen pages follow the player, play from a tapped
  paragraph, and take fixes.
- **Webhooks and embeds** ✅: every merge posted, signed, to registered
  addresses; `/embed/<id>` for other sites ([api](api.md)).
- **Search by meaning** ✅: "By idea" on `/search` finds sichos and
  passages about an idea in other words (BGE-M3 embeddings on Workers AI,
  `rebbehub embed`; pgvector where the database has it), every result
  marked as the machine's choice. Off until `CLOUDFLARE_ACCOUNT_ID` and
  `CLOUDFLARE_AI_TOKEN` are set ([operations](operations.md)).
- **Citation cross-linking** ✅: `rebbehub citations` finds citations in
  texts, scans' pages and pages of sichos (`לקו"ש חי"ב`, `אג"ק ח"ג`,
  sichos by date) and proposes them as Relations in suggestions by the
  citations bot; every page shows "Printed in…", "Based on this
  farbrengen", "Cited by…", marked as found by machine until checked.
- **Health** ✅: `/health` shows coverage per year and set, pages nobody
  has checked, recordings not synced, links that no longer answer
  (`rebbehub check-links`, nightly) and the suggestions waiting longest.
- **OAI-PMH** ✅: `/oai` on the API gives libraries Dublin Core records,
  harvested by date and set, deletions included ([api](api.md)); on once
  `OAI_ADMIN_EMAIL` is set.
- **Translations** ✅: a unit's translation is a text of its own with its
  language, credit and rights; unit pages switch language with plain
  links (`?tl=en`); "Add a translation" and "Fix" per paragraph go
  through suggestions; machine translations are marked paragraph by
  paragraph until checked ([rights](rights.md), Translations).
- **Mirrors** ✅: `/mirrors` and `/v1/mirrors` list the git mirror, the
  release keys and every edition's dumps with their sha256
  (`/v1/editions/<tag>/SHA256SUMS`, `/dumps/<tag>/<name>`);
  `rebbehub dump --upload` publishes them and `rebbehub mirror-pull`
  keeps a checked copy ([mirrors](mirrors.md)). Waits on the mirror's
  public address and the release key's public half (`CATALOG_GIT_URL`,
  `RELEASE_PUBLIC_KEYS`).
- **Uploaded OCR and proofread levels** ✅: anyone uploads their own OCR
  of a scan (hOCR, ALTO, plain text), kept as its own layer with its
  engine and version; keepers pick which layer seeds the community text;
  `rebbehub ocr --reread` re-reads with a newer engine and never touches a
  checked line. Pages are proofread once, then twice by someone else, and
  change colour on `/text/<scan>`.
- **Compare printings** ✅: `/compare/<unit>`, two printings of a sicha
  (texts of it, or scanned pages a contents map gives it) word by word,
  Hebrew-aware. Waits on edition texts and contents maps in the catalog.
- **Word-level sync** ✅: Whisper's word times kept, and `rebbehub align`
  times existing (and corrected) transcripts by forced alignment and syncs
  a farbrengen's hanacha paragraph by paragraph by similarity. The player
  marks the word being said; "Said now" fixes a drifting line in one or
  two taps (locked, what follows moved with it); "The sync is right"
  checks it. Machine sync is labelled until then.
- **Sync and proofreading projects** ✅: the project page hands out the
  next recording to sync or page to proofread nobody holds, with progress.
- **Page images, IIIF, printings and teshuros** ✅: `rebbehub page-images`
  renders every served scan's pages and thumbnails as derivations, and
  every served scan has a IIIF Presentation 3 manifest. An upload is
  measured first (page hashes in the browser, `rebbehub fingerprints` for
  recordings) and told "we already have this, here", or offered as
  another scan of a printing, a new printing, or a new teshura. A sefer
  lists its printings; *Map pages* marks what a teshura's pages hold,
  through a suggestion; the Teshuros set defaults to credit, and a family
  can ask for a teshura to stop being shown ([rights](rights.md)).
- **A page's words as structure** ✅: no more wiki markup. A page's
  words are versions of segments with a few marks
  ([data model](data-model.md#a-pages-words)), drawn by their source's
  display rules: Sefaria's numbered segments with the Hebrew and English
  side by side, Sichos-Kodesh's paragraphs, the Mafteiach's outlines.
  Every segment has a link of its own (`#s-3.14`); the Edit tab fixes a
  segment in place, each fix its own suggestion; talk pages are plain
  words with links. `rebbehub convert-bodies` turns the catalog's old
  bodies over once (migration 0015).
- **Public API, developer docs, agents** ✅: personal API tokens (read,
  or read and write; hashed, made and revoked on `/account`) so scripts
  and AI agents contribute through the same review; every route in the
  OpenAPI 3.1 document, checked by a test; rate limits by address and by
  token; `/developers`, drawn from [docs/developers](developers/index.md),
  with an interactive reference; `/llms.txt`, `/llms-full.txt`, and an MCP
  server at `api.rebbehub.org/mcp` (search, items, texts, suggest a fix);
  the typed client `@rebbehub/client`. The rate limits need the
  `[[ratelimits]]` bindings deployed ([configuration](configuration.md)).
- Still to come: letters reproduced in teshuros found by text
  (cross-linking reads citations only).

## Importers

Each reads the output of the matching Sichos-Kodesh indexer from a
checkout, as `sichos-kodesh-works` does, and yields keyed records. How to
run each, and what it needs, is in [importers](importers.md).

| Importer | Reads | Yields | |
| --- | --- | --- | --- |
| `mafteiach` | `packages/mafteiach-index` | events (farbrengens, with occasion ids), units of the collections the phone browses, their PDF editions | |
| `jem` | `packages/jem-index` (`JEM_DB`) | recordings with their JEM links, added to the farbrengens already imported where they match; the rest as JEM events. jem-index has no video links yet | ✅ |
| `igros` | the Igros app's build (`IGROS_DATA`) | dates for the 11,059 letters the works importer brings; the Maanos stay out | ✅ needs Shmuly's files |
| `sefaria` | Sefaria's API (`rebbehub crawl-sefaria`) | Chabad books Sichos-Kodesh does not publish, a page per chapter, CC BY-NC with credit, kept on RebbeHub's storage by sha256 | ✅ keeping needs `CLOUDFLARE_API_TOKEN` |
| `hebrewbooks` | `packages/hebrewbooks-index` shelf | publications with HebrewBooks ids, link-only scans | ✅ |
| `archive` | `services/archive` SQLite (`SK_ARCHIVE_DB`) | history as bot commits; `wanted` files it could not get go on the Missing board's Files lost tab | ✅ needs a copy of the index |
