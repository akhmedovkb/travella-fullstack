const pool = require("../db");

async function purgeDeletedServicesJob() {
  const startedAt = new Date();
  console.log("[job] purgeDeletedServicesJob started at", startedAt.toISOString());

  try {
    const oldDeleted = await pool.query(
      `
      SELECT s.id, s.provider_id, s.deleted_at
      FROM services s
      WHERE s.deleted_at IS NOT NULL
        AND s.deleted_at < NOW() - INTERVAL '30 days'
      ORDER BY s.deleted_at ASC
      LIMIT 500
      `
    );

    let purged = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of oldDeleted.rows) {
      const serviceId = row.id;

      try {
        const blockers = [];

        const checks = [
          { table: "bookings", field: "service_id", code: "HAS_BOOKINGS" },
          { table: "booking_requests", field: "service_id", code: "HAS_REQUESTS" },
          { table: "client_service_contact_unlocks", field: "service_id", code: "HAS_UNLOCKS" },
          { table: "provider_favorites", field: "service_id", code: "HAS_FAVORITES" },
        ];

        for (const c of checks) {
          try {
            const r = await pool.query(
              `SELECT 1 FROM ${c.table} WHERE ${c.field} = $1 LIMIT 1`,
              [serviceId]
            );
            if (r.rowCount) blockers.push(c.code);
          } catch (e) {
            console.warn(`[job] purge check skipped for ${c.table}:`, e.message);
          }
        }

        if (blockers.length) {
          skipped += 1;
          console.log(
            `[job] purge skipped service #${serviceId}, blockers: ${blockers.join(", ")}`
          );
          continue;
        }

        const del = await pool.query(
          `
          DELETE FROM services
          WHERE id = $1
            AND deleted_at IS NOT NULL
          RETURNING id
          `,
          [serviceId]
        );

        if (del.rowCount) {
          purged += 1;
          console.log(`[job] purged service #${serviceId}`);
        } else {
          skipped += 1;
        }
      } catch (e) {
        failed += 1;
        console.error(`[job] failed to purge service #${serviceId}:`, e.message || e);
      }
    }

    console.log(
      `[job] purgeDeletedServicesJob finished. purged=${purged}, skipped=${skipped}, failed=${failed}`
    );
  } catch (e) {
    console.error("[job] purgeDeletedServicesJob fatal error:", e);
  }
}

module.exports = { purgeDeletedServicesJob };
