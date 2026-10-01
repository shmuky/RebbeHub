# Changelog

What changed, for the people who use RebbeHub and the programs that read
it. The catalog itself changes every day and is not listed here: its
history is on every page, in `/v1/commits` and in the git mirror.

The API follows [semantic versioning](https://semver.org): nothing under
`/v1` is removed or changes meaning; new routes and fields may be added at
any time. `@rebbehub/client` carries the API's version.

## Unreleased

### Added

- **A sefer's printings in one call.** The MCP tool `list_printings`
  lists every printing of a sefer by volume, each with its volume and
  where its scans come from (HebrewBooks, a Drive file of אוצרות הרבי),
  with the links; printings without a readable path too. `search` takes
  `work` (`/v1/search?work=rh-…`: one sefer's items alone) and names each
  printing's volume and source, since printings of one volume share a
  name.
- **Likkutei Sichos' whole subject index on one page** (`/mafteach`).
  Every topic of the volumes' indexes once, by letter or by search (a
  topic's name first, then words from its places). Under each topic, each
  volume's pages, the index's words for each place, and links to the
  sicha: its PDF open at the page, and its text here. Nothing is stored:
  it is gathered from the index pages, so a fix there shows at once;
  machine-read volumes stay labelled. `GET /v1/mafteach` gives the same.

- **Tanya as the book prints it.** Every page of Tanya, and the day's
  Tanya on `/daily`, now opens "As printed": the title page centered in
  its sizes, each approbation under its heading with the signature apart,
  the compiler's foreword under its title, and each chapter one justified
  block that opens with "פרק א" and its first word large, a new paragraph
  only where the book starts one. Without nikud, as printed; a button puts
  it back. Hebrew, English and side by side are still a tap away.
- **A recording's words have their own tab.** A farbrengen or recording
  with a transcript has a Text tab (`?tab=text`) where its words are
  checked and fixed; the main tab only plays and follows them, and its
  Edit button opens the Text tab. The editor is one view for everyone:
  what a person may not do is simply not offered. Paragraphs checked all
  exact, with no unclear words and no waiting fix, are hidden the next
  time (a line says how many, with a link to show them). The words-fix
  box floats at the foot of the screen, its input with it; the "All exact"
  tools stay in place.
- **Reviewers mark a paragraph all exact from its suggestion.** A
  transcript fix its suggester found all exact says so, and its reviewer
  approves it as all exact in one tap; a fix of only some words can be
  approved and marked all exact together. The talk on the paragraph's
  unclear words shows under it, with a link to the recording's talk page.

- **A page number in a subject index names its sicha.** Hover a link that
  carries a title (the index's page numbers do: `ח"א ע' 119 (וארא)`) and
  the tooltip says which sicha it opens.
- **Pages gathered from others stay off the checking list.** `/check`
  and `machine_to_check` list a machine-read page only when its version
  has its source's address; a page merged from others (the full subject
  index, gathered from its printed books) is checked where its words came
  from.
- **Checking a transcript: hear again, the speed, and the page follows
  the words.** While checking, the player bar plays the last five
  seconds again and slows down (0.5×, 0.75×) or speeds up (1.25×, 1.5×);
  on leaving the editor the speed is back to normal, and the rest of the
  site never offers it. The open paragraph's tools, and the fixing box's
  Save, float at the foot of the screen however long the paragraph, and
  the page keeps the word being said in view (a few seconds after you
  scroll on your own, it follows again). Opening the editor while the
  recording plays starts at the paragraph being heard.
- **The home page's progress moves with every paragraph.** The bar
  toward the next transcription model counts each farbrengen by how much
  of it is checked, says how many paragraphs were checked so far, and
  shows your own checks as soon as you are back on the page. API:
  `/v1/machine/training`'s `goal` also has `farbrengens.progress` and
  `paragraphs.checked`.
- **The day's shiurim, Chitas and Rambam, on the daily page.** `/daily`
  opens with the day's shiurim at a glance: Chumash with Rashi (the
  week's parsha, an aliyah a day), Tehillim (the monthly cycle, with
  Elul's three more), Tanya, and the Rambam's three tracks (three
  chapters, one chapter, Sefer HaMitzvos), each a link to its words, with
  a box to tick once learned and a count of days in a row (kept in the
  browser only). Each goes to its page on RebbeHub once the catalog has
  it (below), to Sefaria until then. API: `/v1/daily` also names
  `chumash`, `tehillim` and `rambam`, in Hebrew, by Sefaria's references
  and by their pages here (`path`, `paths`, null until imported).
- **Hayom Yom's shiurim go to their words.** Each day's Chumash (with
  Rashi) and Tehillim line opens that day's portion on Sefaria, and its
  Tanya line opens its chapter on RebbeHub where the day starts. A day's
  notices the book prints right after the shiurim are set there, all
  notices in italics, and each paragraph's first line is indented, as
  in the book.
- **Chitas and the Rambam, with their words.** The catalog import now
  also brings from Sefaria the Chumash with Rashi, Tehillim, every book
  of the Mishneh Torah and the Sefer HaMitzvot, a page per chapter, in a
  Set of their own, "חת״ת ורמב״ם / Chitas and Rambam"
  (`/sets/chitas-rambam`): `/chumash/genesis`, `/chumash/rashi-genesis`,
  `/tehillim`, `/rambam/<book>`, `/sefer-hamitzvos`. Their Hebrew is a
  public-domain version asked for by name (the Tanach with Ta'amei
  Hamikra, Rosenbaum and Silbermann's Rashi, Torat Emet's Mishneh
  Torah, the Warsaw 1883 Sefer HaMitzvot), since Sefaria's first Hebrew
  Tanach is CC BY-SA and could be only a link; the English is kept where
  its licence lets it be. A verse is a segment numbered as Sefaria
  numbers it, so `#s-5` is verse 5; Rashi has a section for each verse
  (`#s-5`) with its comments under it (`#s-5.1`). `rebbehub
  crawl-sefaria --daily` ([importers](docs/importers.md#sefaria)).
- **A few words into many pages through the MCP server.** `add_segments`
  adds or replaces segments in the words of up to 200 pages a call, as
  one suggestion, sending only the new segments and where each goes (at
  the start, the end, or before a given segment), not each page whole.
- **Every sefer has a shaar, its README.** One file per sefer, written
  the same way for every sefer ([the shaar](docs/shaar.md)): a header of
  fixed fields (its name, subtitle, authors, the author as the title
  page names him, its kind), then its sections under fixed headings
  (About, Structure, Printings, Sources, Notes). It shows under the
  sefer's contents as a README does under a repository's files, and its
  lines on the title page at the top. `/shaar/<id>` shows the file and
  edits it, naming every line the catalog cannot read as it is typed.
  A sefer no person wrote one for shows the one the catalog makes from
  its data, marked as such. API: `GET /v1/entities/{id}/shaar`,
  `POST /v1/suggestions/shaar`; MCP: `get_shaar`, `suggest_shaar`; the
  git mirror writes `shaars/<shard>/<id>.md`; `rebbehub shaars` gives
  every sefer without one the catalog's. Built-in schemas version 11.
- **Back and forth between a sefer's sichos.** A sicha's page has
  Previous and Next (הקודם / הבא) above its text and below it, to the
  sicha before and after it in the sefer's contents, across volumes (the
  last of one volume leads to the first of the next, named with its
  volume). In Hebrew "previous" is on the right. The page asks for both
  in one request, the new `GET /v1/units/{id}/neighbours` (in
  `@rebbehub/client` as `unitNeighbours`).

### Changed

- **The review queue lists titles, as GitHub lists pull requests.**
  `/review` shows one line per Suggestion: its title (to its own page),
  its #number, who sent it, when, and how many items it changes. Its
  changes, 25 at a time, and Approve are on its page; a Suggestion with
  no #number (an import) opens whole in the queue (`/review?s=`). The
  list of Reports (`/issues`) no longer carries each report's words to
  the browser, only its title and facts: the words are on its own page.
- **Tabs on a phone.** On a phone the main sections (Home, Library,
  Farbrengens, Suggestions) and the menu are tabs along the bottom of the
  screen, where a thumb reaches them, instead of hidden behind a button;
  the bell is in the top bar. The player and messages sit just above the
  tabs, and the menu's light/dark switch no longer spills out of it.

- **The library by Rebbe.** The library page's shelves are now a shelf
  for each Rebbe, from the Baal Shem Tov to the Rebbe, then history,
  halacha, journals and the rest, in the order the catalog keeps them,
  each with the sets inside it. "Every sefer" lists each sefer under its
  shelf instead of by kind, and the sources the sefarim came from
  (HebrewBooks, Otzros, Sefaria) are no longer shown as shelves.

### Removed

- **No timing button in the player.** The **תזמון** button, which let a
  listener tap where a paragraph starts, is gone: the model's sync is
  already good, and hand taps only moved it off. Words nobody is sure of
  can still be talked over, and "the sync of the whole recording is
  right" still marks it checked.

### Fixed

- **A large Suggestion reads in a few lines.** Its summary named every
  field it touches by its path (`body/versions/he/segments/t1/printed`,
  hundreds of them), which said nothing and stopped phones. Now a page's
  words are one line, "The words changed"; timings and machine details
  are left out; a field goes by its name; each kind of change shows at
  most three lines, at most five kinds are shown, and kinds that read
  the same are one. Examples are "Example 1, 2, 3", not ids. The queue
  reads 10 items at a time, not 25, and each item shows at most six
  changes, the rest counted.

- **Approve answers at once.** Pressing Approve in the review queue now
  says "Merging…" (ממזג…) and turns every button off until the API
  answers; then the card shows the suggestion merged, its buttons gone,
  without a reload. Before, the buttons came back as soon as the API
  answered and the card kept its old copy of the suggestion, so it
  looked unmerged until the queue was read again and invited a second
  press. The same on a suggestion's own page: its Approve says
  "Merging…", the page turns merged the moment the merge is done, and
  its checks are read again so they say so too. A refusal says why and
  gives the buttons back.
- **Checking a transcript.** "All exact" stays after you fix some of a
  paragraph's words, so a paragraph can be checked in the same visit;
  "Edit paragraph" is gone where your fix waits for approval (select the
  words to change them, as everywhere). The diff of a fix waiting for
  approval shows under the words on History only, with what was fixed
  since the machine heard them. Words marked unclear (`[words?]`) are
  all marked, not only the middle ones, and a fix no longer marks the
  word after it.
- **Previous and Next stay in their place.** The buttons above a sicha's
  text stuck to the top of the screen and covered the words as you
  scrolled, because they shared the site header's class name. They now
  sit above and below the text only, each takes half the row, and a long
  sicha name wraps to two lines instead of being cut.
- **The synced player has its look back.** A stylesheet merged without
  one closing brace, so the lyrics player and the rest of the farbrengen
  page lost all their styling. A test now checks every stylesheet closes
  what it opens.

- **Hayom Yom is set as the book prints it.** Each day now has the
  book's head: the weekday, the day and the year (5703 or 5704) in one
  bold row, and the day's shiurim under "שיעורים." (Chumash with its
  portion, Tehillim, Elul's added chapters and Yom Kippur's by their
  times, and the Tanya chapter), then the words justified, on the daily
  page and each day's own page. A day's notices (a Shabbos Mevarchim, a
  fast, the Seder) stand above its shiurim on the 29 days the book puts
  them there. A day's text can also carry what the book prints beyond
  its words: the letter before the first day, a Shabbos's haftorah, the
  Tanya line's first and last words, and the blessing after the last
  day, marked as machine-read until a person checks them. The weekday,
  year, Chumash and Tehillim are worked out from the calendar of 5703 and
  match the print on every day read from its scan. Names brought from
  chabadlibrary.org no longer show their tags (`<h3>ד שבט</h3>`).
- **Word by word again after a fix.** Fixing a paragraph's words used to
  throw away all its word timings until the audio was timed again, which
  for JEM's recordings never came, so the lyrics lit such a paragraph as
  a guess. A fix now keeps the timing of every word it left and times the
  changed words between them. `rebbehub restore-word-times` gives the
  timings back to paragraphs fixed before.

- **Each volume's printings are on one page.** A sefer's volume page
  showed only the printings named exactly as its contents name the
  volume, so Likkutei Sichos 30 (value "1" in its contents) showed the
  PDF of volume 1, and HebrewBooks' "ל (בראשית)" nowhere. Printings now
  go with a volume by its number ("30", "ל (בראשית)", "כרך ל" are one
  volume), and a volume only printings have (1 to 29, with no contents
  yet) gets its own row and page, with all its PDFs from every source.

- **A bot's suggestion of thousands of alike changes opens.** A sync
  bot's change of every word timing in a recording was a row for each
  (thousands) and stopped phones. Changes that differ only by their place
  in a list are now one row, with how many there are, the first as the
  example, and by how much they all moved when they moved alike; at most
  12 rows an item, the rest counted. Timings and machine details (where
  each word is heard, which engine, how sure) are no longer shown as
  changes: one line counts them. A long value or description shows its
  beginning, with Show all. A suggestion's page reads 40 items,
  and no longer a second full copy of 200 in the browser. In a
  suggestion that changes real words, an item whose only change is
  re-timing, a date or a machine mark (a small text fix re-syncs the
  words around it) is left out, so only the real edit shows.

### Added

- **The day's learning.** `/daily` shows today's Tanya (the Chitas
  portion by the yearly cycle from 19 Kislev, each chapter it touches cut
  to the day's part, Hebrew and English) and Hayom Yom, with the day
  before and after; `/daily/2026-09-30` is any day. `GET
  /v1/daily?date=YYYY-MM-DD` gives the same in one read.
- **A printing's PDF on Drive is read like a scan.** A printing whose
  source is a PDF on Google Drive (the Otzros library's copies, added as
  printings of the sefer they copy, so a sefer is on one page) opens in
  the site's reader from its page, and the sefer's printings list says
  "PDF copy" with a link to read it instead of "no scan yet".
- **Combine suggestions into one, like commits in one pull request.**
  `POST /v1/suggestions/combine` (and the `combine_suggestions` MCP tool)
  makes several of your own suggestions not yet approved into one, their
  changes applied in the order they were made; the ones combined are
  withdrawn. The transcript fixes page offers it for a farbrengen where
  your fixes are in several suggestions.
- **Changes to different words of one text no longer clash.** When two
  suggestions change the same paragraph (or a site change comes between),
  the three-way merge now merges its words: changes to different words are
  all kept, and only a change to the same words is left for a person to
  settle.
- **Fixes waiting for approval show in the transcript.** `GET
  /v1/recordings/{id}/transcript` gives `pending`: each paragraph fix not
  yet approved, as the paragraph would be, with who sent it and its
  suggestion. The editor shows each under its paragraph (yours or
  someone else's, with its #number) and starts editing from your own; the
  words it changes are marked with a dashed line in the editor and while
  listening; and the changelog lists them first, with a link to go
  through them all.
- **Transcript fixes, all together.** `/review?view=transcripts` lists
  every transcript fix waiting for approval, a farbrengen's together in the
  order heard: the words on the site beside the words sent, a tap to hear
  the paragraph, and Keep or Remove for each. Apply decides them all at
  once: kept fixes are approved, removed ones withdrawn if they are yours,
  else sent back. Timing changes from the editor's removed timing tool
  start marked Remove. API: `GET /v1/transcripts/fixes` and
  `POST /v1/transcripts/fixes/decide`.
- **Where a machine read each segment, on its scan.** A page's segment may
  carry `printed`: the boxes it is printed in on its version's scan (page,
  and x, y, width, height as fractions of the page). On the edit page that
  checks a machine's words beside the scan, clicking a segment turns to its
  page and highlights its lines. (Built-in schemas version 10, so catalogs
  already running take the field at start-up.)
- **Machine-read pages wait in the check lists.** `GET /v1/machine/to-check`
  also lists `texts`: pages whose words a machine read (the Likkutei Sichos
  subject index, read from its scans) with segments nobody checked, and
  `totals.texts` and `totals.entries`. They show on /check, in the home
  page's band for checking, and on the help page, each leading to its edit
  page with the scan beside it. Migration 0027 indexes the versions a
  machine wrote, so finding them is a lookup.
- **A machine's words checked against their scan.** On the edit page, a
  page whose words a machine read from a scan (a version with the scan's
  `url` and segments carrying `origin`) opens beside the scan, turned to
  the page of the segment in hand (the words' source markers, `סריקה 12`,
  say which). Each segment is marked **Right** as it is or fixed in place.
  `POST /v1/suggestions/words` takes `change: "check"`: the segment's
  words stay and its `origin` becomes `checked`.
- **Clashes are decided before Approve, all at once.** With `summary=1`,
  `GET /v1/suggestions/{id}` also gives `clashes` (items changed on the
  site since the suggestion was made, each needing a decision) and
  `unchanged` (items the site already holds as suggested). `resolutions`
  on approve takes `*` for every item or every field, so
  `{"*": {"*": {"take": "ours"}}}` keeps the site's version of every
  clashing field ("theirs" takes the suggestion's). The review page shows
  the count and offers both; before, Approve ran the whole merge and then
  stopped on the first clash with no way to decide. Approving reads the
  items' versions in two queries, not two per item.
- **MCP: `close_suggestion`, `reopen_suggestion`, `send_back_suggestion`**,
  and `approve_suggestion` takes `clashes` (`keep_live` or
  `take_suggestion`).
- **A transcript fix may cover only some words.** `POST
  /v1/recordings/{id}/transcript/fix` takes `complete` (default true):
  with `false` the words are fixed but the paragraph stays machine
  hearing, and the transcript marks it `edited` until someone checks the
  whole of it. It is no training clip until then.
- **`POST /v1/suggestions/{id}/reopen`: undo a withdrawal.** Its author
  or a steward puts a withdrawn suggestion back for review; its checks run
  again and its set's keepers are asked to look again. On the site, a
  withdrawn suggestion has a Reopen button and an approved one an "Undo
  this change" button (a revert).
- **Checking what the machines wrote: `/check`, linked from the home page.**
  Farbrengens with machine transcript paragraphs nobody checked, and scans
  read by OCR with pages nobody proofread, the newest first, each leading
  to where it is checked. From `GET /v1/machine/to-check` (two queries,
  kept five minutes at the edge) and the MCP tool `machine_to_check`.

- **The account is on Workers Paid.** No daily allowance of database
  statements, 30 seconds of CPU a request instead of 10 ms. The status
  page's quota line says "no limit" (`HYPERDRIVE_DAILY_QUERIES = "0"`),
  its Workers' load is measured against the paid plan's CPU allowance
  (`WORKERS_CPU_MS = "30000"`), and crawlers may have more pages a minute
  (search engines 60 each, all other bots 10 between them; they were 6 and
  2).

- **`GET /v1/events?brief=1`: each event's facts with each link's kind
  alone.** A farbrengen's links (where it is printed, each with its label
  and pages) are most of it, and a calendar's row shows whether it has a
  hanacha: a year of farbrengens is 49 kB brief, not 123. The site's
  calendar, home page and farbrengen pages ask so.

- **The status page shows the servers' load.** For each Worker, today's
  requests, how many the runtime stopped for going over the CPU allowance
  (error 1102, a page nobody got), and the CPU a request takes at the
  median and at the slowest hundredth, from Cloudflare's analytics; any
  request stopped today is "partly", one in twenty is "not working", and
  a slowest hundredth over the plan's allowance is "partly" before anyone
  is refused. `report.workers` in `GET /v1/status`, and the check
  `workers`.

- **The next model's goal.** Above every transcript, people signed in
  see how near the next transcription model is (for V4: 10 farbrengens
  checked through, about 34 hours) and which farbrengens to check next,
  those before 5740 most wanted; also `goal` in `GET /v1/machine/training`
  and the `training_data` MCP tool.

- **Every answer says what it cost.** The API's and the site's answers
  carry a `Server-Timing` header: the API's says how many statements its
  request sent the database and how long they took (`db`) and the whole
  (`total`); a page's says how many times it asked the API and how long
  it waited (`api`), the statements and time those answers report (`db`)
  and the whole. A browser's DevTools shows it in a request's Timing tab;
  `curl -sI` shows it too ([docs/operations.md](docs/operations.md),
  "The statement budget").

- **Corrections train the next transcription model.** Every transcript
  paragraph a person checked becomes training clips, in the training
  script's own format: `GET /v1/machine/training/clips` (JSON lines),
  `GET /v1/machine/training?since=` (how many hours, and how many are
  new), the `training_data` MCP tool, and `rebbehub training-clips`.
  **Heard right** checks a paragraph as it is; the editor shows the house
  spelling (the booklets') with a hint for each word written otherwise;
  the nightly transcription run times corrected words again, those first.
  Transcription runs can be split into workers side by side
  (`TRANSCRIBE_WORKERS`, `--shard i/n`). See docs/transcription.md, "The
  retraining cycle".
- **A status page.** `/status` (linked in every page's foot) says whether
  the site, the API, the MCP server, the database, today's allowance of
  database queries and the scheduled jobs are working, with ninety days
  of each and the latest incidents; checked every five minutes, and still
  answering while the database does not. `GET /v1/status` gives the same
  as JSON.
- **Suggestions about an item, in one question.** `GET /v1/suggestions?state=…&about=<ids>`
  lists only the suggestions that change those items, or what is in them
  (a sefer's sichos and their texts, a sicha's paragraphs, a farbrengen's
  sichos), up to 500 ids at a time.
- **Several files, and several recordings' hanachos, at once.**
  `GET /v1/files/batch?ids=<sha256s>` says of up to 200 files what
  `/v1/files/{sha256}` says of one, and
  `GET /v1/recordings/batch/hanacha?ids=<ids>` gives the synced hanacha of
  each of up to 200 recordings that has one. A farbrengen's page asks
  about all its parts in one request each.
- **A lighter commit feed.** `GET /v1/commits?changes=N` carries only N of
  each commit's changes; every commit now also says how many items it
  changed in all (`changed`) and of what kinds (`types`).
- **Ready for search engines and AI crawlers without draining the
  database.** Crawlers get a budget of pages a minute when the edge has no
  copy (each search engine its own, all other bots one between them), and
  are told 503 with Retry-After beyond it; an item's page is kept at the
  edge an hour instead of five minutes. The API has a `robots.txt` that
  keeps crawlers to its guides and files. The site now has
  `/.well-known/security.txt`, `/opensearch.xml` (search the catalog from
  the address bar), `Organization` data beside `WebSite` on the home page,
  and security headers on every answer (`nosniff`, HSTS, a referrer
  policy). An accessibility scan (axe) of the main pages, light and dark,
  phone and desktop, now finds nothing: links in sentences are underlined,
  faint hints have enough contrast, headings go in order, and the
  calendar's sideways scroll is reachable by keyboard.

- **Asking the machines.** Anyone signed in can ask for a scan to be read
  by OCR or a recording transcribed: a button on a scan's text page and
  under a farbrengen's parts without a transcript, `POST
  /v1/machine/requests`, the `ask_machine` MCP tool and `rebbehub machine
  ask`. `GET /v1/machine`, `GET /v1/machine/requests` and `machine_queue`
  show the queue, each request's place in line, and what is left. The
  free nightly jobs take requests first, then the newest items not done
  yet; the transcription job now runs nightly too, with the local engine
  only. What the machines make stays labelled until people check it.

- **Adding items through the MCP server.** `suggest_items` adds new items,
  or changes or deletes many at once, as one suggestion (200 items a call,
  kept adding to one draft over several calls); `approve_suggestion`
  approves a suggestion for those who may. An agent can now do what the
  site's editor does, not only fix one item.
- **Organizing from an item's own page.** A set's and a sefer's page have
  "Edit" (for signed-in people) and "…" in their head, and a "…" on each
  row of their lists (each sefer on a set's shelf, each sicha in a sefer's
  contents). They open a small sheet, a bottom sheet on a phone: rename
  (Hebrew and English name, address), move to another set (or a sicha to
  another sefer) found by name, move up to the set above, put what is in
  it in a new order (drag, or arrows for a finger), make a set inside it,
  merge into another item, or remove an empty set. Each shows its preview
  (what moves, which addresses will redirect) and is sent as one
  suggestion, with a link to it; a keeper who may approve it can apply it
  at once. Signed-out people see the actions and are asked to sign in.

- **What points at each of several items, in one request.**
  `GET /v1/entities/batch/linked?ids=…&field=…&type=…&limit=…` gives, by
  item, the items pointing at each of up to 200 items (a few of each, in
  the group's order), and `GET /v1/texts/batch/progress?ids=…` how many
  paragraphs each of up to 200 texts has and how many a person checked.

### Fixed

- **An item's page finds the suggestions about it in a lookup, not a
  read of every version.** "About an item" means a suggestion with a
  version of it or of what is in it (a sefer's sichos, a sicha's texts, a
  farbrengen's recordings). Finding them tested every version in the
  database, 141,000 of them, unpacking each one's data, twice a page: ten
  seconds of the database's time for every item page, a work's page
  eleven seconds in all. Four indexes over what a version points at
  (migration 0026) make each part of the question a lookup: the same
  question answers in under fifty milliseconds.

- **A page is one Worker and one database connection.** The site's Worker
  answers a page's reads of the API itself, with the API running inside
  it over one connection to Postgres the page opens and closes, instead
  of one Worker invocation and one connection for each of a page's dozen
  or two reads. Signed-in reads, changes, search by meaning, the apps'
  catalog and Drive files still go to the API's Worker. A page's
  `Server-Timing` says how many of its calls were answered in the site's
  Worker.

- **Transcription runs work again.** PyAV 19, out on 2026-09-29, broke
  faster-whisper's audio reading, so every recording failed; the workflow
  now pins faster-whisper 1.2.1 and PyAV below 19.

- **Search answers in well under a second, not thirteen.** Postgres
  ranked a search's matches by reading the words of every matching item
  again; a common word matches fourteen thousand sichos, and the search
  page waited thirteen seconds for it. The words as Postgres searches
  them are now kept with each item (`entity.search_tsv`, migration 0024)
  and indexed, so a search matches and ranks from what is kept. The
  places a search's words are (`/v1/search/moments`) are found the same
  way. The old index over the expression is dropped (migration 0025), so
  a write no longer computes an item's words twice.

- **A calendar year is a quarter lighter, and the home page's feed a
  third cheaper to make.** The calendar's year, the home page's week and
  a farbrengen's other years keep each farbrengen as its row (name, date,
  what it is printed in, recordings), not with every link's label and
  page: a year's calendar carries 43 kB of them hidden for hydration, not
  108. And a suggestion's page tells what changed in each item by walking
  its two versions, not by writing both out as canonical JSON at every
  level, which was a quarter of the home page's CPU.

- **A volume's page is a sixth of its size, and a set's a seventh.** A
  volume of Igros Kodesh was 1.1 MB, 1 MB of it the words of its 150
  letters, listed with each for the page to carry hidden and read by no
  one; it is 170 kB now, and a third of the CPU to make. The set of the
  farbrengens listed five hundred of its three thousand (900 kB); a set's
  page lists its sefarim and the first sixty of anything else in it, with
  how many there are (133 kB). The home page read the words of every item
  of the suggestions it shows (800 kB for three) and reads their facts.
  The budget test now holds each page to a size too.

- **A sefer's volume and a farbrengen no longer make a request per
  sicha.** A volume's page asked the API for each sicha's texts, then for
  each edition's paragraphs: 166 requests for a volume of Igros Kodesh,
  more than a request may make on any plan, so those pages failed. A
  farbrengen's page did the same for each sicha said at it and each
  one's words. Each now asks once for all of them (16 requests and 25
  statements for that volume), however many sichos. Item pages
  ask for what points at them as items (`/linked`) rather than as ids to
  read after, one request fewer per list; a search's results are checked
  for their rights once per text, not once per paragraph.
- **A suggestion's page reads only its page of items.** `GET
  /v1/suggestions/{id}` used to read and compare every item of a
  suggestion for each page of it (a bot's import of 500 items, on every
  view and for every item page that listed it); now it reads the page
  asked for, and the summary of all the items only with `summary=1`, which
  the review page asks for once. The conversation list (`state=`) now says
  of each suggestion what kinds of items it changes (`types`) and its
  first item (`first`), so an item's page labels and places the
  suggestions about it without opening any; only the open ones are opened,
  a few, a page of items each.
- **The statement budget is a test.** `apps/web/tests/budget.test.ts`
  renders each page over a small catalog with the shapes that matter and
  fails when a page's database statements or API calls grow past its
  ceiling, so a change that quietly makes a page expensive fails CI
  instead of the site ([docs/operations.md](docs/operations.md), "The
  statement budget").
- **An item's page no longer opens the newest suggestions to find the
  ones about it.** It asks the API (`about=`), and opens only those, a
  page of items each. Before, every page view read the fifteen newest
  conversations in full; with a few of hundreds of items each, that was
  thousands of database statements a page view, which is what Cloudflare
  counts against Hyperdrive's daily allowance
  ([docs/operations.md](docs/operations.md), "What reaches Postgres").
- **Fewer database statements per request.** Reading an item on main is
  one statement instead of two; a signed-in request's account is made and
  its steward mark kept in one; and the Sichos Kodesh apps' catalog is
  built once per change per Worker isolate, not once per request (each
  request now asks only whether anything changed).
- **A farbrengen's page no longer makes a request per part.** It asked
  the API for each recording's file and each one's synced hanacha, 58
  requests for a farbrengen of 40 parts: more than a Worker may make in
  one request on Cloudflare's free plan, so those pages failed whatever
  the day's allowance. It now asks once for all the files and once for
  all the hanachos (15 requests, 17 statements instead of 80).
- **The home page's feed no longer downloads every change of the last
  twelve commits.** An import's commit changes thousands of items; the
  feed shows three of each, so it asks for three (`changes=3`) and gets
  the count and kinds of the rest. Reading the commits is two statements
  instead of one per commit. A sefer's, a sicha's and a set's page make
  about a third fewer statements too, and ask for their links, their
  counts and their relations together rather than one after the other.
  The counts, before and after, are in
  [docs/operations.md](docs/operations.md) ("The statement budget").
- **The Workers run near the database.** Smart Placement is on for the
  API and the site (`[placement]` in each `wrangler.toml`): a page is
  many API reads one after the other, and each read several statements,
  so they are made from next to Postgres rather than across the ocean.
  Pages and public reads already at the edge are still served from near
  the reader.
- **Long links no longer push an item's page sideways on a phone.** A
  source's long address (a Drive folder) or id is shown short, as its
  host and "…", with the whole of it kept in the link and its title; the
  side column's lists, facts and ids break or end in "…".

- **The Sichos Kodesh apps' catalog, from RebbeHub.** `/v1/app/v1`,
  `/v1/app/v2` and `/v1/app/v3` answer at the paths and in the shapes of
  Sichos-Kodesh's own catalog API (`catalog/manifest.json`,
  `catalog/{version}/catalog.json`, `catalog/changelog.json`,
  `catalog/latest/catalog.json`, and `v3/texts/{sha256}`), built from the
  farbrengens, recordings, sefarim and units on main, so the apps can
  switch by changing one address ([Sichos-Kodesh](docs/sichos-kodesh.md)).
  Numbered `2.<commit>.0`; while RebbeHub holds no library, `v2` and `v3`
  are numbered `0.<commit>.0` and say `missing: ["library"]`, so no app
  takes them.
- **Drive files read through RebbeHub.** `GET /v1/drive/{id}` reads a
  Google Drive file the catalog links to (a hanacha's PDF, an Otzros
  scan) for the site's reader and player, with CORS and Range, kept at the
  edge; only files an item links to, up to 300 MB, 120 a minute per
  address. New error codes `too-large` (413) and `upstream` (502). The
  site no longer depends on Sichos-Kodesh's media proxy for PDFs.
- **`rebbehub relink-drive`** (and the Upkeep workflow's `relink-drive`,
  `relink-drive-dry-run`): links older imports stored on the media proxy
  become the files' own Drive links, as reviewed bot Suggestions of 500
  items; `--dry-run` counts them.
- **The Otzros library as a tree.** Its Drive folders become nested Sets
  under `/sets/otzros`, each sefer in its folder's Set, to browse and sort
  from; the sefarim keep their paths.
- **Connect Claude to your account.** The API is now an OAuth 2.1
  authorization server for MCP clients: Protected Resource Metadata
  (`/.well-known/oauth-protected-resource/mcp`), Authorization Server
  Metadata (`/.well-known/oauth-authorization-server`), registration
  (`/oauth/register`) and Client ID Metadata Documents, `/oauth/authorize`
  with PKCE (S256) and resource indicators, `/oauth/token` (codes and
  refresh tokens, turned over at each use) and `/oauth/revoke`. You
  approve an app on the site's new consent page (`/oauth/consent`), where
  you see its name, where it sends you back, and may allow reading only.
  Connected apps are listed on the account page beside your tokens
  (`kind: "oauth"` in `/v1/tokens`) and disconnected there. In claude.ai:
  Settings → Connectors → Add custom connector →
  `https://api.rebbehub.org/mcp`, *Sign in when needed*, Claude's
  published identity (CIMD).
- **An agent's work shows as the agent's.** Suggestions, comments,
  issues and reviews sent with a personal token or a connected app keep
  what sent them (`via`, migration 0021), returned on suggestions, their
  conversation, issues, history and commits, and shown on the site with
  the agent mark: "Claude · for @you" (Hebrew too).

- **Organizing the catalog.** Sefarim moved between sets, sets under other
  sets or up a level, sichos to another sefer; names and addresses
  changed; lists put in a new order by dragging or the keyboard; new sets
  made and empty ones removed; duplicates merged (their sichos, printings
  and links moving over) and sefarim split. Each plan is one suggestion,
  however many items it touches, previewed item by item first; old
  addresses redirect once it is approved, a merged item's to the one kept.
  On the site: "Organize" on the library, every set and every sefer
  (`/organize`). In the API: `GET /v1/tree`, `POST /v1/organize/preview`,
  `POST /v1/organize`, and `detail.mergedInto` on a merged item's 404. For
  agents, the MCP tools `get_tree`, `preview_organize`, `organize`,
  `move_items`, `move_up`, `rename_item`, `reorder_children`, `create_set`,
  `delete_set` and `merge_items`. Sets and sefarim take an `order` among
  their siblings (built-in schemas, version 8); migration 0022 keeps where
  merged items went.
- **Ready for search engines and crowds.** Sitemaps a page of 10,000 items
  at a time in both languages, with when each item last changed
  (`/sitemap.xml`; the API's new `/v1/sitemap` and
  `/v1/sitemap/{type}/{page}`); every page with its preview picture (a
  sefer's shaar), Twitter card, and schema.org data (Book, Event with its
  recordings as AudioObjects, BreadcrumbList); a robots.txt that keeps
  crawlers out of what is personal and endless. Pages and the API's
  public reads are kept at Cloudflare's edge, so a burst of readers or a
  crawler mostly never reaches the database; searching has its own
  allowance per address (60 a minute).
- **Covers from linked PDFs.** A sefer whose PDF is only linked (a scan on
  Drive, a HebrewBooks printing) gets its title page as a cover too; the
  cover source list (`/v1/works/{id}/cover`) now names `linked` sources and
  a `publication` kind. The PDF itself stays a link.
- **API v1 (1.0.0), declared stable.** Every route is in
  `/openapi.json` (OpenAPI 3.1), and a test fails when one is not.
- **Personal API tokens** (`rhp_…`): made and revoked on the account page,
  with the `read` or `read` and `write` scopes and an optional end date;
  only a hash is kept. Scripts and AI agents send suggestions that are
  reviewed like anyone's.
- **One error shape** everywhere: `{ "error": "<code>", "message": "…" }`,
  the code fixed per status (`not-found`, `invalid`, `rate-limited` …).
- **Cursor paging** (`cursor`, answered with `next` and a `Link` header)
  on entities, children, commits and suggestions. The older `after` and
  `since` still work.
- **ETags and 304s** on public reads; `Vary` and `Cache-Control` that keep
  personal answers out of shared caches.
- **CORS** for every origin on reads, and for writes with a token.
- **Rate limits** by address (300 a minute) and by token (1,200 a
  minute), with `RateLimit-Policy` and `Retry-After`.
- **An MCP server** at `https://api.rebbehub.org/mcp` for AI agents:
  search, get an item, list its children, get its text (machine words
  marked), and suggest a fix with a token.
- **`/llms.txt` and `/llms-full.txt`** on the site and the API.
- **Developer docs** at `/developers`, drawn from `docs/developers/`, with
  an interactive reference built from the OpenAPI document.
- **`@rebbehub/client`**, a small typed TypeScript client generated from
  the OpenAPI document.
- `docs/configuration.md`: every setting a deployment changes, by name.
- `CHANGELOG.md`, and issue links to the site's own report form and the
  developer docs.

### Changed

- **Words light up again as they are heard, in the listening view and
  the editor.** A paragraph whose words were fixed (its own timings wait
  for the nightly run) or a fix still waiting has each word's moment
  estimated from where the paragraph starts and ends.
- **A simpler transcript editor on a phone.** No yellow marks: the place
  you stopped last time is no longer highlighted, the word being said is
  marked in blue, and paragraphs no longer each carry a "not checked yet"
  badge (one line at the top says the text is the machine's). The help,
  the changelog and the training goal fold into small links, and the
  paragraph's buttons are large, two to a row.
- **Timing while listening.** **Timing** turns a tap on a paragraph into
  where it starts, and asks once before sending, so a stray tap never
  moves the sync; in the editor, **the sync of the whole recording is
  right** marks it checked. The editor has no **תזמון מדוייק** button.
  A listener's timing taps on one recording are one suggestion, each
  going on from the last, so they never clash.
- **Talk over unclear words.** Tapping words marked unclear (`[words?]`)
  while listening, or **Discuss** under the paragraph in the editor,
  starts a conversation on the recording's talk page with the words and
  where they are heard.
- **The transcript editor looks as it did before.** Each waiting fix has
  its own box again, and the history shows every change with who made it
  and its suggestion. What kept fixes from clashing stays: a listener goes
  on from their own waiting fix, so their fixes of a transcript stay one
  suggestion, and Edit is there even while a fix waits.
- **One suggestion per listener per transcript.** Fixing word after word
  in a transcript adds to the suggestion you already sent for it, while
  nobody has reviewed it yet, instead of making one per word (which
  clashed with each other). The editor goes on from your own waiting
  fix, shows each paragraph's waiting fixes as one, and its history as
  one change per paragraph: the machine's words beside today's, and who
  changed and checked them.

- **A list answers with each item's facts, not its words.** `body` (the
  words a page keeps in itself, kilobytes for each sicha or letter) is
  left out of every list (`/v1/entities`, `children`, `linked`,
  `batch/linked`, `/v1/works/{id}/parts/{part}`, `/v1/events`, search);
  an item read by id, or several with `/v1/entities/batch`, has it.

- **A suggestion's page carries its own checks.** `changeset.checks` on a
  page of a suggestion are the checks that did not pass, of that page's
  items and of the whole; `checkCounts` counts them all by status. The
  suggestions list carries no checks. `brief=1` gives each item's facts
  without its words (`before` and `after` without `body`; what changed is
  whole in `changes`), for a feed.

- **Large Suggestions are reviewable.** `GET /v1/suggestions/{id}` gives
  a page of its items at a time: 25 unless `limit` says (at most 200),
  from `offset`, with `total`, `offset`, `limit` and `next` (where the
  next page starts, or null). Its new `summary` groups every item by how
  it changes (the same fields, changed the same way: "500 events: links
  on the media proxy became links on Drive"), with a few examples each,
  and `people` says whether the author is a bot. Main's versions are
  read for all the items in a few queries, not a few per item. The list
  (`GET /v1/suggestions?status=…`) gives each Suggestion's `items` (how
  many it changes) and `people`. A caller that read every item in one
  answer asks for `limit=200` and follows `next`. The review page draws
  the queue from the list and reads each Suggestion's changes as it
  comes into view, with "Show more"; a bot's Suggestion is shown as the
  bot's, marked as a machine's work until a person approves it, and
  Approve and Send back take in the whole Suggestion. A Suggestion with
  no #number (an import) opens by its id: `/review?s={id}`.

- Importers store a PDF on Google Drive at its own Drive address
  (`https://drive.google.com/file/d/<id>/view`), the mafteiach's and
  Otzros HaRebbe's link, not the media proxy's; an Otzros page has one
  edition, its Drive file. JEM's recordings still play through the proxy.
- Running an importer again leaves an item people moved to a new path, or
  deleted, where they left it, and a sefer's Sets as people sorted them.
- `rebbehub reading-copies make` reads the archive's list from the
  archive's own bucket, not from Sichos-Kodesh's pack API.

- **The MCP server's writing tools ask for sign-in**: called without a
  token, `suggest_fix` and `open_issue` answer HTTP `401` with
  `WWW-Authenticate` naming the resource metadata (MCP step-up), and with
  a read-only token `403` `insufficient_scope`, instead of a tool error.
  Reading without an account works as before.
- Every `401` answer says `unauthorized` (sign-in routes said
  `bad-request`), and every `429` says
  `rate-limited` (was `too-many`).
- Suspending a person revokes their API tokens.
- `docs/api.md` points to the developer docs for webhooks and OAI-PMH.
- The repository's README, contributing guide, governance (takedowns are
  answered within two weeks, on the site's own form) and security policy
  (tokens, the MCP server and webhooks are in scope) are brought up to
  date; every package names the repository, its home page and where to
  report bugs.

## Before 1.0

Built in phases, as [docs/roadmap.md](docs/roadmap.md) records: the data
model, the versioned catalog engine and its importers (phase 0); the
public read API, search, the git mirror, signed dumps and the public site
(phase 1); accounts, suggestions, review, trust, follows and reports
(phase 2); and scans, uploads, OCR, transcription and sync, projects, the
Missing board, webhooks, embeds, OAI-PMH, translations, mirrors and search
by meaning (phases 3-6).
