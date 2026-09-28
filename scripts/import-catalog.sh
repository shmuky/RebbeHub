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
# an empty live catalog is built here and copied in whole, in one
# transaction that first checks it is still empty. A catalog that already
# holds anything is updated in place, which changes only what the source
# changed.
set -euo pipefail

from=$1
steward=$2
steward_name=$3
: "${DATABASE_URL:?DATABASE_URL is not set}"
live=$DATABASE_URL

rebbehub() { npm run --silent rebbehub -- "$@"; }
import_into() {
  DATABASE_URL=$1 rebbehub account --id "$steward" --name "$steward_name" --steward
  DATABASE_URL=$1 rebbehub import sichos-kodesh-works --from "$from" --approve-as "$steward"
}

DATABASE_URL=$live rebbehub migrate
if [ "$(DATABASE_URL=$live rebbehub is-empty | tail -n 1)" != "empty" ]; then
  echo "The live catalog already holds items: updating it in place."
  import_into "$live"
  exit 0
fi

: "${BUILD_DATABASE_URL:?BUILD_DATABASE_URL is not set}"
echo "The live catalog is empty: building it here, then copying it in whole."
DATABASE_URL=$BUILD_DATABASE_URL rebbehub migrate
import_into "$BUILD_DATABASE_URL"

# Every table is dropped whole and made again from the dump (pg_dump's own
# --clean cannot drop a partitioned table's constraints one by one).
{
  rebbehub is-empty --guard
  cat <<'SQL'
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', t);
  END LOOP;
END $$;
SQL
  pg_dump --no-owner --no-privileges "$BUILD_DATABASE_URL"
} | psql "$live" --quiet --no-psqlrc -v ON_ERROR_STOP=1 --single-transaction --output /dev/null
echo "Copied. The live catalog is now $(DATABASE_URL=$live rebbehub is-empty | tail -n 1)."
