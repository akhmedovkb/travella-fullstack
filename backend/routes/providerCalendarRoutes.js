// backend/routes/providerCalendarRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const authenticateToken = require("../middleware/authenticateToken");

// GET /api/providers/booked-dates
// Занятые даты по живым броням (pending/active) текущего провайдера
router.get("/booked-dates", authenticateToken, async (req, res) => {
  const providerId = req.user?.id;
  const role = req.user?.role;
  if (!providerId || role !== "provider") {
    return res.status(403).json({ message: "Only provider can request booked dates" });
  }
  try {
    const q = await pool.query(
      `SELECT DISTINCT bd.date::text AS date
         FROM booking_dates bd
         JOIN bookings b ON b.id = bd.booking_id
        WHERE b.provider_id=$1
          AND b.status IN ('pending','active')
          AND bd.date >= CURRENT_DATE
        ORDER BY bd.date ASC`,
      [providerId]
    );
    res.json(q.rows); // фронт ждёт массив объектов с полем date
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "booked-dates error" });
  }
});

// GET /api/providers/blocked-dates
// Ручные блокировки провайдера
router.get("/blocked-dates", authenticateToken, async (req, res) => {
  const providerId = req.user?.id;
  const role = req.user?.role;
  if (!providerId || role !== "provider") {
    return res.status(403).json({ message: "Only provider can request blocked dates" });
  }
  try {
    const q = await pool.query(
      `SELECT date::text AS date
         FROM provider_blocked_dates
        WHERE provider_id=$1
        ORDER BY date ASC`,
      [providerId]
    );
    res.json(q.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "blocked-dates error" });
  }
});

// POST /api/providers/blocked-dates  { dates: string[] }
// Полностью перезаписывает ручные блокировки провайдера
router.post("/blocked-dates", authenticateToken, async (req, res) => {
  const providerId = req.user?.id;
  const role = req.user?.role;
  if (!providerId || role !== "provider") {
    return res.status(403).json({ message: "Only provider can modify blocked dates" });
  }

  const asArray = (v) => (Array.isArray(v) ? v : []);
  const toISO = (s) => {
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    try {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return null;
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    } catch { return null; }
  };

  const unique = Array.from(new Set(asArray(req.body?.dates).map(toISO).filter(Boolean)));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`DELETE FROM provider_blocked_dates WHERE provider_id=$1`, [providerId]);

    if (unique.length) {
      const values = unique.map((_, i) => `($1, $${i + 2})`).join(",");
      await client.query(
        `INSERT INTO provider_blocked_dates (provider_id, date)
         VALUES ${values}
         ON CONFLICT DO NOTHING`,
        [providerId, ...unique]
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true, count: unique.length });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error(e);
    res.status(500).json({ message: "blocked-dates save error" });
  } finally {
    client.release();
  }
});

module.exports = router;
