# Getting started

Reading needs nothing: no account, no key. Every answer is JSON (unless a
route says otherwise), and every item looks the same:

```json
{ "id": "rh-7k2m9q4d", "type": "event", "path": "/events/5742-05-10", "rev": 22993,
  "data": { "kind": "farbrengen", "date": "5742-05-10", "title": { "he": "יו״ד שבט תשמ״ב", "en": "Yud Shvat 5742" } } }
```

`type` is one of the [kinds of item](../data-model.md); `data` follows
that type's JSON Schema, which `GET /v1/types` serves.

## Search

```sh
curl 'https://api.rebbehub.org/v1/search?q=%D7%99%D7%95%22%D7%93+%D7%A9%D7%91%D7%98+%D7%AA%D7%A9%D7%9E%22%D7%91'
```

```ts
import { RebbeHub } from '@rebbehub/client';

const rh = new RebbeHub();
const { results, date } = await rh.search({ q: 'יו"ד שבט תשמ"ב' });
// date: { key: '5742-05-10', he: 'י׳ שבט תשמ״ב', en: '10 Shevat 5742' }
```

A query that names a Hebrew date, in Hebrew or English (`10 Shvat 5742`),
also answers with the date. `GET /v1/search/moments?q=…` finds the words
inside scans, texts and transcripts (a line on a page, a paragraph at the
moment it is heard); `GET /v1/search/similar?q=…` searches by meaning
where it is switched on.

## One item, by id or by path

```sh
curl https://api.rebbehub.org/v1/entities/rh-7k2m9q4d
curl 'https://api.rebbehub.org/v1/resolve?path=/events/5742-05-10'
```

```ts
const item = await rh.getItem({ id: 'rh-7k2m9q4d' });
const { id } = await rh.resolvePath({ path: '/likkutei-sichos/12/3' });
```

Keep ids, not paths: a path may move (the old one redirects), an id never
does. `?at=<commit>` gives an item as it was then; `/history` every
change, who made it and what changed.

## What an item holds

A sefer's sichos, a text's paragraphs, a farbrengen's recordings:

```sh
curl 'https://api.rebbehub.org/v1/entities/rh-…/children?field=work&type=unit&limit=100'
```

```ts
for await (const unit of rh.all('listChildren', { id: work, field: 'work', type: 'unit' })) {
  console.log(unit.id, unit.data.label);
}
```

Long lists come a page at a time: the answer's `next`, passed back as
`cursor`, gives the next page, and is `null` on the last ([pages](api.md)).

## Events by date

```sh
curl 'https://api.rebbehub.org/v1/events?within=5742-05'      # Shevat 5742
curl 'https://api.rebbehub.org/v1/events?day=05-10'           # 10 Shevat, every year
```

Dates are keys (`5742-05-10`: months count from Tishrei, a leap year's
Adar is `06A`/`06B`); `GET /v1/dates/parse?q=…` reads a date as people
write it.

## The words

- A scan's text, page by page, each line with its proofread level:
  `GET /v1/scans/<id>/text?page=3`. A line nobody has checked is the
  machine's reading (`checked: false`).
- A recording's transcript, each paragraph with when it is heard:
  `GET /v1/recordings/<id>/transcript`.
- A sicha's text: its `text` items (`/v1/entities/<unit>/backlinks?field=unit&type=text`)
  and their paragraphs (`children?field=text&type=segment`).
- A file's bytes, while its rights allow: `GET /objects/<sha256>`, with
  `X-Credit` when the rights ask for credit.

## Keeping up

- `GET /v1/commits?since=<seq>`: every approved change after one, in
  order.
- [Webhooks](webhooks.md): every approved change posted to you.
- [Dumps and the git mirror](../mirrors.md): the whole catalog at once.

## Next

To act as yourself - follow items, send suggestions - make a
[personal API token](auth.md). Before copying words or files anywhere,
read [rights](../rights.md).
