const pool = require("../db");

async function hasRows(table, field, serviceId) {
  const q = await pool.query(
    `SELECT 1 FROM ${table} WHERE ${field} = $1 LIMIT 1`,
    [serviceId]
  );
  return q.rowCount > 0;
}

async function purgeDeletedServicesJob() {
  const startedAt = new Date();
  console.log("[job] purgeDeletedServicesJob started at", startedAt.toISOString());

  try {
    const oldDeleted = await pool.query(`
      SELECT id, provider_id, deleted_at
      FROM services
      WHERE deleted_at IS NOT NULL
        AND deleted_at < NOW() - INTERVAL '30 days'
      ORDER BY deleted_at ASC
      LIMIT 500
    `);

    let purged = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of oldDeleted.rows) {
      const serviceId = row.id;

      try {
        const blockers = [];

        try {
          if (await hasRows("bookings", "service_id", serviceId)) {
            blockers.push("HAS_BOOKINGS");
          }
        } catch (e) {
          console.warn("[job] purge check bookings skipped:", e?.message || e);
        }

        try {
          if (await hasRows("requests", "service_id", serviceId)) {
            blockers.push("HAS_REQUESTS");
          }
        } catch (e) {
          console.warn("[job] purge check requests skipped:", e?.message || e);
        }

        try {
          if (await hasRows("client_service_contact_unlocks", "service_id", serviceId)) {
            blockers.push("HAS_UNLOCKS");
          }
        } catch (e) {
          console.warn("[job] purge check unlocks skipped:", e?.message || e);
        }

        try {
          if (await hasRows("wishlist", "service_id", serviceId)) {
            blockers.push("HAS_WISHLIST");
          }
        } catch (e) {
          console.warn("[job] purge check wishlist skipped:", e?.message || e);
        }

        try {
          if (await hasRows("provider_favorites", "service_id", serviceId)) {
            blockers.push("HAS_PROVIDER_FAVORITES");
          }
        } catch (e) {
          console.warn("[job] purge check provider_favorites skipped:", e?.message || e);
        }

        if (blockers.length) {
          skipped += 1;
          console.log(
            `[job] purge skipped service #${serviceId}, blockers=${blockers.join(",")}`
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

        if (del.rowCount > 0) {
          purged += 1;
          console.log(`[job] purged deleted service #${serviceId}`);
        } else {
          skipped += 1;
        }
      } catch (e) {
        failed += 1;
        console.error(`[job] failed to purge service #${serviceId}:`, e?.message || e);
      }
    }

    console.log(
      `[job] purgeDeletedServicesJob finished. purged=${purged}, skipped=${skipped}, failed=${failed}`
    );

    return {
      ok: true,
      scanned: oldDeleted.rowCount,
      purged,
      skipped,
      failed,
    };
  } catch (e) {
    console.error("[job] purgeDeletedServicesJob fatal error:", e);
    return {
      ok: false,
      scanned: 0,
      purged: 0,
      skipped: 0,
      failed: 0,
      error: e?.message || String(e),
    };
  }
}

module.exports = {
  purgeDeletedServicesJob,
};
