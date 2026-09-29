# Webhooks

Every change approved into the catalog can be posted to an address of
yours, signed, within a few minutes.

## Adding one

On your [account page](/account) (*For developers: webhooks*), or with a
[token](auth.md) that may write:

```sh
curl -X POST https://api.rebbehub.org/v1/webhooks -H "Authorization: Bearer $REBBEHUB_TOKEN" \
  -H 'Content-Type: application/json' -d '{ "url": "https://example.org/rebbehub-hook" }'
```

```json
{ "id": 3, "url": "https://example.org/rebbehub-hook", "secret": "…" }
```

The `secret` is shown this once: keep it to check signatures. Up to five
addresses per person; `GET /v1/webhooks` lists yours, `DELETE
/v1/webhooks/<id>` removes one.

## What arrives

Every merge from then on, in order and at least once, every few minutes:

```http
POST <your address>
Content-Type: application/json
X-RebbeHub-Signature: sha256=<HMAC-SHA256 of the body, keyed with the hook's secret>

{ "commits": [ { "seq": 9, "at": "…", "message": "…", "author": "…", "mergedBy": "…",
                 "changes": [ { "id": "rh-…", "type": "event", "path": "/events/…", "rev": 22993, "data": { … } } ] } ] }
```

- `data: null` means the item was deleted.
- Words withheld for rights are left out, as in `/v1/commits`.
- Answer with a 2xx status. Anything else is tried again; after 20
  failures in a row the hook is switched off (the account page says so).
- Keep the last `seq` you handled: a commit may come twice.

## Checking the signature

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

function signed(body: string, header: string | null, secret: string): boolean {
  const expected = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  return header !== null && header.length === expected.length && timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}
```

Check it against the raw body, before parsing it.

## Without a server

`GET /v1/commits?since=<seq>` answers the same commits, a page at a time
([pages](api.md)): poll it instead when you cannot receive posts.
