// backend/routes/providerCalendarRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");
const authenticateToken = require("../middleware/authenticateToken");

// --- утилиты ---
function asArray(v) {
  return Array.isArray(v) ? v : v ? [v] : [];
}
function toYMD(s) {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return String(s);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function mustProvider(req, res) {
  const id = req.user?.id;
  const role = req.user?.role;
  if (!id || role !== "provider") {
    res.status(403).json({ message: "Only provider can access this endpoint" });
    return null;
  }
  return id;
}

/**
 * GET /api/providers/booked-dates
 * Системно занятые даты из бронирований провайдера:
 * статусы: pending, confirmed
 */
router.get("/booked-dates", authenticateToken, async (req, res) => {
  const providerId = mustProvider(req, res);
  if (!providerId) return;

  try {
    const q = await pool.query(
      `SELECT DISTINCT bd.date::text AS date
         FROM booking_dates bd
         JOIN bookings b ON b.id = bd.booking_id
        WHERE b.provider_id = $1
          AND b.status IN ('confirmed','active')
          AND bd.date >= CURRENT_DATE
        ORDER BY bd.date`,
      [providerId]
    );
    // [{ date: 'YYYY-MM-DD' }, ...]
    res.json(q.rows);
  } catch (e) {
    console.error("booked-dates error:", e);
    res.status(500).json({ message: "booked-dates error" });
  }
});

/**
 * GET /api/providers/blocked-dates
 * Ручные блокировки провайдера (provider_blocked_dates)
 */
router.get("/blocked-dates", authenticateToken, async (req, res) => {
  const providerId = mustProvider(req, res);
  if (!providerId) return;

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
    console.error("blocked-dates error:", e);
    res.status(500).json({ message: "blocked-dates error" });
  }
});

/**
 * POST /api/providers/blocked-dates
 * Полная перезапись ручных блокировок.
 * body: { dates: string[] }
 */
router.post("/blocked-dates", authenticateToken, async (req, res) => {
  const providerId = mustProvider(req, res);
  if (!providerId) return;

  const unique = Array.from(
    new Set(asArray(req.body?.dates).map(toYMD).filter(Boolean))
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `DELETE FROM provider_blocked_dates WHERE provider_id=$1`,
      [providerId]
    );

    if (unique.length) {
      // предполагается уникальный индекс (provider_id, date)
      const values = unique.map((_, i) => `($1, $${i + 2}::date)`).join(",");
      await client.query(
        `INSERT INTO provider_blocked_dates (provider_id, date)
         VALUES ${values}
         ON CONFLICT (provider_id, date) DO NOTHING`,
        [providerId, ...unique]
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true, count: unique.length });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("blocked-dates save error:", e);
    res.status(500).json({ message: "blocked-dates save error" });
  } finally {
    client.release();
  }
});

/**
 * GET /api/providers/calendar
 * Единый эндпоинт: и ручные, и системно занятые.
 * Ответ: { blocked: [{date}], booked: [{date}] }
 */
router.get("/calendar", authenticateToken, async (req, res) => {
  const providerId = mustProvider(req, res);
  if (!providerId) return;

  try {
    const [booked, blocked] = await Promise.all([
      pool.query(
        `SELECT DISTINCT bd.date::text AS date
           FROM booking_dates bd
           JOIN bookings b ON b.id = bd.booking_id
          WHERE b.provider_id = $1
            AND b.status IN ('pending','confirmed')
            AND bd.date >= CURRENT_DATE
          ORDER BY bd.date`,
        [providerId]
      ),
      pool.query(
        `SELECT date::text AS date
           FROM provider_blocked_dates
          WHERE provider_id=$1
          ORDER BY date`,
        [providerId]
      ),
    ]);

    res.json({
      booked: booked.rows,   // [{date}]
      blocked: blocked.rows, // [{date}]
    });
  } catch (e) {
    console.error("calendar error:", e);
    res.status(500).json({ message: "calendar error" });
  }
});

module.exports = router;
