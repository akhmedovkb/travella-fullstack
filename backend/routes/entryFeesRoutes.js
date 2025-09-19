// backend/routes/entryFeesRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

// GET /api/entry-fees?q=&city=&limit=
router.get("/", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const city = String(req.query.city || "").trim();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);

    const vals = [];
    const where = [];

    if (q) {
      vals.push(`%${q}%`);
      const i = vals.length;
      where.push(`(
        COALESCE(ef.name_ru, ef.name_en, ef.name_uz) ILIKE $${i}
        OR ef.city ILIKE $${i}
      )`);
    }
    if (city) {
      vals.push(`%${city}%`);
      where.push(`ef.city ILIKE $${vals.length}`);
    }

    const sql = `
      SELECT ef.id,
             ef.city,
             ef.currency,
             ef.name_ru, ef.name_en, ef.name_uz,
             ef.weekday_prices, ef.weekend_prices, ef.holiday_prices,
             ef.nrs_adult, ef.nrs_child, ef.res_adult, ef.res_child
      FROM entry_fees ef
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY ef.city NULLS LAST, COALESCE(ef.name_ru, ef.name_en, ef.name_uz)
      LIMIT $${vals.push(limit)};
    `;
    const { rows } = await pool.query(sql, vals);

    // фронту удобнее единый объект с ключами вида wk_nrs_adult и т.п.
    const items = rows.map((r) => {
      const out = {
        id: r.id,
        city: r.city,
        currency: r.currency || "UZS",
        name_ru: r.name_ru,
        name_en: r.name_en,
        name_uz: r.name_uz,
      };
      // подстрахуемся: если есть агрегированные поля — добавим
      if (r.nrs_adult != null) out["wk_nrs_adult"] = Number(r.nrs_adult) || 0;
      if (r.nrs_child != null) out["wk_nrs_child"] = Number(r.nrs_child) || 0;
      if (r.res_adult != null) out["wk_res_adult"] = Number(r.res_adult) || 0;
      if (r.res_child != null) out["wk_res_child"] = Number(r.res_child) || 0;

      return out;
    });

    res.json({ items });
  } catch (e) {
    console.error("GET /api/entry-fees error:", e);
    res.status(500).json({ error: "failed" });
  }
});

module.exports = router;
