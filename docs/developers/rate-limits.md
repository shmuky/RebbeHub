# Rate limits

The API is free and open; the limits keep it so for everyone.

| Who | Allowed |
| --- | --- |
| Each address (no token) | 300 requests a minute |
| Each API token | 1,200 requests a minute, wherever it is sent from |

- Every answer says the policy: `RateLimit-Policy: "address";q=300;w=60, "token";q=1200;w=60`.
- Past it, the answer is `429` with `{ "error": "rate-limited" }` and
  `Retry-After: 60`. Wait that long; do not retry at once.
- File bytes (`/objects/<sha256>`, asked for in many small ranges while a
  recording plays) are not counted.
- A request with a bad token counts against its address, so guessing
  tokens is slow.
- Some things have limits of their own, whatever the rate: reports and
  takedown requests (10 an hour from an address without an account),
  sign-in links by email, and uploads (a new account waits a day; so many
  files and bytes a day, [accounts](../accounts.md)).

## Being a good citizen

- Send a token when you run a script: you get your own allowance, and a
  way for us to reach you if something goes wrong.
- Use `If-None-Match` ([caching](api.md)): a 304 costs almost nothing.
- For the whole catalog, take a [dump](../mirrors.md) instead of walking
  every item; to keep up after it, follow `/v1/commits` or a
  [webhook](webhooks.md).
- Say who you are in `User-Agent` (`my-app/1.0 (+https://…)`).

## Running your own

On Cloudflare Workers the limits are Cloudflare's rate limiting bindings
(`RATE_LIMIT_ADDRESS`, `RATE_LIMIT_TOKEN` in `services/api/wrangler.toml`,
[configuration](../configuration.md)); without them nothing is counted.
`npm run dev:api` counts nothing unless `RATE_LIMIT=1`.
