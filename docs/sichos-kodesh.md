# RebbeHub and Sichos-Kodesh

Sichos-Kodesh (the Sichos Kodesh apps, a separate repository) is
RebbeHub's first consumer and its origin. RebbeHub keeps no copy of its
content; the two meet at three contracts.

## 1. The works model

`@rebbehub/model` exports Sichos-Kodesh's works contract
(`packages/works/src/types.ts` there) unchanged, in
`packages/model/src/works.ts`: `Names`, `Author`, `Genre`, `SourceId`,
`Licence`, `EditionKind`, `WorkSource`, `Work`, `TextObjectRef`,
`Edition`, `Unit`, `RightsDecision`, `ContentsNode`, `ContentsEntry`,
`ImportedWork`. The one difference: `Work.collection` is a plain string,
since the phone's collection ids belong to Sichos-Kodesh's catalog.

Sichos-Kodesh can import these from `@rebbehub/model` in place of its own.
They change only together with Sichos-Kodesh. RebbeHub's own item types
(`entities.ts`) grow from them and widen them - more sources, more
languages, English names optional - without changing them.

Shared behaviour kept to the same contract:

- date keys (`5742-05-10`, Tishrei-first, `06A`/`06B`) =
  `toMafteiachHebrewDateKey` in its `packages/catalog`;
- `normalizeSearchText` = its `packages/app-core/src/search`;
- canonical JSON and Ed25519 manifest signatures = its `packages/pack-format`;
- rights: RebbeHub's four states map one to one onto its `RightsDecision`s.

## 2. RebbeHub reads Sichos-Kodesh (importers)

`rebbehub import sichos-kodesh-works --from <checkout>` reads the works
Sichos-Kodesh builds (`apps/mobile/src/catalog/data/works`, catalog schema
3) and suggests them as RebbeHub items, keeping the phone's ids in
`externalIds` (`sichos-kodesh-work`, `sichos-kodesh-unit`,
`sichos-kodesh-author`, `sichos-kodesh-collection`). The other Sichos-Kodesh
indexers become importers the same way ([roadmap](roadmap.md)).

## 3. Sichos-Kodesh builds from RebbeHub (releases)

Every catalog edition's dumps include `sichos-kodesh-<tag>.json`:

```ts
interface SichosKodeshRelease {
  format: 'rebbehub-sichos-kodesh-works';
  formatVersion: 1;
  tag: string;          // the catalog edition, e.g. "2026.40"
  commit: number;
  authors: Author[];    // its ids (slugs) restored
  works: Work[];
  imported: ImportedWork[]; // contents and units, with the phone's unit ids
}
```

These are exactly the inputs of its `buildCatalogWorks`, so
`packages/catalog/bin/build.ts` there can take a RebbeHub release in place
of its hand-kept registry and importer output. The release's
`manifest.json` is signed like its packs, so it verifies with
`pack-format`'s `verifyManifest` against RebbeHub's published key.

When that switch is made, Sichos-Kodesh stops curating its own catalog,
and fixes flow the other way: through RebbeHub suggestions.

## 4. Scans and their reading copies

The Sichos Kodesh hanachos Sichos-Kodesh's archive holds are RebbeHub
files, each with a reading copy ([operations](operations.md)). The
published manifest (`/manifests/reading-copies/sichos-kodesh.json`) keys
them by the catalog's `driveFileId`, so Sichos-Kodesh's apps can open a
PDF's reading copy from `https://api.rebbehub.org/objects/<sha256>` and
keep the original one tap away.

## 5. What Sichos-Kodesh still needs from a release

A release carries works only (section 3). The apps' own
`packages/catalog/bin/build.ts` builds two more things, from
`mafteiach.db` and `jem.db`, that a release does not carry yet:

- **the farbrengens by year** (`<year>.json`, catalog schema 1): events
  with their occasion ids, the parts of each, and the PDFs and
  recordings of each part. RebbeHub has these as events, recordings and
  scans once the `mafteiach` and `jem` importers are written;
- **the library** (catalog schema 2): the collections the phone browses,
  their units and their PDF editions, and the JEM collection.

For the apps to build wholly from RebbeHub, a release would add, beside
`works`:

- `events` keyed by the phone's event ids, with dates as date keys;
- for each event and unit, its files: `sha256`, rights state, address
  (`/objects/<sha256>` when served, the source's link when not), page
  count and, when made, the reading copy's `sha256`;
- recordings with their JEM links and parts' times;
- for teshuros, the credit line; a file a family asked to stop showing
  is `preserved` and so never carries an address.

Page images and IIIF manifests (`/manifests/iiif/<scan>.json`) are for
the web and need nothing from the apps. Until those are in a release,
Sichos-Kodesh keeps building its farbrengens and library as it does now.
