// backend/routes/providerCalendarRoutes.js

const express = require("express");
const router = express.Router();
const pool = require("../db");
const authenticateToken = require("../middleware/authenticateToken");

// утилита: нормализовать YYYY-MM-DD
const normYMD = (s) => {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

/**
 * GET /api/providers/booked-dates?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Занятые даты по ЖИВЫМ броням текущего провайдера.
 * ВАЖНО: учитываем ТОЛЬКО status='active' (подтверждённые).
 * Если from/to не переданы — по умолчанию от сегодня и дальше.
 * Ответ: [{ date: 'YYYY-MM-DD' }, ...]
 */
router.get("/booked-dates", authenticateToken, async (req, res) => {
  const providerId = req.user?.id;
  const role = req.user?.role;
  if (!providerId || role !== "provider") {
    return res.status(403).json({ message: "Only provider can request booked dates" });
  }

  const from = normYMD(req.query.from);
  const to   = normYMD(req.query.to);

  try {
    const where = ["b.provider_id = $1", "b.status = 'active'"];
    const params = [providerId];
    let idx = 2;

    if (from) { where.push(`bd.date >= $${idx++}::date`); params.push(from); }
    if (to)   { where.push(`bd.date <= $${idx++}::date`); params.push(to); }
    if (!from && !to) { where.push(`bd.date >= CURRENT_DATE`); }

    const sql = `
      SELECT DISTINCT bd.date::text AS date
      FROM booking_dates bd
      JOIN bookings b ON b.id = bd.booking_id
      WHERE ${where.join(" AND ")}
      ORDER BY bd.date ASC
    `;

    const q = await pool.query(sql, params);
    res.json(q.rows);
  } catch (e) {
    console.error("booked-dates error:", e);
    res.status(500).json({ message: "booked-dates error" });
  }
});

/**
 * GET /api/providers/blocked-dates?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Ручные блокировки провайдера (таблица provider_blocked_dates).
 * Ответ: [{ date: 'YYYY-MM-DD' }, ...]
 */
router.get("/blocked-dates", authenticateToken, async (req, res) => {
  const providerId = req.user?.id;
  const role = req.user?.role;
  if (!providerId || role !== "provider") {
    return res.status(403).json({ message: "Only provider can request blocked dates" });
  }

  const from = normYMD(req.query.from);
  const to   = normYMD(req.query.to);

  try {
    const where = ["provider_id = $1"];
    const params = [providerId];
    let idx = 2;

    if (from) { where.push(`date >= $${idx++}::date`); params.push(from); }
    if (to)   { where.push(`date <= $${idx++}::date`); params.push(to); }

    const sql = `
      SELECT date::text AS date
      FROM provider_blocked_dates
      WHERE ${where.join(" AND ")}
      ORDER BY date ASC
    `;

    const q = await pool.query(sql, params);
    res.json(q.rows);
  } catch (e) {
    console.error("blocked-dates error:", e);
    res.status(500).json({ message: "blocked-dates error" });
  }
});

/**
 * POST /api/providers/blocked-dates
 * Body: { dates: string[] }  — Полностью перезаписывает ручные блокировки.
 */
router.post("/blocked-dates", authenticateToken, async (req, res) => {
  const providerId = req.user?.id;
  const role = req.user?.role;
  if (!providerId || role !== "provider") {
    return res.status(403).json({ message: "Only provider can modify blocked dates" });
  }

  const asArray = (v) => (Array.isArray(v) ? v : []);
  const unique = Array.from(new Set(asArray(req.body?.dates).map(normYMD).filter(Boolean)));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `DELETE FROM provider_blocked_dates WHERE provider_id = $1`,
      [providerId]
    );

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
    console.error("blocked-dates save error:", e);
    res.status(500).json({ message: "blocked-dates save error" });
  } finally {
    client.release();
  }
});

module.exports = router;
