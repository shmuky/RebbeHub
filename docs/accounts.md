# Accounts and signing in

People read, listen and report problems without an account. To suggest a
fix, follow a sefer or join a project, they sign in (the plan, section 7:
a Contributor signs in with a passkey, an email link or Google). Passkeys
are built; Google and email links come next.

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

People, passkeys, sessions and challenges live in the `auth` schema
(migration 0003), apart from the catalog in `public`. The import may
rebuild the catalog and replace every table in `public`
(`scripts/import-catalog.sh`, which leaves `auth` out of the copy);
signing in is not adding to the catalog, and a person's catalog account
(`public.account`, which their suggestions point at) is made again from
`auth.person` whenever they are signed in.
