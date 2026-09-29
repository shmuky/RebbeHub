# Tokens and signing in

Reading the catalog needs no account. To act as yourself - follow items,
keep your places, send suggestions, fix lines, add webhooks - send a
**personal API token**.

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

## Keeping it safe

- Keep it out of code and out of git: an environment variable or a secret
  store. Anyone holding it acts as you.
- Give each script or agent its own token, with `read` alone unless it
  must write, and an expiry when it is for a while.
- Revoke it on the account page the moment you think it leaked. Report a
  leak affecting others through [SECURITY.md](https://github.com/shmuky/RebbeHub/blob/main/SECURITY.md).

## The site's session

The site itself signs in with a session cookie (HttpOnly, `SameSite=Lax`)
that works only from rebbehub.org's own pages: another site's page cannot
act for a signed-in reader, and the API never allows cookies across
sites (CORS without credentials). Scripts and other sites use tokens.
