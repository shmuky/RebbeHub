## What this changes

<!-- In plain words: what someone using RebbeHub will notice, or what it makes possible. -->

## Why

<!-- Link the issue (Fixes #…) or the part of docs/plans/rebbehub.md it builds. -->

## How it was checked

- [ ] `npm run check` passes (types, tests, schemas)
- [ ] New behaviour has tests
- [ ] Data model or API changes are reflected in `docs/` and, for the model, agreed with Sichos-Kodesh (see `docs/sichos-kodesh.md`)
- [ ] API changes are in `services/api/src/openapi.ts`, the client is regenerated (`npm run generate -w @rebbehub/client`), and CHANGELOG.md says what changed
- [ ] No rights-restricted content (texts, scans, recordings) is added to this repository
