const pool = require("../db");

async function main() {
  const result = await pool.query(`
    SELECT provider_id,
           LOWER(TRIM(category)) AS category,
           LOWER(TRIM(COALESCE(details->>'city_slug', ''))) AS city,
           LOWER(TRIM(COALESCE(details->>'origin_city', ''))) AS origin,
           LOWER(TRIM(COALESCE(details->>'destination_city', ''))) AS destination,
           LOWER(TRIM(COALESCE(details->>'vehicle_model', vehicle_model, ''))) AS vehicle,
           ARRAY_AGG(id ORDER BY id) AS service_ids,
           COUNT(*)::int AS count
      FROM provider_services
     GROUP BY 1, 2, 3, 4, 5, 6
    HAVING COUNT(*) > 1
     ORDER BY count DESC, provider_id
  `);
  console.log(JSON.stringify({ duplicate_groups: result.rowCount, groups: result.rows }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
