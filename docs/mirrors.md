# Mirrors: keeping a copy of RebbeHub

The plan's third promise is that the catalog belongs to the community and
can never be locked away. Everything needed to keep a full copy is public,
at addresses that do not change, and anyone may serve that copy from a
site of their own. The site's [Download and mirror](https://rebbehub.org/mirrors)
page shows it all in words.

## What there is

| What | Where | Licence |
| --- | --- | --- |
| The git mirror: one JSON file per item, texts as Markdown, sync as WebVTT, one git commit per approved change | `git` in `/v1/mirrors` | facts CC0, community text CC BY-SA, source texts their own |
| Catalog editions: the whole catalog at one commit, weekly, as SQLite and JSON Lines, plus the Sichos-Kodesh release | `/v1/editions`, files at `/dumps/<tag>/<name>` | the same |
| Each edition's signed manifest and checksums | `/v1/editions/<tag>/manifest.json`, `/v1/editions/<tag>/SHA256SUMS` | CC0 |
| The release keys (public halves) | `keys` in `/v1/mirrors` | - |

Files themselves (scans, recordings) are not in the dumps or the git
mirror, only their hashes and rights; words whose source forbids copies
are left out and listed as withheld ([rights](rights.md), Exports).

`GET https://api.rebbehub.org/v1/mirrors` answers with all of it:

```json
{
  "git": ["https://github.com/rebbehub/catalog.git"],
  "dumps": "https://api.rebbehub.org/dumps",
  "keys": [{ "alg": "ed25519", "keyId": "…", "publicKey": "…" }],
  "editions": [{
    "tag": "2026.40", "commit_seq": 1234, "created_at": "…",
    "dumps": {
      "files": [{ "name": "rebbehub-2026.40.sqlite", "bytes": 123, "sha256": "…", "url": "https://api.rebbehub.org/dumps/2026.40/rebbehub-2026.40.sqlite" }],
      "manifest": "https://api.rebbehub.org/v1/editions/2026.40/manifest.json",
      "sha256sums": "https://api.rebbehub.org/v1/editions/2026.40/SHA256SUMS",
      "signature": { "alg": "ed25519", "keyId": "…" }
    }
  }]
}
```

An edition is tagged before its dumps are made; until they are, its
`dumps` is `null`.

## Running a mirror

```sh
git clone https://github.com/shmuky/RebbeHub && cd RebbeHub && npm ci
npm run rebbehub -- mirror-pull --out /srv/rebbehub --key <the release public key>
```

`mirror-pull` reads `/v1/mirrors`, and for every edition (or `--tag
2026.40`, or `--tag latest`) fetches the signed manifest, checks its
Ed25519 signature against the key you pinned, downloads each file,
checks its sha256 against the manifest, and only then moves it into place.
A file that does not match is never kept, and the run fails loudly.
Editions already there and whole are left alone, so run it from cron as
often as you like:

```cron
17 * * * *  cd /opt/RebbeHub && npm run rebbehub -- mirror-pull --out /srv/rebbehub --key <key> >> /var/log/rebbehub-mirror.log 2>&1
```

The folder it leaves is ready to serve as it is, with any web server:

```
/srv/rebbehub/editions.json            what is here, newest first, and where the git mirror is
/srv/rebbehub/2026.40/manifest.json    the edition's signed manifest
/srv/rebbehub/2026.40/SHA256SUMS       for sha256sum -c
/srv/rebbehub/2026.40/rebbehub-2026.40.sqlite …
```

Pin the key. Without `--key`, `mirror-pull` trusts the keys the API names
and says so; that checks the files arrived whole, but not that they came
from RebbeHub's release key. `--api` pulls from another mirror's API
instead; `--allow-unsigned` keeps editions whose manifest is unsigned
(never by default).

The git mirror is mirrored like any git repository:

```sh
git clone --mirror https://github.com/rebbehub/catalog.git && cd catalog.git && git remote update   # from cron
```

By hand, without this repository, one edition:

```sh
curl -O https://api.rebbehub.org/v1/editions/2026.40/SHA256SUMS
curl -O https://api.rebbehub.org/dumps/2026.40/rebbehub-2026.40.sqlite   # and the other files it lists
sha256sum -c SHA256SUMS
```

## Being listed

A mirror that keeps a full copy and wants to be listed on `/mirrors` asks
in an issue; a steward adds it to the API's `others` list.

## Publishing (stewards)

Each week ([operations](operations.md), Editions and dumps):

```sh
rebbehub edition --by shmuly
rebbehub dump --tag 2026.40 --out dumps/2026.40 --key release-key.json --upload
```

`--upload` puts the files and the manifest in the public bucket at
`dumps/<tag>/` (with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`)
before recording the manifest, so an edition lists its files only once
they can be fetched. The API serves only the files an edition's manifest
names, and they never change.

The API's settings for mirrors are public values, in
`services/api/wrangler.toml` `[vars]` once they exist:

| Variable | Is |
| --- | --- |
| `CATALOG_GIT_URL` | where the git mirror is cloned from (comma separated for several) |
| `RELEASE_PUBLIC_KEYS` | the release keys' public halves, base64 (comma separated); printed by `rebbehub keygen` |
| `DUMPS_BASE_URL` | where dumps are served, when not the API's own `/dumps` |

Until they are set, `/v1/mirrors` lists no git mirror and no keys, and
the page says they are coming. The secret half of the release key never
goes in any file in this repository or in Cloudflare; it stays with the
steward who signs.
