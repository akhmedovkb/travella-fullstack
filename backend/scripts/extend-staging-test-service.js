const pool = require("../db");

async function main() {
  const serviceId = Number(process.env.STAGING_SERVICE_ID || 6);
  const expirationTs = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

  const { rows } = await pool.query(
    `
    UPDATE services
       SET details = jsonb_set(
             COALESCE(details, '{}'::jsonb),
             '{expiration_ts}',
             to_jsonb($1::bigint),
             true
           ),
           updated_at = NOW()
     WHERE id = $2
     RETURNING id, title, status, moderation_status, details->>'expiration_ts' AS expiration_ts
    `,
    [expirationTs, serviceId]
  );

  console.log(JSON.stringify(rows[0] || null));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
