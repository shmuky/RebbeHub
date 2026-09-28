# RebbeHub

The open, community-edited index of Chabad Torah and media. The plan is
docs/plans/rebbehub.md; what is built and what is next is docs/roadmap.md.

## Working here

- `npm run check` before every push (typecheck, tests, schema check). Tests
  run on PGlite; set REBBEHUB_TEST_DATABASE_URL to an empty Postgres
  database to run them on a server too (`--no-file-parallelism`).
- Branch from main (`fix/…`, `feat/…`, `docs/…`, `chore/…`), open a PR
  using the template; CODEOWNERS review.
- Migrations in packages/db/src/migrations are never edited once released;
  add a new one.
- packages/model/src/works.ts is Sichos-Kodesh's works contract, kept
  verbatim; change it only together with Sichos-Kodesh
  (docs/sichos-kodesh.md). RebbeHub keeps no copy of Sichos-Kodesh's
  content: importers read a checkout at run time.
- Never commit texts, scans or recordings, or any signing key or secret.
- Machine output (OCR, transcription, sync) is always labelled until a
  person checks it.
- Write like the code around you: plain-language doc comments that say
  why, in the plan's words (Suggestion, Report, Approve, Project, Set).
