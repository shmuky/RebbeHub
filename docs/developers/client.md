# The TypeScript client

`@rebbehub/client` (in this repository at `packages/client`) is a small
typed client for the API, generated from its OpenAPI document: one method
per operation, named by its `operationId`, taking one object of its path
and query parameters (and `body`), and answering the typed JSON. It has
no dependencies and runs wherever `fetch` does: Node 18+, browsers,
Workers, Deno, Bun. Its licence is the site's own,
[AGPL-3.0](https://github.com/shmuky/RebbeHub/blob/main/LICENSE), and the
package carries a copy.

```ts
import { RebbeHub, RebbeHubError } from '@rebbehub/client';

const rh = new RebbeHub({
  token: process.env.REBBEHUB_TOKEN, // optional: reading needs none
  userAgent: 'my-app/1.0',
});

const { results } = await rh.search({ q: 'לקוטי שיחות חלק יב', limit: 5 });
const item = await rh.getItem({ id: results[0]!.id });
const page = await rh.scanText({ id: 'rh-…', page: 3 });
```

## Pages

`pages` walks a paged list page by page; `all` gives its items one by
one, fetching pages as they are needed:

```ts
for await (const commit of rh.all('listCommits', { since: 1200 })) {
  console.log(commit.seq, commit.message);
}
```

## Errors

Every error the API answers is thrown as a `RebbeHubError`, with the
HTTP `status`, the error's `code` (`not-found`, `rate-limited`…),
`message`, `detail`, and for a 429 `retryAfter` in seconds:

```ts
try {
  await rh.getItem({ id: 'rh-zzzzzzzz' });
} catch (error) {
  if (error instanceof RebbeHubError && error.code === 'not-found') …
}
```

## Options

| Option | Default |
| --- | --- |
| `baseUrl` | `https://api.rebbehub.org` (`http://127.0.0.1:8787` for `npm run dev:api`) |
| `token` | none |
| `fetch` | the global `fetch` (pass a Worker's service binding, or a test's) |
| `userAgent` | added to `User-Agent` |

## Keeping it in step

`packages/client/src/generated.ts` is written by
`npm run generate -w @rebbehub/client` from `services/api/src/openapi.ts`,
and a test fails when it is not up to date, so the client changes with
the API in the same pull request. The site's own sign-in and the
stewards' tools are left out: a token cannot use them.
