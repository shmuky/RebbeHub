# Changelog

What changed, for the people who use RebbeHub and the programs that read
it. The catalog itself changes every day and is not listed here: its
history is on every page, in `/v1/commits` and in the git mirror.

The API follows [semantic versioning](https://semver.org): nothing under
`/v1` is removed or changes meaning; new routes and fields may be added at
any time. `@rebbehub/client` carries the API's version.

## Unreleased

### Added

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
  what sent them (`via`, migration 0022), returned on suggestions, their
  conversation, issues, history and commits, and shown on the site with
  the agent mark: "Claude · for @you" (Hebrew too).

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
