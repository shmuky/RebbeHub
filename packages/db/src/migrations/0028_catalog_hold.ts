import { CATALOG_HELD, CATALOG_HOLD_LOCK, HOLD_EVERY_TABLE_SQL } from '../hold.js';

/**
 * Every write to the catalog first checks that no import holds it
 * (packages/db/src/hold.ts), so an import no longer stops when someone
 * writes while it runs, and nobody has to pause for it.
 *
 * The check takes the import's lock shared until the write's transaction
 * ends, so an import that wants it waits for writes already under way and
 * then refuses the rest. The import's own copy back says
 * `rebbehub.import = on` and is let through. The function lives in `auth`,
 * like auth.number_thread, because an import replaces the tables in
 * `public` whole and leaves `auth` alone.
 */
export const up = /* sql */ `
CREATE FUNCTION auth.catalog_write_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF coalesce(current_setting('rebbehub.import', true), '') <> 'on'
     AND NOT pg_try_advisory_xact_lock_shared(${CATALOG_HOLD_LOCK}) THEN
    RAISE EXCEPTION 'RebbeHub is bringing in an import; nothing was changed. Try again in a few minutes.'
      USING ERRCODE = '${CATALOG_HELD}';
  END IF;
  RETURN NULL;
END $$;
${HOLD_EVERY_TABLE_SQL}
`;
