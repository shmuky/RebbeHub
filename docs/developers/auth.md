# Tokens and signing in

Reading the catalog needs no account. To act as yourself - follow items,
keep your places, send suggestions, fix lines, add webhooks - send a
**personal API token**, or let an app such as Claude **connect with
OAuth**, which you approve on the site.

## Making a token

On your [account page](/account), under *API tokens*: give it a name
(what will use it: "my sync script", "Claude"), pick its scopes, and
optionally when it expires. The token (`rhp_` and 43 letters) is shown
**once**; RebbeHub keeps only its sha256, so it cannot show it again.
Lost it? Revoke it and make another.

| Scope | May |
| --- | --- |
| `read` | read what is yours: what you follow, your places, your webhooks, report inboxes you keep |
| `write` | everything you do on the site: suggestions, fixes to lines and paragraphs, sync, comments, follows, uploads, webhooks |

Send it on every request:

```sh
curl -H "Authorization: Bearer $REBBEHUB_TOKEN" https://api.rebbehub.org/v1/follows
```

```ts
const rh = new RebbeHub({ token: process.env.REBBEHUB_TOKEN });
```

## What a token is

A token **is you**, no more. What it sends goes through the same checks
and the same review as what you do on the site: your suggestion waits for
the set's keepers, your trust level is your own, a new account's holds
and daily limits on uploads apply, and a suspended account's tokens stop
at once.

What a token never does, whatever its scopes: sign in or change how you
sign in (`/v1/auth/*`), make or revoke tokens (`/v1/tokens`), or use the
stewards' tools (`/v1/admin/*`). Those happen on the site's own pages,
signed in with a passkey, Google or an email link ([accounts](../accounts.md)).

- A token that is unknown, revoked or expired is refused (401,
  `unauthorized`), never quietly read as nobody.
- A `read` token that tries to change something is refused (403,
  `forbidden`).
- Up to 20 live tokens per person. The account page shows each one's
  first characters, scopes, when it was made and last used.

## Connecting an app with OAuth

Apps that act for you - Claude on claude.ai, Claude Code, other MCP
clients - need not be handed a token. They connect with OAuth 2.1, the
way the [MCP authorization spec](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
says, and you say yes or no on rebbehub.org's own page. How to connect
Claude step by step is in [AI agents](agents.md).

What happens:

1. The app calls a tool that writes at `https://api.rebbehub.org/mcp`
   with no token (reading needs none) and gets `401` with `WWW-Authenticate: Bearer resource_metadata="https://api.rebbehub.org/.well-known/oauth-protected-resource/mcp", scope="read write"`.
2. That document ([RFC 9728](https://www.rfc-editor.org/rfc/rfc9728))
   names the authorization server, `https://api.rebbehub.org`, whose
   metadata is at `/.well-known/oauth-authorization-server`
   ([RFC 8414](https://www.rfc-editor.org/rfc/rfc8414)).
3. The app uses the https address of its own description as its
   `client_id` (a Client ID Metadata Document, which is what Claude does
   by default), which RebbeHub reads, checks the redirect against, and
   keeps for a day; or it registers at `/oauth/register`
   ([RFC 7591](https://www.rfc-editor.org/rfc/rfc7591), no account
   needed).
4. It sends you to `/oauth/authorize` with PKCE (`S256` only) and
   `resource=https://api.rebbehub.org/mcp`
   ([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)). You land on
   `rebbehub.org/oauth/consent`: signed in, you see the app's name (as it
   calls itself), **the address it will send you back to**, and what it
   may do. Allow or Cancel. An address the app never registered is never
   redirected to.
5. The app trades the code at `/oauth/token` for an access token (`rho_…`,
   an hour) and a refresh token (`rhr_…`). Each refresh gives a new pair
   and the old refresh token stops working; a refresh token unused for 90
   days expires. A code works once, within ten minutes; a code used twice
   ends the connection made with it.

| Scope | May |
| --- | --- |
| `read` | always given: the catalog, and what is yours |
| `write` | send suggestions, fixes, issues and comments as you; you may untick it on the consent page |

A token given for `https://api.rebbehub.org/mcp` works only at the MCP
server (and the calls its tools make); one given for
`https://api.rebbehub.org` works on the whole API like a personal token.
Like a personal token, a connection **is you**, no more, and never opens
sign-in, tokens or stewards' tools, nor answers another app's request to
connect.

Connections are listed on your account page beside your tokens, by the
app's name and where it lives; **Disconnect** ends one at once. An app
may also end its own at `/oauth/revoke`
([RFC 7009](https://www.rfc-editor.org/rfc/rfc7009)). Suspending an
account ends all its connections. Nothing here is ever kept in a cache:
every OAuth and MCP answer says `no-store`, and none goes through
Cloudflare's edge cache.

What a token or a connected app sends is yours, and marked as sent by it:
each suggestion, comment, issue and review keeps `via` (the token or
app's name and id), and the site shows it as "Claude · for @you" with the
agent mark, never as your own hands ([AI agents](agents.md)).

## Keeping it safe

- Keep it out of code and out of git: an environment variable or a secret
  store. Anyone holding it acts as you.
- Give each script or agent its own token, with `read` alone unless it
  must write, and an expiry when it is for a while.
- Approve a connection only when you started it yourself, and check where
  it sends you back: `claude.ai` for claude.ai, `localhost` for Claude
  Code on your computer.
- Revoke it on the account page the moment you think it leaked. Report a
  leak affecting others through [SECURITY.md](https://github.com/shmuky/RebbeHub/blob/main/SECURITY.md).

## The site's session

The site itself signs in with a session cookie (HttpOnly, `SameSite=Lax`)
that works only from rebbehub.org's own pages: another site's page cannot
act for a signed-in reader, and the API never allows cookies across
sites (CORS without credentials). Scripts and other sites use tokens.
