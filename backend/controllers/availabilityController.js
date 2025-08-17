// backend/controllers/availabilityController.js
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ...(process.env.NODE_ENV === "production"
    ? { ssl: { rejectUnauthorized: false } }
    : {}),
});

/** Нормализуем -> ['YYYY-MM-DD'] */
function rowsToISO(rows, field = "d") {
  return (rows || [])
    .map((r) => (r[field] instanceof Date ? r[field] : new Date(r[field])))
    .filter((d) => !Number.isNaN(d.getTime()))
    .map((d) => d.toISOString().slice(0, 10));
}

/**
 * GET /api/availability?serviceId=123  (или ?providerId=456)
 * → { booked: [...], blocked: [...] }
 */
exports.getAvailability = async (req, res) => {
  try {
    const { serviceId, providerId } = req.query;
    let pid = providerId;

    if (!pid && serviceId) {
      const svc = await pool.query(
        "SELECT provider_id FROM services WHERE id=$1 LIMIT 1",
        [serviceId]
      );
      pid = svc.rows?.[0]?.provider_id;
    }
    if (!pid) return res.status(400).json({ error: "providerId or serviceId required" });

    // брони: pending/active блокируют даты
    const bookedQ = await pool.query(
      `SELECT bd.date::date AS d
       FROM booking_dates bd
       JOIN bookings b ON b.id = bd.booking_id
       WHERE b.provider_id = $1 AND b.status IN ('pending','active')`,
      [pid]
    );
    const blockedQ = await pool.query(
      `SELECT date::date AS d
       FROM provider_blocked_dates
       WHERE provider_id = $1`,
      [pid]
    );

    res.json({
      booked: rowsToISO(bookedQ.rows),
      blocked: rowsToISO(blockedQ.rows),
    });
  } catch (e) {
    console.error("availability error:", e);
    res.status(500).json({ error: "failed" });
  }
};
