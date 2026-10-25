const pool = require("../db");

const INDEX_NAME = "ux_provider_services_business_identity";

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
               LOWER(TRIM(COALESCE(details->>'vehicle_model', vehicle_model, '')))
          FROM provider_services
         GROUP BY 1, 2, 3, 4, 5, 6
        HAVING COUNT(*) > 1
      ) duplicate_groups
  `);

  const duplicateCount = Number(duplicates.rows[0]?.count || 0);
  if (duplicateCount > 0) {
    console.warn(`[provider-services] unique identity index deferred: ${duplicateCount} duplicate group(s) require review`);
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
        LOWER(TRIM(COALESCE(details->>'vehicle_model', vehicle_model, '')))
      )
  `);
  console.log(`[provider-services] ${INDEX_NAME} ready`);
}

main()
  .catch((error) => {
    console.error("[provider-services] identity index check failed", error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
