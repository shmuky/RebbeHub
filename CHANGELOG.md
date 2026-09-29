# Changelog

What changed, for the people who use RebbeHub and the programs that read
it. The catalog itself changes every day and is not listed here: its
history is on every page, in `/v1/commits` and in the git mirror.

The API follows [semantic versioning](https://semver.org): nothing under
`/v1` is removed or changes meaning; new routes and fields may be added at
any time. `@rebbehub/client` carries the API's version.

## Unreleased

### Added

- **The Sichos Kodesh apps' catalog, from RebbeHub.** `/v1/app/v1`,
  `/v1/app/v2` and `/v1/app/v3` answer at the paths and in the shapes of
  Sichos-Kodesh's own catalog API (`catalog/manifest.json`,
  `catalog/{version}/catalog.json`, `catalog/changelog.json`,
  `catalog/latest/catalog.json`, and `v3/texts/{sha256}`), built from the
  farbrengens, recordings, sefarim and units on main, so the apps can
  switch by changing one address ([Sichos-Kodesh](docs/sichos-kodesh.md)).
  Numbered `2.<commit>.0`; while RebbeHub holds no library, `v2` and `v3`
  are numbered `0.<commit>.0` and say `missing: ["library"]`, so no app
  takes them.
- **Drive files read through RebbeHub.** `GET /v1/drive/{id}` reads a
  Google Drive file the catalog links to (a hanacha's PDF, an Otzros
  scan) for the site's reader and player, with CORS and Range, kept at the
  edge; only files an item links to, up to 300 MB, 120 a minute per
  address. New error codes `too-large` (413) and `upstream` (502). The
  site no longer depends on Sichos-Kodesh's media proxy for PDFs.
- **`rebbehub relink-drive`** (and the Upkeep workflow's `relink-drive`,
  `relink-drive-dry-run`): links older imports stored on the media proxy
  become the files' own Drive links, as reviewed bot Suggestions of 500
  items; `--dry-run` counts them.
- **The Otzros library as a tree.** Its Drive folders become nested Sets
  under `/sets/otzros`, each sefer in its folder's Set, to browse and sort
  from; the sefarim keep their paths.
- **Connect Claude to your account.** The API is now an OAuth 2.1
  authorization server for MCP clients: Protected Resource Metadata
  (`/.well-known/oauth-protected-resource/mcp`), Authorization Server
  Metadata (`/.well-known/oauth-authorization-server`), registration
  (`/oauth/register`) and Client ID Metadata Documents, `/oauth/authorize`
  with PKCE (S256) and resource indicators, `/oauth/token` (codes and
  refresh tokens, turned over at each use) and `/oauth/revoke`. You
  approve an app on the site's new consent page (`/oauth/consent`), where
  you see its name, where it sends you back, and may allow reading only.
  Connected apps are listed on the account page beside your tokens
  (`kind: "oauth"` in `/v1/tokens`) and disconnected there. In claude.ai:
  Settings → Connectors → Add custom connector →
  `https://api.rebbehub.org/mcp`, *Sign in when needed*, Claude's
  published identity (CIMD).
- **An agent's work shows as the agent's.** Suggestions, comments,
  issues and reviews sent with a personal token or a connected app keep
  what sent them (`via`, migration 0021), returned on suggestions, their
  conversation, issues, history and commits, and shown on the site with
  the agent mark: "Claude · for @you" (Hebrew too).

- **Organizing the catalog.** Sefarim moved between sets, sets under other
  sets or up a level, sichos to another sefer; names and addresses
  changed; lists put in a new order by dragging or the keyboard; new sets
  made and empty ones removed; duplicates merged (their sichos, printings
  and links moving over) and sefarim split. Each plan is one suggestion,
  however many items it touches, previewed item by item first; old
  addresses redirect once it is approved, a merged item's to the one kept.
  On the site: "Organize" on the library, every set and every sefer
  (`/organize`). In the API: `GET /v1/tree`, `POST /v1/organize/preview`,
  `POST /v1/organize`, and `detail.mergedInto` on a merged item's 404. For
  agents, the MCP tools `get_tree`, `preview_organize`, `organize`,
  `move_items`, `move_up`, `rename_item`, `reorder_children`, `create_set`,
  `delete_set` and `merge_items`. Sets and sefarim take an `order` among
  their siblings (built-in schemas, version 8); migration 0022 keeps where
  merged items went.
- **Ready for search engines and crowds.** Sitemaps a page of 10,000 items
  at a time in both languages, with when each item last changed
  (`/sitemap.xml`; the API's new `/v1/sitemap` and
  `/v1/sitemap/{type}/{page}`); every page with its preview picture (a
  sefer's shaar), Twitter card, and schema.org data (Book, Event with its
  recordings as AudioObjects, BreadcrumbList); a robots.txt that keeps
  crawlers out of what is personal and endless. Pages and the API's
  public reads are kept at Cloudflare's edge, so a burst of readers or a
  crawler mostly never reaches the database; searching has its own
  allowance per address (60 a minute).
- **Covers from linked PDFs.** A sefer whose PDF is only linked (a scan on
  Drive, a HebrewBooks printing) gets its title page as a cover too; the
  cover source list (`/v1/works/{id}/cover`) now names `linked` sources and
  a `publication` kind. The PDF itself stays a link.
- **API v1 (1.0.0), declared stable.** Every route is in
  `/openapi.json` (OpenAPI 3.1), and a test fails when one is not.
- **Personal API tokens** (`rhp_…`): made and revoked on the account page,
  with the `read` or `read` and `write` scopes and an optional end date;
  only a hash is kept. Scripts and AI agents send suggestions that are
  reviewed like anyone's.
- **One error shape** everywhere: `{ "error": "<code>", "message": "…" }`,
  the code fixed per status (`not-found`, `invalid`, `rate-limited` …).
- **Cursor paging** (`cursor`, answered with `next` and a `Link` header)
  on entities, children, commits and suggestions. The older `after` and
  `since` still work.
- **ETags and 304s** on public reads; `Vary` and `Cache-Control` that keep
  personal answers out of shared caches.
- **CORS** for every origin on reads, and for writes with a token.
- **Rate limits** by address (300 a minute) and by token (1,200 a
  minute), with `RateLimit-Policy` and `Retry-After`.
- **An MCP server** at `https://api.rebbehub.org/mcp` for AI agents:
  search, get an item, list its children, get its text (machine words
  marked), and suggest a fix with a token.
- **`/llms.txt` and `/llms-full.txt`** on the site and the API.
- **Developer docs** at `/developers`, drawn from `docs/developers/`, with
  an interactive reference built from the OpenAPI document.
- **`@rebbehub/client`**, a small typed TypeScript client generated from
  the OpenAPI document.
- `docs/configuration.md`: every setting a deployment changes, by name.
- `CHANGELOG.md`, and issue links to the site's own report form and the
  developer docs.

### Changed

- **Large Suggestions are reviewable.** `GET /v1/suggestions/{id}` gives
  a page of its items at a time: 25 unless `limit` says (at most 200),
  from `offset`, with `total`, `offset`, `limit` and `next` (where the
  next page starts, or null). Its new `summary` groups every item by how
  it changes (the same fields, changed the same way: "500 events: links
  on the media proxy became links on Drive"), with a few examples each,
  and `people` says whether the author is a bot. Main's versions are
  read for all the items in a few queries, not a few per item. The list
  (`GET /v1/suggestions?status=…`) gives each Suggestion's `items` (how
  many it changes) and `people`. A caller that read every item in one
  answer asks for `limit=200` and follows `next`. The review page draws
  the queue from the list and reads each Suggestion's changes as it
  comes into view, with "Show more"; a bot's Suggestion is shown as the
  bot's, marked as a machine's work until a person approves it, and
  Approve and Send back take in the whole Suggestion. A Suggestion with
  no #number (an import) opens by its id: `/review?s={id}`.

- Importers store a PDF on Google Drive at its own Drive address
  (`https://drive.google.com/file/d/<id>/view`), the mafteiach's and
  Otzros HaRebbe's link, not the media proxy's; an Otzros page has one
  edition, its Drive file. JEM's recordings still play through the proxy.
- Running an importer again leaves an item people moved to a new path, or
  deleted, where they left it, and a sefer's Sets as people sorted them.
- `rebbehub reading-copies make` reads the archive's list from the
  archive's own bucket, not from Sichos-Kodesh's pack API.

- **The MCP server's writing tools ask for sign-in**: called without a
  token, `suggest_fix` and `open_issue` answer HTTP `401` with
  `WWW-Authenticate` naming the resource metadata (MCP step-up), and with
  a read-only token `403` `insufficient_scope`, instead of a tool error.
  Reading without an account works as before.
- Every `401` answer says `unauthorized` (sign-in routes said
  `bad-request`), and every `429` says
  `rate-limited` (was `too-many`).
- Suspending a person revokes their API tokens.
- `docs/api.md` points to the developer docs for webhooks and OAI-PMH.
- The repository's README, contributing guide, governance (takedowns are
  answered within two weeks, on the site's own form) and security policy
  (tokens, the MCP server and webhooks are in scope) are brought up to
  date; every package names the repository, its home page and where to
  report bugs.

## Before 1.0

Built in phases, as [docs/roadmap.md](docs/roadmap.md) records: the data
model, the versioned catalog engine and its importers (phase 0); the
public read API, search, the git mirror, signed dumps and the public site
(phase 1); accounts, suggestions, review, trust, follows and reports
(phase 2); and scans, uploads, OCR, transcription and sync, projects, the
Missing board, webhooks, embeds, OAI-PMH, translations, mirrors and search
by meaning (phases 3-6).
