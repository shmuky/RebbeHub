# OAI-PMH for libraries

`https://api.rebbehub.org/oai` speaks
[OAI-PMH 2.0](https://www.openarchives.org/OAI/openarchivesprotocol.html),
so library catalogs and aggregators can harvest RebbeHub like any
repository (it is on once the server names its administrators' address,
`OAI_ADMIN_EMAIL`; see [configuration](../configuration.md)).

- **Records**: sefarim, sichos and letters, farbrengens, printings and
  recordings, as Dublin Core (`oai_dc`). Records are CC0.
- **Identifiers**: `oai:rebbehub.org:rh-…`, the item's permanent id.
- **Dates**: a record's datestamp is when the commit that last changed it
  was made; harvest by `from` and `until` (day granularity or seconds).
- **Sets**: by kind (`type:unit`, `type:event`, `type:publication`…) and
  by RebbeHub set (`set:rh-…`); `ListSets` lists them.
- **Deletions** are kept (`deletedRecord: persistent`): a deleted item
  answers with a deleted header.
- **Pages**: a hundred records at a time, with a `resumptionToken`.
- Words withheld for rights are never in a record.

```
/oai?verb=Identify
/oai?verb=ListSets
/oai?verb=ListRecords&metadataPrefix=oai_dc&from=2026-09-01
/oai?verb=ListRecords&metadataPrefix=oai_dc&set=type:unit
/oai?verb=GetRecord&metadataPrefix=oai_dc&identifier=oai:rebbehub.org:rh-7k2m9q4d
```

`POST /oai` takes the same arguments as a form.

## IIIF

Every scan RebbeHub serves has a IIIF Presentation 3 manifest,
`https://api.rebbehub.org/manifests/iiif/<scan id>.json`: right to left,
its page images, the PDF as its rendering, the credit as its required
statement. Open it in any IIIF viewer (Mirador, Universal Viewer).
