const pool = require("../db");

const INDEX_NAME = "ux_provider_services_business_identity";
const TRIGGER_NAME = "trg_provider_services_business_identity";

async function ensureDuplicateTrigger() {
  await pool.query(`
    CREATE OR REPLACE FUNCTION prevent_provider_service_duplicate()
    RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'UPDATE' THEN
        IF LOWER(TRIM(OLD.category)) = LOWER(TRIM(NEW.category))
           AND LOWER(TRIM(COALESCE(OLD.details->>'city_slug', ''))) = LOWER(TRIM(COALESCE(NEW.details->>'city_slug', '')))
           AND LOWER(TRIM(COALESCE(OLD.details->>'origin_city', ''))) = LOWER(TRIM(COALESCE(NEW.details->>'origin_city', '')))
           AND LOWER(TRIM(COALESCE(OLD.details->>'destination_city', ''))) = LOWER(TRIM(COALESCE(NEW.details->>'destination_city', '')))
           AND LOWER(TRIM(COALESCE(OLD.details->>'vehicle_model', OLD.vehicle_model, ''))) = LOWER(TRIM(COALESCE(NEW.details->>'vehicle_model', NEW.vehicle_model, '')))
           AND LOWER(TRIM(COALESCE(OLD.details->>'pricing_mode', 'fixed'))) = LOWER(TRIM(COALESCE(NEW.details->>'pricing_mode', 'fixed')))
        THEN
          RETURN NEW;
        END IF;
      END IF;

      PERFORM pg_advisory_xact_lock(NEW.provider_id::bigint);
      IF EXISTS (
        SELECT 1
          FROM provider_services existing
         WHERE existing.provider_id = NEW.provider_id
           AND existing.id <> COALESCE(NEW.id, 0)
           AND LOWER(TRIM(existing.category)) = LOWER(TRIM(NEW.category))
           AND LOWER(TRIM(COALESCE(existing.details->>'city_slug', ''))) = LOWER(TRIM(COALESCE(NEW.details->>'city_slug', '')))
           AND LOWER(TRIM(COALESCE(existing.details->>'origin_city', ''))) = LOWER(TRIM(COALESCE(NEW.details->>'origin_city', '')))
           AND LOWER(TRIM(COALESCE(existing.details->>'destination_city', ''))) = LOWER(TRIM(COALESCE(NEW.details->>'destination_city', '')))
           AND LOWER(TRIM(COALESCE(existing.details->>'vehicle_model', existing.vehicle_model, ''))) = LOWER(TRIM(COALESCE(NEW.details->>'vehicle_model', NEW.vehicle_model, '')))
           AND LOWER(TRIM(COALESCE(existing.details->>'pricing_mode', 'fixed'))) = LOWER(TRIM(COALESCE(NEW.details->>'pricing_mode', 'fixed')))
      ) THEN
        RAISE EXCEPTION 'duplicate provider service'
          USING ERRCODE = '23505', CONSTRAINT = '${INDEX_NAME}';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS ${TRIGGER_NAME} ON provider_services;
    CREATE TRIGGER ${TRIGGER_NAME}
      BEFORE INSERT OR UPDATE OF provider_id, category, details, vehicle_model
      ON provider_services
      FOR EACH ROW EXECUTE FUNCTION prevent_provider_service_duplicate();
  `);
}

async function main() {
  const table = await pool.query(`SELECT to_regclass('public.provider_services') AS name`);
  if (!table.rows[0]?.name) return;

  const duplicates = await pool.query(`
    SELECT COUNT(*)::int AS count
      FROM (
        SELECT provider_id,
               LOWER(TRIM(category)),
               LOWER(TRIM(COALESCE(details->>'city_slug', ''))),
               LOWER(TRIM(COALESCE(details->>'origin_city', ''))),
               LOWER(TRIM(COALESCE(details->>'destination_city', ''))),
               LOWER(TRIM(COALESCE(details->>'vehicle_model', vehicle_model, ''))),
               LOWER(TRIM(COALESCE(details->>'pricing_mode', 'fixed')))
          FROM provider_services
         GROUP BY 1, 2, 3, 4, 5, 6, 7
        HAVING COUNT(*) > 1
      ) duplicate_groups
  `);

  const duplicateCount = Number(duplicates.rows[0]?.count || 0);
  if (duplicateCount > 0) {
    await ensureDuplicateTrigger();
    console.warn(`[provider-services] ${TRIGGER_NAME} ready; unique index deferred while ${duplicateCount} duplicate group(s) require review`);
    return;
  }

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ${INDEX_NAME}
      ON provider_services (
        provider_id,
        LOWER(TRIM(category)),
        LOWER(TRIM(COALESCE(details->>'city_slug', ''))),
        LOWER(TRIM(COALESCE(details->>'origin_city', ''))),
        LOWER(TRIM(COALESCE(details->>'destination_city', ''))),
        LOWER(TRIM(COALESCE(details->>'vehicle_model', vehicle_model, ''))),
        LOWER(TRIM(COALESCE(details->>'pricing_mode', 'fixed')))
      )
  `);
  await pool.query(`DROP TRIGGER IF EXISTS ${TRIGGER_NAME} ON provider_services`);
  console.log(`[provider-services] ${INDEX_NAME} ready`);
}

main()
  .catch((error) => {
    console.error("[provider-services] identity index check failed", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
