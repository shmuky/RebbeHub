# How RebbeHub is run

RebbeHub belongs to the community. This page says who decides what, and
how anyone can check that decisions are made fairly. It follows section 11
of [the plan](docs/plans/rebbehub.md).

## Roles

| Role | May | Becomes one by |
| --- | --- | --- |
| **Visitor** | read, download everything, report a problem | - |
| **Contributor** | suggest fixes, upload, fix lines of text and sync | signing in |
| **Trusted** | small fixes to text and sync go live at once in *open* sets, and are reviewed after | 20 approved suggestions with none reverted (automatic) |
| **Keeper** | approve or send back suggestions in their sets; run projects; close reports | appointed by stewards, per set |
| **Steward** | everything: appoint keepers, set policies, change the schema, rights and takedowns | the governing group |

Bots (importers, OCR, sync) are contributors labelled as bots. They
never approve anything, their own work least of all. Nobody but a steward
approves their own suggestion.

The first steward is Shmuly ([@shmuky](https://github.com/shmuky)). Stewards
and set keepers are listed in the catalog itself (each set names its
keepers) and in [.github/CODEOWNERS](.github/CODEOWNERS) for the code.

## Sets and their policies

Every item belongs to a **set** (Likkutei Sichos, Igros Kodesh, Teshuros,
Farbrengens 5742 …), and every set has keepers and a policy:

- **open** - trusted contributors' line fixes go live at once; catalog
  facts are still reviewed;
- **moderated** (the default) - every change is reviewed first;
- **locked** - rights are not cleared; only stewards change it and nothing
  in it is served.

## Everything is on the record

- Every change is a suggestion with an author, a reviewer and a history;
  any version can be restored, and any merged suggestion undone in one step.
- Every moderator action - sending back, reverting, closing a report,
  changing rights, suspending an account, appointing a steward - is logged
  and reversible.
- The whole catalog is exported after every change, so anyone can audit it.

## Content policy

RebbeHub holds authentic Chabad material, described respectfully, with
sources. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Rights and takedowns

Files start in the most careful state their source allows (see
[docs/rights.md](docs/rights.md)). Anyone may ask for a file to be taken
down through the [rights form](https://github.com/shmuky/RebbeHub/issues/new?template=3-rights.yml)
(and, once the site is live, its own public form). A steward can move a
file out of public view in one click - it is kept privately, never
deleted - and the action is logged. The response time RebbeHub commits to
is set by the stewards and published here before launch.

## Changing this document

Like everything else: a pull request, approved by a steward.
