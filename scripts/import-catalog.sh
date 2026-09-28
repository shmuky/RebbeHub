#!/usr/bin/env bash
# Fills the live catalog from a Sichos-Kodesh checkout, or brings it up to
# date. Used by .github/workflows/import.yml; see docs/deploy.md.
#
#   scripts/import-catalog.sh <Sichos-Kodesh checkout> <steward id> <steward name>
#
# DATABASE_URL is the live database. BUILD_DATABASE_URL is an empty
# Postgres on this machine.
#
# An import writes item by item, and each item is many round trips to the
# database: minutes next to the database, hours across the internet. So
# while everything in the live catalog came from importers, the catalog is
# rebuilt here from its sources and copied in whole, in one transaction
# that first checks people have still added nothing. Once they have, it is
# updated in place, which changes only what the sources changed.
set -euo pipefail

from=$1
steward=$2
steward_name=$3
: "${DATABASE_URL:?DATABASE_URL is not set}"
live=$DATABASE_URL

rebbehub() { npm run --silent rebbehub -- "$@"; }
import_into() {
  DATABASE_URL=$1 rebbehub account --id "$steward" --name "$steward_name" --steward
  importers="sichos-kodesh-works sichos-kodesh-occasions otzros hebrewbooks"
  # A page per chapter of the Chabad Library, once its contents are crawled (import.yml).
  if [ -n "${CHABADLIBRARY_TREE:-}" ] && [ -f "$CHABADLIBRARY_TREE" ]; then importers="$importers chabadlibrary"; fi
  # JEM's recordings, once its catalog is crawled (import.yml), after the farbrengens they join.
  if [ -n "${JEM_DB:-}" ] && [ -f "$JEM_DB" ]; then importers="$importers jem"; fi
  # Sefaria's Chabad books Sichos-Kodesh does not publish, once `rebbehub crawl-sefaria` has read them.
  if [ -n "${SEFARIA_DATA:-}" ] && [ -f "$SEFARIA_DATA/crawl.json" ]; then importers="$importers sefaria"; fi
  # The letters' dates, where a build of the Igros app's files is given (never in CI: the files are Shmuly's).
  if [ -n "${IGROS_DATA:-}" ] && [ -d "$IGROS_DATA/igros" ]; then importers="$importers igros"; fi
  # Sichos-Kodesh's archive history, last: it adds to the items the others made. Given a copy of its index.
  if [ -n "${SK_ARCHIVE_DB:-}" ] && [ -f "$SK_ARCHIVE_DB" ]; then importers="$importers archive"; fi
  for importer in $importers; do
    DATABASE_URL=$1 rebbehub import "$importer" --from "$from" --approve-as "$steward"
  done
  # The files the archive could not get, onto the Missing board.
  if [ -n "${SK_ARCHIVE_DB:-}" ] && [ -f "$SK_ARCHIVE_DB" ]; then DATABASE_URL=$1 rebbehub archive-gaps --db "$SK_ARCHIVE_DB"; fi
  # The Sichos Kodesh scans and their reading copies (docs/operations.md), from the published manifest.
  DATABASE_URL=$1 rebbehub reading-copies register
  DATABASE_URL=$1 rebbehub page-fixes register
}

DATABASE_URL=$live rebbehub migrate
if [ "$(DATABASE_URL=$live rebbehub rebuildable | tail -n 1)" != "rebuildable" ]; then
  echo "People have added to the live catalog: updating it in place."
  import_into "$live"
  exit 0
fi

: "${BUILD_DATABASE_URL:?BUILD_DATABASE_URL is not set}"
echo "Everything in the live catalog came from importers: rebuilding it here, then copying it in whole."
DATABASE_URL=$BUILD_DATABASE_URL rebbehub migrate
import_into "$BUILD_DATABASE_URL"

# Every table is dropped whole and made again from the dump (pg_dump's own
# --clean cannot drop a partitioned table's constraints one by one).
{
  rebbehub rebuildable --guard
  cat <<'SQL'
SET client_min_messages = warning;
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', t);
  END LOOP;
END $$;
SQL
  # People's accounts, passkeys and sessions (the auth schema) are never the catalog's to replace.
  pg_dump --no-owner --no-privileges --exclude-schema=auth "$BUILD_DATABASE_URL"
} | psql "$live" --quiet --no-psqlrc -v ON_ERROR_STOP=1 --single-transaction --output /dev/null
echo "Copied: the live catalog is the new build."
