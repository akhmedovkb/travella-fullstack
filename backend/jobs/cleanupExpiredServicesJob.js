const pool = require("../db");

async function cleanupExpiredServicesJob() {
  const startedAt = new Date();
  console.log("[job] cleanupExpiredServicesJob started at", startedAt.toISOString());

  try {
    const upd = await pool.query(`
      UPDATE services
         SET
           status = 'archived',
           updated_at = NOW(),
           details = CASE
             WHEN details IS NULL THEN jsonb_build_object('isActive', false)
             WHEN jsonb_typeof(details::jsonb) = 'object'
               THEN jsonb_set(details::jsonb, '{isActive}', 'false'::jsonb, true)
             ELSE jsonb_build_object('isActive', false)
           END
       WHERE deleted_at IS NULL
         AND expiration_at IS NOT NULL
         AND expiration_at <= NOW()
         AND (
           status IS NULL
           OR lower(status) IN ('published', 'approved', 'active')
         )
       RETURNING id, category, status, expiration_at
    `);

    console.log(
      `[job] cleanupExpiredServicesJob finished. archived=${upd.rowCount}`
    );

    return {
      ok: true,
      archived: upd.rowCount,
      items: upd.rows,
    };
  } catch (e) {
    console.error("[job] cleanupExpiredServicesJob error:", e);
    return {
      ok: false,
      archived: 0,
      error: e?.message || String(e),
    };
  }
}

module.exports = {
  cleanupExpiredServicesJob,
};
