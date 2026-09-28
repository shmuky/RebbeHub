# Accounts and signing in

People read, listen and report problems without an account. To suggest a
fix, follow a sefer or join a project, they sign in (the plan, section 7:
a Contributor signs in with a passkey, an email link or Google). Passkeys
and Google are built; email links come next.

## Passkeys

No password to choose, forget or steal. A person's phone or computer makes
a passkey for RebbeHub alone and opens it with their fingerprint, face or
screen lock; RebbeHub keeps only its public key.

- **New account** (`/signin`): a name to be known by, then the device makes
  the passkey. The account id is `u-` and ten letters and digits.
- **Signing in**: the device offers the passkeys it holds for the site.
- **Account** (`/account`): the person's name, their passkeys, signing out.

The ceremonies are WebAuthn, verified with SimpleWebAuthn
(`services/api/src/auth.ts`). The relying party is the site's domain,
from `SITE_URL` in `services/api/wrangler.toml` (`rebbehub.org`); a
passkey made there works only there.

## Google

Shown on `/signin` once the API has its Google sign-in keys; until then
sign-in is by passkey alone.

- **The first time**, a new account is made with the person's name on
  Google. **After that**, the same Google account signs the same person in.
- **Signed in already** (`/account`, "Link a Google account"): the Google
  account is added to theirs, so either way in reaches the same account.
- The browser goes to Google from `/_/auth/google/start` and comes back to
  `/_/auth/google/callback`. The round trip carries a one-time state, tied
  to the browser that left by a ten-minute cookie (`__Host-rh_google`),
  with a nonce and PKCE. The ID token comes straight from Google's token
  endpoint; its audience, issuer, expiry and nonce are checked.
- Kept: Google's id for the account (`sub`) and its email, shown only to
  the person (`auth.google_account`, migration 0004).

**Switching it on** (once):

1. In Google Cloud Console, APIs & Services, Credentials: create an OAuth
   client ID of type "Web application". Authorised JavaScript origin
   `https://rebbehub.org`; authorised redirect URI
   `https://rebbehub.org/_/auth/google/callback`. On the consent screen,
   the app name RebbeHub and the scopes `openid`, `email`, `profile`.
2. In Cloudflare, Workers, `rebbehub-api`, Settings, Variables and
   Secrets: add the secrets `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
   from that client. The button appears on the next request.

For local development, set the same two in the environment of
`services/api/src/node.ts`, with `http://localhost:5173/_/auth/google/callback`
as a redirect URI on the client.

## One person, one account

- Signed in, a person adds a passkey or links Google from `/account`;
  `/signin` offers them nothing else, and the API refuses to make a
  second account for someone already signed in.
- `/account` shows the account number (`u-…`), so two people with the
  same name are never confused.
- A steward's mark is kept on the person (`auth.person.steward`,
  migration 0005) and copied to their catalog account whenever they are
  signed in, so a rebuild of the catalog never takes it away.

## Stewards and platform admins

`/admin` is the stewards' page: everyone with an account, and the
reports readers sent.

- **Stewards** see people, suspend and restore accounts (a suspended
  account suggests nothing), and resolve or dismiss reports. Reports are
  read only by stewards and, for their set, its keepers.
- **Platform admins** are stewards who also appoint and remove stewards
  and admins, and see the Google email of each account. No steward can
  suspend or demote an admin, and an admin never removes their own admin
  (`auth.person.admin`, migration 0006).

## Sessions

- The site passes `/_/auth/*` through to the API's `/v1/auth/*`, so the
  browser talks to rebbehub.org alone and the session cookie is the
  site's own: `__Host-rh_session`, HttpOnly, Secure, SameSite=Lax, 60 days
  from last use.
- Only a hash of the cookie's token is kept (`auth.session`).
- A request that changes anything is taken only from the site's own pages
  (its `Origin`), so another site cannot act for a signed-in reader.
- Pages are the same for everyone and cached as such; who is signed in is
  asked by the browser after the page loads (`/_/auth/me`, never cached).

## Where it is kept

People, passkeys, Google accounts, sessions and challenges live in the
`auth` schema (migrations 0003 and 0004), apart from the catalog in `public`. The import may
rebuild the catalog and replace every table in `public`
(`scripts/import-catalog.sh`, which leaves `auth` out of the copy);
signing in is not adding to the catalog, and a person's catalog account
(`public.account`, which their suggestions point at) is made again from
`auth.person` whenever they are signed in.
