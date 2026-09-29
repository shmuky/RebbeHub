# Accounts and signing in

People read, listen and report problems without an account. To suggest a
fix, follow a sefer or join a project, they sign in (the plan, section 7:
a Contributor signs in with a passkey, an email link or Google). All
three are built; email links and Google show once their keys are set.

## Passkeys

No password to choose, forget or steal. A person's phone or computer makes
a passkey for RebbeHub alone and opens it with their fingerprint, face or
screen lock; RebbeHub keeps only its public key.

- **New account** (`/signin`): a name to be known by and a handle
  (suggested from the name, see [Handles](#handles-and-mentions)), then
  the device makes the passkey. The account id is `u-` and ten letters
  and digits.
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

## Email link

Shown on `/signin` once the API can send email (`RESEND_API_KEY`); until
then it is hidden, and so are email updates.

- **Asking**: the person gives an address; the API sends a link to
  `/signin?email-token=…`, good once, for 20 minutes. The answer is the
  same whether or not the address has an account, so nobody learns who
  does. One address is sent at most 5 links an hour, the whole site 300.
- **Arriving**: the page says what the link is for and asks once more
  (a new person gives the name they go by) before the link is used, so
  a mail program that opens links to check them cannot use it up.
- **The first time**, a new account is made. **After that**, the same
  address signs into the same account. An address that is already the
  email of a linked Google account signs into that account, and a new
  Google sign-in whose email is already someone's address joins theirs.
- **Signed in already** (`/account`, "Email addresses"): a link sent to a
  new address adds it to this account; an address that is someone
  else's is refused. Opened in another browser, the link adds the
  address without signing that browser in.
- Kept: the address (`auth.email_address`) and each link's token hash,
  for a day, for the hourly counts (`auth.email_link`, migration 0011).

## Email updates

On `/account`, once email is switched on: off (the default), a daily
digest, or as soon as something changes, to any of the person's
addresses. The API's cron (every five minutes) writes what changed in the
sefarim, farbrengens and sets they follow since they were last told,
leaving out their own changes; a daily digest waits a day from the last
one. Every email has a link that stops them without signing in
(`/account?unsubscribe=…`) and a one-click `List-Unsubscribe` header.
Kept in `auth.notification_setting` (migration 0011).

**Switching email on** (once):

1. At [Resend](https://resend.com), add and verify the domain
   `rebbehub.org` (its DNS records in Cloudflare), and make an API key
   with sending access.
2. In Cloudflare, Workers, `rebbehub-api`, Settings, Variables and
   Secrets: add the secret `RESEND_API_KEY`. Optionally the variable
   `EMAIL_FROM` (default `RebbeHub <no-reply@rebbehub.org>`), an address
   on the verified domain. Email sign-in appears on the next request.

Locally, `DEV_EMAIL=1 npm run dev:api` prints each email (with its link)
instead of sending it.

## The inbox

Every signed-in person has an inbox (`/inbox`, the bell in the top bar
with its unread count), as GitHub's notifications:

- **Why a line is there**: they were @mentioned; asked to review a
  suggestion (the keepers of its sets are asked on their own when it is
  sent, as CODEOWNERS are, and asked again when it comes back after they
  requested changes); an issue was assigned to them; something happened
  to their own suggestion or issue (a review, a comment, merged, closed);
  or in a conversation they follow.
- **Following** a conversation is automatic for its author, anyone who
  writes in it, reviews it, is mentioned, asked or assigned; anyone can
  follow or stop following from its side column. A new suggestion or
  issue about an item or set someone follows also comes to them.
- **One line per conversation and reason** while it is unread: a busy
  conversation counts up ("3 times") instead of filling the inbox. The
  person's own acts never come to them, nor anything in a conversation
  they may not read (a private issue).
- **Read**: opening the conversation reads its lines; "Done" reads one
  without opening it; "Mark all as read".
- **By email**: when email updates are on (above), the next update also
  carries the inbox lines not yet read, each once. With email off, the
  inbox is the only place they are.

Kept in `auth.notification` (migration 0016), with the people, so a
rebuild of the catalog never empties it.

## One person, one account

- Signed in, a person adds a passkey, an email address or links Google
  from `/account`; `/signin` offers them nothing else, and the API
  refuses to make a second account for someone already signed in.
- An email address belongs to one person, whether it came by email link
  or with Google: it always signs into that person's account.
- `/account` shows the account number (`u-…`), so two people with the
  same name are never confused.
- A steward's mark is kept on the person (`auth.person.steward`,
  migration 0005) and copied to their catalog account whenever they are
  signed in, so a rebuild of the catalog never takes it away.

## Handles and mentions

Every person has a handle (`@mendy`), unique on the site whatever its
case, used for @mentions and for their page at `/u/<handle>`:

- **Chosen at sign-up** (passkey or email link), suggested from the name
  as it is typed (Hebrew names spelt the way people spell them in Latin
  letters: `מנחם מענדל` suggests `menachem-mendel`), and checked as it
  is typed. Left empty, or signing up with Google, one is made from the
  name.
- **Its shape**: 2 to 39 Latin letters, digits and single hyphens, not
  starting or ending with a hyphen.
- **Reserved**: the site's own words (`admin`, `issues`, `inbox`,
  `suggestions`, `system`, `steward`, `support` and the like, the list in
  `packages/core/src/usernames.ts`), and handles shaped like an account
  id (`u-…`), an item id (`rh-…`) or a made-up one (`reader-…`).
- **Changing it** (`/account`): at most once a day (a change of case
  only is always allowed). The old handle keeps leading to the person:
  `/u/<old>` redirects for good, and @mentions already written with it
  still reach them. Nobody else can take an old handle; its owner can
  take it back.
- **Accounts from before handles** were given one by migration 0016,
  from their name where it makes a free handle, or `reader-` and their
  account number where it does not; they can choose their own.

**A person's page** (`/u/<handle>`) shows their name, handle, role
(steward, Trusted), when they joined, their counts (suggestions and how
many were approved, reviews, issues, comments) and their recent public
activity. It never shows an email address, and nothing from a private
issue.

**@mentions** work wherever people write: a suggestion's description, a
comment or review, an issue and its comments, and talk pages. The
writing box suggests people as `@` is typed (those already in the
conversation first). The person mentioned gets an inbox line (and email,
if they chose updates) and follows the conversation from then on, unless
it is a private issue they may not read. A handle nobody has tells
nobody; nor does a mention inside `code`, or in an email address. `#12` points at suggestion or issue 12 (they share
one numbering), and shows in its timeline as "mentioned this in";
`Fixes #12` in a suggestion's description closes issue 12 when the
suggestion is merged.

## Stewards and platform admins

`/admin` is the stewards' page: everyone with an account, the reports
readers sent, and takedown requests.

- **Stewards** see people, suspend and restore accounts (a suspended
  account suggests nothing), and resolve or dismiss reports. Reports are
  read only by stewards and, for their set, its keepers.
- **Takedowns** (`/takedown`, a public form, no account): each request is
  a Report (reason `rights`) on the item, with the asker's name and
  address kept beside it for stewards alone (`takedown`, migration 0011),
  and a receipt by email once email is on. Under *Takedowns* a steward
  sees the files the item holds (its own, a farbrengen's recordings, a
  sefer's scans) and takes each down in one click: it moves to
  `preserved`, stops being served at once, a private copy is kept, and
  the audit log says who and for which request. The form promises an
  answer within two weeks (`TAKEDOWN_RESPONSE_DAYS`, packages/core).

## Trust

Trust is earned (the plan, section 7): 20 approved suggestions and none
reverted make a contributor **Trusted**, shown on their account page.

- A Trusted person's line fixes (text pages, paragraphs, sync spans) in
  sets that are all *open* go live at once and wait under *Went live,
  reviewed after* on `/review`, where a keeper keeps or undoes them.
  Catalog facts stay moderated for everyone.
- **Uploads** wait for new accounts: a person who signed up less than 24
  hours ago adds files once that day has passed or a suggestion of theirs
  is approved. After that, contributors add 20 files (1 GB) a day,
  Trusted people 200 (10 GB); stewards and bots are not limited
  (`uploadAllowance`, packages/core/src/permissions.ts).

## The reviewer's advice

Each suggestion waiting for review (and each live change waiting to be
reviewed after) gets a few sentences from a language model on what it
changes and what to check, shown on `/review` marked as machine-written:
advice only, never a merge; a person approves or sends back. It is
written by the API's cron, a few suggestions a run, again whenever a
suggestion is sent again. Words whose rights keep them home are not sent
to the model. The model is Llama 3.3 70B on Cloudflare Workers AI, and it
writes in English.

**Switching it on**: add the secrets `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_AI_TOKEN` (an API token with *Workers AI: Read* and *Edit*)
to `rebbehub-api`. Without them no advice is written and nothing shows.
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

## API tokens

A script or an AI agent acts for a person with a personal API token
(`rhp_…`), made and revoked on `/account` (*For developers: API tokens*)
and only there: a token cannot make, list or revoke tokens, sign in, or
use the admin routes. Each has a name, its scopes (`read`, or `read` and
`write`) and, if chosen, an end date. It is shown once; only its sha256
is kept (`auth.api_token`, migration 0018), with when it was last used. A
suggestion sent with one is the person's own and is reviewed like any
other. Suspending a person revokes all their tokens. How to use one:
[developers/auth](developers/auth.md).

## Where it is kept

People, passkeys, Google accounts, email addresses and links, email
update settings, sessions and challenges live in the `auth` schema
(migrations 0003, 0004 and 0011; API tokens, 0018), apart from the catalog in `public`. The import may
rebuild the catalog and replace every table in `public`
(`scripts/import-catalog.sh`, which leaves `auth` out of the copy);
signing in is not adding to the catalog, and a person's catalog account
(`public.account`, which their suggestions point at) is made again from
`auth.person` whenever they are signed in.

Handles and the handles people used to have (`auth.person.username`,
`auth.username_redirect`) and inbox lines (`auth.notification`) are kept
there too (migration 0016). The numbering of suggestions and issues
(`#12`) is done by a function kept in `auth` (`auth.number_thread`), so a
rebuilt catalog keeps its numbers and goes on from them.

Where a signed-in person stopped reading and listening is kept there too
(`auth.reading_place`, migration 0014: the latest 60, a PDF's page or a
farbrengen's moment), so a rebuild of the catalog never loses it; it is
never part of the exports.
