# RebbeHub for developers

RebbeHub is the open, community-edited index of Chabad Torah and media:
every sefer and printing, every sicha and letter, every farbrengen and
recording, the scans and the texts of each. All of it is open to read
through the API, with no account and no key, and everything people can
do on the site - suggest a fix, fix a line, sync a paragraph - a script
or an AI agent can do through the API too, under the same review.

- **API**: `https://api.rebbehub.org/v1`, described in full by
  [OpenAPI 3.1](https://api.rebbehub.org/openapi.json) and the
  [interactive reference](/developers/reference).
- **For AI agents**: [`/llms.txt`](/llms.txt) and an
  [MCP server](agents.md) at `https://api.rebbehub.org/mcp`.
- **TypeScript**: [`@rebbehub/client`](client.md), a small typed client
  generated from the OpenAPI document.
- **Everything at once**: weekly [signed dumps](../mirrors.md) (SQLite,
  JSON Lines, Parquet), a git mirror, [webhooks](webhooks.md) and
  [OAI-PMH](oai-pmh.md) for libraries.

## Where to start

1. [Getting started](getting-started.md): your first requests, in curl
   and TypeScript.
2. [The data model](../data-model.md): what an item is, ids and paths,
   Hebrew dates.
3. [Tokens and signing in](auth.md): a personal API token, to act as
   yourself.
4. [Sending suggestions](suggestions.md): how a change is made, checked
   and reviewed.
5. [Conventions](api.md): versions, errors, pages, caching, CORS; and
   [rate limits](rate-limits.md).
6. [Rights](../rights.md): what may be copied, and what is only listed.
   Read this before you copy words or files anywhere.

## The promises

- **Ids never change.** `rh-7k2m9q4d` names the same item for good;
  paths (`/likkutei-sichos/12/3`) are readable and may move, with
  redirects.
- **/v1 changes only by adding.** Fields and routes are added, never
  renamed or removed without a new version; see [Stability](api.md).
- **Machine output is labelled.** Words a machine read (OCR) or heard
  (transcription), links it found and summaries it wrote say so
  (`machine: true`, `checked: false`, `origin`) until a person checks
  them. Keep the label wherever you show them.
- **Rights are kept.** Words whose source does not allow copies are
  listed but withheld (`withheld` says why), everywhere: the API, the
  dumps, the MCP server.

The code is [AGPL-3.0](https://github.com/shmuky/RebbeHub/blob/main/LICENSE);
catalog facts are CC0; community text is CC BY-SA 4.0; texts from other
sources keep their own licence (each text's `licence`).
