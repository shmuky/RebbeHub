# RebbeHub: the plan

Written 2026-09-28. A plan, not a build. It supersedes the Rebbe Drive
(`docs/offline-plan.md` §3 and WP5b) and grows the Work/Unit/Edition model
of `docs/chabad-library-plan.md` into a community-edited index.

## 1. The idea

RebbeHub is the biggest open index of Chabad Torah and media, built by the
community. **Everything**: the Baal Shem Tov and the Maggid, every Rebbe,
the Rebbe's sichos, maamarim, letters and recordings, the chassidim's
seforim, kovtzei he'oros, yearbooks, diaries, and the thousands of
teshuros printed for weddings and simchos. Every printing of every book,
every scan of every printing, the text of each, and every recording synced
to its words.

It works the way GitHub works: anyone can suggest a change or report a
problem, trusted people review and merge, big efforts run as their own
project, and nothing is lost because every change is history. But nobody
sees "commit", "branch" or "pull request". They see **"Suggest a fix"**,
**"Report a problem"**, **"Add a scan"**, **"Fix this line"**; a reviewer
sees **"Approve"**.

Three promises:

1. **Everything findable.** One permanent page per item with all its
   printings, scans, texts, recordings and links.
2. **Anyone can help, nothing breaks.** Every change is reviewed or
   reversible, and credited.
3. **It belongs to the community.** The whole catalog and all community
   text is exported openly (public git repo + dumps), so it can never be
   locked away.

Video stays external links (YouTube, JEM, chabad.org) with timestamps.

## 2. What we already have (Sichos-Kodesh, reused)

| Existing piece | Becomes in RebbeHub |
| --- | --- |
| `packages/works/src/types.ts` (Author → Work → Unit → Edition, `Licence`, `SourceId`) and its registry (~81 works, 9 authors) | The core of the data model, extracted to a published `@rebbehub/model` package that Sichos-Kodesh imports back. |
| `packages/works/src/rights.ts`, `packages/catalog/src/rights.ts` | The rights gate on every file (§8). |
| `services/archive/src/schema.ts` (commits main/pending/rejected, objects by sha256, sources, wanted, refs, derivations) | The prototype of the versioning model (§6); its history is migrated in. `wanted` becomes the public **Missing** board. |
| Indexers: `mafteiach-index`, `jem-index`, `hebrewbooks-index` (~1,450 Chabad books), `sefaria-index`, `igros-index` (11,059 letters), the chabadlibrary.org tree | **Bot contributors** that seed the hub on day one and keep syncing through suggestions like anyone else. |
| `packages/catalog/src/hebrewDateKey.ts`, `specialDays.ts`, `occasionIdentity.ts` | Dates and event identity (§4). |
| `packages/app-core/src/search/` (`normalizeSearchText`, smart query) | Hebrew normalisation in front of search. |
| `packages/pack-format` (sha256, Ed25519) | Signed releases and dumps. |
| `services/media-proxy`, R2, `pack-builder` transcodes | File delivery and audio derivations. |
| `packages/design` tokens | The look, so both projects feel related. |

Sichos-Kodesh stops curating its own catalog: `packages/catalog/bin/build.ts`
builds from a RebbeHub release.

## 3. The words people see (GitHub for non-nerds)

| GitHub | RebbeHub (en / he) | What the person does |
| --- | --- | --- |
| Repository | **Set** / סט (Likkutei Sichos, Igros Kodesh, Teshuros, Kovtzei He'oros, Farbrengens 5742) | Browses it. |
| Issue | **Report** / דיווח ("wrong date", "page missing in scan", "audio cut off") | One button, one sentence. No account needed. |
| Pull request | **Suggestion** / הצעה | Edits the page or a line of text in place, presses "Send for review". |
| Review / merge | **Approve** / אשר, **Send back** / החזר עם הערה | Before/after side by side, one click. |
| Commit history | **History** / היסטוריה | Who changed what, when, with "restore this version". |
| Branch | **Project** / פרויקט ("Proofread Toras Menachem 5745", "Sync all 5722 recordings") | Groups many suggestions; merged as one when done. |
| Release / tag | **Catalog edition** / מהדורה (`2026.40`) | Downloads a dated snapshot. |
| CODEOWNERS | **Set keepers** / אחראי סט | Named reviewers per set. |
| Fork | **Download everything** | Public dumps and git mirror. |
| Watch | **Follow** | Notified when an item, set or project changes. |

Design rules: Hebrew-first RTL with full English; one primary action per
page; uploads guess first and ask second ("This looks like the 5722
printing of Likkutei Sichos vol. 4 by Kehot — right?"); nobody ever sees
JSON, raw field diffs, or a merge conflict they did not cause.

## 4. The data model

Content and print are separate things. A letter of the Rebbe is one piece
of content, printed in Igros Kodesh, reprinted by another publisher, and
reproduced in a dozen wedding teshuros. RebbeHub models both sides and
the links between them.

**Content side (what was said or written)**

- **Author**: every Rebbe, chassidim, editors, families (for teshuros),
  "unknown".
- **Work → Unit**: a sefer or series and its structure
  (`levels: ['volume','sicha']`), from `packages/works`. A Unit is a sicha,
  maamar, letter, chapter, story, diary entry.
- **Event**: a farbrengen, yechidus, simcha, date of a letter. Hebrew date
  key (`5742-05-10`), place, occasion (reuses `occasionIdentity.ts`).

**Print side (what exists on paper and in files)**

- **Publication**: a printed thing — a book volume, a kovetz, a periodical
  issue, a booklet, a **teshura** (with its simcha: families, date, place).
  Publisher, place, year, printing number, identifiers (HebrewBooks id,
  National Library of Israel id, ISBN). The same work printed by Kehot and
  by another publisher = two publications.
- **Scan**: one PDF of one publication. A publication can have many scans
  (different scanners, quality, completeness); the best is marked
  "preferred" by keepers. Files are stored once by sha256.
- **Contents map**: page ranges of a publication ↔ units ("pp. 12–15 of
  this teshura reproduce the letter of 5 Tishrei 5720"). A reproduced
  letter links to its existing unit; a never-before-published one becomes
  a new unit. This is how "where else was this printed?" works.

**Text side (the words, versioned)**

- **Text layer**: the text of one scan, page by page, with each line's
  position on the page image, so search hits light up on the scan.
  Several layers can exist for one scan:
  - *machine OCR* (engine + version recorded),
  - *uploaded OCR* (a user's own file, e.g. from their own OCR tool),
  - *community text*: starts as a copy of the best OCR, then corrected
    line by line by users. Only this one is edited; it is fully versioned.
- **Text** of a unit: segmented into paragraphs with stable segment ids
  that survive edits, so citations (`LS 12:3 ¶4`) never break. A unit can
  have texts from several publications; RebbeHub can **compare printings**
  and show variant readings between publishers.
- **Proofread level** per page and per segment: raw OCR → checked once →
  checked twice (Wikisource-style), shown as colours.

**Media side**

- **Recording**: an audio file of an event (many per event: different
  sources, qualities, parts), plus external video links with timestamps.
- **Transcript**: the verbatim words of a recording (usually Yiddish),
  a text like any other.
- **Sync (alignment)**: time ranges of a recording ↔ text segments.
  Word-level against a verbatim transcript; paragraph-level ("about here")
  against a hanacha or Likkutei Sichos, which are edited Hebrew versions
  rather than word-for-word. Versioned and user-fixable like text.

**Glue**

- **Relation**: typed edges — *based on*, *printed in*, *translation of*,
  *answer to*, *cites*, *same recording as*, *reproduces*.
- **People / Places / Topics**: small curated vocabularies.
- **Source**: provenance for every file and fact (url, fetched at, etag,
  uploaded by), as in the archive's `sources` table.

**IDs.** Every entity gets a permanent opaque id (`rh-7k2m9q`, Crockford
base32) plus a readable path (`/likkutei-sichos/12/bereishis/3`,
`/events/5742-05-10`, `/teshuros/5784-...`) that can change with a
redirect. Citation refs resolve to ids.

**Schema as data.** Entity types and fields are JSON Schema in a versioned
registry, changed by admins through the same suggestion flow, so a new
kind of item ("maaneh", "manuscript page") is a schema change, not a code
release.

## 5. Scale this has to hold

All of Chabad is large but bounded: tens of thousands of works and
publications (HebrewBooks alone has ~1,450 Chabad books; teshuros number
in the thousands), millions of pages, millions of text segments, tens of
thousands of hours of audio, tens of millions of revisions over time. That
is well within one Postgres database with partitioned revision tables,
plus object storage for bytes. No part of the design depends on the index
being small.

## 6. Version control: how "GitHub for a catalog" works

Real git cannot hold millions of records, terabytes of scans, per-field
review and non-technical users. The source of truth is a **versioned
database in Postgres**; git is an **export**.

**Core tables**

- `entity(id, type, main_rev)` — what exists and its current version.
- `revision(id, entity_id, parent_rev, data jsonb, hash, changeset_id,
  author, created_at)` — append-only; nothing is updated in place.
- `changeset(id, title, author, status draft|open|merged|sent_back|withdrawn,
  project_id, base_commit)` — a Suggestion: revisions proposed together.
- `commit(seq, changeset_id, merged_by, message, at)` — main is a linear
  sequence of merges; "the catalog as of commit N" is the latest revision
  per entity with `seq ≤ N`. Catalog editions tag commits.
- `project(id, name, base_commit, keepers, goal)` — a branch: an overlay of
  revisions on top of its base, auto-rebased onto main.
- `report`, `review`, `comment`, `audit_log`.
- `file(sha256, bytes, mime, rights_state, storage_tier)`, `file_source`,
  `derivation` — as in `services/archive`.

**Text and sync at scale.** Text layers and alignments are versioned per
**page** (for scans) and per **segment** (for unit texts), not per whole
book, so one corrected line is one small revision and two people fixing
different lines of the same page never clash.

**Merging.** Three-way merge per field (records) and per line/segment
(text) against the suggestion's base. Different fields or lines merge
silently. A real clash goes to the reviewer as a simple choice ("A says
10 Shvat, B says 11 Shvat"), never to the contributor.

**History and revert.** Any version can be restored; revert-a-suggestion
undoes all of it in one click. Cheap undo is what lets the index be open.

**Git mirror and dumps.** Every merge is exported to a public
`rebbehub/catalog` git repo (one JSON file per entity, sharded; text as
Markdown with segment anchors; alignments as WebVTT-like files) so anyone
can clone, diff, fork and audit. Each weekly catalog edition also produces
a signed SQLite + Parquet dump on R2 (Ed25519, via `pack-format`). The
Sichos-Kodesh apps build from these.

## 7. Contribution flows

- **Report** (anyone, anonymous with a captcha): "Something wrong here" →
  reason → optional note. Lands in the set's inbox.
- **Suggest a fix** (signed in): edit the page in place, "Send for
  review". Auto-checks (valid Hebrew date? duplicate? link alive?) show
  green/red to the reviewer.
- **Add a scan / recording**: drag in a file. The server hashes it
  ("we already have this — here"), fingerprints PDFs (perceptual page
  hashes) and audio (Chromaprint), reads the title page or a sample, and
  proposes what it is: a new scan of an existing publication, a new
  printing, or a new teshura. The person confirms, states the source and
  ticks the rights statement.
- **OCR**: every new scan gets machine OCR automatically. Anyone can also
  upload their own OCR for it. Keepers pick which layer seeds the
  community text.
- **Fix this line**: the scan page and its text side by side; tap a line,
  correct it, done. Pages change colour as they are checked.
- **Sync a recording**: the system aligns automatically (transcribe →
  align to transcript, then to the hanacha paragraph by paragraph). The
  player highlights the words as they are spoken; if it drifts, the user
  taps "the Rebbe is saying this line now" and the alignment is fixed from
  there. Users also correct the transcript itself.
- **Map a teshura**: mark "pp. 3–8 are a letter from 5718" and link or
  create the unit.
- **Projects**: a keeper opens "Proofread Igros vol. 14" or "Sync the 5745
  farbrengens"; the page shows progress and hands out the next unclaimed
  page or recording. The **Missing** board lists gaps: farbrengens without
  audio, publications without a scan, scans without checked text,
  recordings without sync.

**Trust levels** (earned automatically, Discourse-style):

| Level | Can | Earned by |
| --- | --- | --- |
| Visitor | read, download, report | — |
| Contributor | suggest, upload, fix lines, fix sync | sign in (passkey, email link, or Google) |
| Trusted | small fixes go live immediately in *open* sets (reviewed after) | ~20 approved suggestions, no reverts |
| Keeper | approve in their sets; run projects | appointed by stewards |
| Steward | roles, set policies, schema, takedowns | the governing group |

Set policies: **open**, **moderated** (default), **locked** (rights not
cleared). Line fixes to text in open sets can go live for Trusted users;
catalog facts stay moderated. Bots (importers, OCR, sync) are labelled
contributors and never merge their own work.

## 8. Files, rights and storage

- **Storage**: Cloudflare R2, content-addressed (`objects/<sha256>`),
  zero egress. Resumable multipart uploads (presigned), hash verified
  server-side before acceptance.
- **Rights state per file**: `open` (served), `credit` (served with
  credit), `link` (point at the source only), `preserved` (private copy
  kept, never served until cleared). HebrewBooks stays link-only per its
  terms; Sefaria CC-BY-NC is served with credit; hanachos and publisher
  scans default to link + preserve. Teshuros, usually printed for free
  distribution, default to `credit`, with a fast family-request path.
- **Two buckets**: public (through the media proxy with caching) and
  preservation (no public route; backed up as in
  `services/archive/deploy`).
- **Takedown**: a public form; a steward moves a file to `preserved` in
  one click, logged.
- **Derivations**: web audio profiles (reusing `pack-builder` transcodes),
  page images and thumbnails, waveforms. All regenerable from originals.
- **Scans** served as IIIF manifests, so any library viewer opens them.

## 9. Making it smart

- **Search**: Meilisearch (or Typesense) over titles, dates, people,
  places and all text layers, with our Hebrew normalisation and the smart
  query parser from `app-core` ("יו"ד שבט תשכ"ב" and "10 Shvat 5722"
  both work). Hits open the scan at the highlighted line, or the recording
  at the spoken moment. Later, pgvector embeddings for "find sichos about
  this idea".
- **OCR pipeline**: pluggable engines — a strong print-Hebrew engine for
  modern printings, Rashi-script and old-print models, handwriting (the
  Rebbe's ksav yad) later. Engine and version stored with each layer so
  pages can be re-OCRed when engines improve, without touching
  human-checked lines.
- **Transcription and sync**: Whisper-class models fine-tuned for Yiddish
  and Hebrew, then forced alignment for word timings; paragraph-level
  alignment to hanachos by text similarity. Re-run as models improve;
  human-fixed spans are locked.
- **Machine drafts, human truth**: everything a machine makes is labelled
  until a person checks it, and never presented as the Rebbe's words
  before that.
- **Deduplication**: file hashes, perceptual page hashes and audio
  fingerprints catch the same scan or recording uploaded twice.
- **Cross-linking**: detect citations in text ("ראה לקו"ש חי"ב") and
  letters reproduced in teshuros; propose Relations, so each page shows
  "Printed in…", "Based on this farbrengen", "Cited by…".
- **Compare printings**: diff the texts of two publishers' editions of the
  same unit.
- **Health dashboards**: coverage per set and year, dead links, unchecked
  pages, unsynced recordings, oldest open suggestions.
- **Reviewer assist**: an AI summary of each suggestion — advice, never a
  merge.

## 10. Architecture

```
 browsers / Sichos-Kodesh apps / other sites
            │
   rebbehub web  (React Router 7 SSR on Cloudflare Workers;
            │     SEO item pages, Hebrew RTL, PWA, scan viewer, synced player)
            ▼
   API  (Hono, TypeScript, OpenAPI; Workers + Hyperdrive)
      │            │               │
      ▼            ▼               ▼
  Postgres     Meilisearch      R2 (public + preservation)
  (Neon)       (VPS)            via media-proxy
      │
      └─► Queues ─► job workers (VPS, Docker; GPU burst for OCR/ASR/sync)
                     hashing, fingerprints, transcodes, OCR, transcription,
                     alignment, link checks, git-mirror export, dumps
```

- **One language**: TypeScript, npm workspaces, vitest — as in
  Sichos-Kodesh; React Router 7 is already in `apps/web`. The ML workers
  are the one exception (Python containers behind the queue).
- **Postgres** on Neon: database branching gives every code PR a throwaway
  copy of real data for testing; revision tables partitioned by time.
- **Public read API** (REST + OpenAPI), dumps, webhooks, embeddable synced
  player, later OAI-PMH for libraries.
- **Cost at launch**: a few TB on R2 (~$15–75/month), small Neon and VPS
  plans; GPU rented only while an OCR or sync project runs. Donations
  cover it.

**Repos** (new, public):

- `rebbehub/rebbehub` — code: `apps/web`, `services/api`, `services/jobs`,
  `services/ml` (OCR, ASR, alignment), `packages/model` (from
  `packages/works`), `packages/hebrew` (date keys, normalisation),
  `packages/importers` (the indexers as bots). AGPL-3.0 so hosted forks
  stay open.
- `rebbehub/catalog` — the git mirror. Catalog facts CC0; community text,
  corrections and sync CC-BY-SA; source texts keep their own licence.

## 11. Governance and safety

- A small **stewards** group (Shmuly first) sets policy and appoints set
  keepers. A public content policy: authentic Chabad material, respectful
  tone, sources required.
- Every moderator action is logged and reversible.
- Rate limits and new-account holds on uploads; file type checks and
  virus scan; rights attestations; takedown with a stated response time.
- Early talks with rightsholders (Kehot, JEM, Vaad Hanochos B'Lahak, other
  publishers); the `preserved` tier lets preservation start before those
  talks finish.

## 12. Roadmap

| Phase | What ships | Size |
| --- | --- | --- |
| 0. Foundations | New repos; `@rebbehub/model` with Publication/Scan/Text layer/Recording/Sync added; Postgres schema (§6); ID scheme; rights policy. Importers load everything Sichos-Kodesh knows (mafteiach, JEM, Igros, Sefaria, HebrewBooks, chabadlibrary.org, archive history) as bot commits. | 3 weeks |
| 1. Read | Public site: sets, events calendar, item and publication pages, search, audio player, scan viewer, permanent links, SEO. Git mirror + first dump. | 5 weeks |
| 2. Contribute | Accounts, Reports, Suggest a fix, review queue, history, revert, trust levels, follow. | 5 weeks |
| 3. Scans and files | Uploads, dedup, publications and printings, contents maps, teshuros set, rights tiers, preservation bucket, IIIF. Sichos-Kodesh builds from RebbeHub releases; WP5b closed. | 5 weeks |
| 4. Text | Machine OCR on every scan, uploaded OCR, community text with line fixing and proofread levels, compare printings, Projects, Missing board. | 6 weeks |
| 5. Sync | Transcription, automatic alignment, synced player, "fix sync" tool, sync projects. | 5 weeks |
| 6. Network | Public API + webhooks, semantic search, citation cross-linking, translations, embeds, mirrors. | ongoing |

Milestone that proves it: by the end of phase 2, someone who has never
used GitHub fixes a wrong date on their phone in under a minute, and a
keeper approves it in one tap. By the end of phase 5, a farbrengen plays
with its words highlighted, and a user can fix a drifting line in two taps.

## 13. Open questions

- Name: "RebbeHub" now that the scope is all of Chabad — keep, or pick a
  broader name? Domain availability.
- Which rightsholders and which teshura collections to approach first.
- Initial stewards and set keepers.
- OCR and ASR engine choice after a benchmark on real Chabad pages and
  recordings (phase 4/5 spikes).

## 14. Risks

- **Rights**: the biggest. Link-first, `preserved` tier, attestations,
  fast takedown and family requests for teshuros.
- **Quiet community**: seed fully (phase 0) so it is useful before anyone
  contributes; projects and the Missing board give small, clear tasks.
- **Vandalism / low-quality edits**: review by default, trust levels,
  one-click revert.
- **Machine errors presented as the Rebbe's words**: machine text and sync
  are always labelled until checked.
- **Cost of OCR/ASR at this scale**: run in projects, on rented GPUs, only
  where people will check the output.
- **Bus factor**: open code, open data, dumps and the git mirror mean the
  project survives any one person or server.
