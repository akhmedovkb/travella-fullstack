// backend/routes/entryFeesRoutes.js
const express = require("express");
const router = express.Router();
const pool = require("../db");

// GET /api/entry-fees?q=&city=&date=&limit=
router.get("/", async (req, res) => {
  try {
    const {
      q = "",
      city = "",
      date = "",   // фронт сам определяет wk/we/hd; здесь дата не обязательна
      limit = 50,
    } = req.query;

    const qLike = `%${String(q).trim()}%`;
    const cityLike = `%${String(city).trim()}%`;
    const lim = Math.max(1, Math.min(200, Number(limit) || 50));

    const sql = `
      SELECT
        id,
        COALESCE(name_ru, '') AS name_ru,
        COALESCE(name_en, '') AS name_en,
        COALESCE(name_uz, '') AS name_uz,
        COALESCE(city, '')    AS city,
        COALESCE(currency, 'UZS') AS currency,

        -- weekday
        COALESCE(wk_res_adult,   0)::numeric AS wk_res_adult,
        COALESCE(wk_res_child,   0)::numeric AS wk_res_child,
        COALESCE(wk_res_senior,  0)::numeric AS wk_res_senior,
        COALESCE(wk_nrs_adult,   0)::numeric AS wk_nrs_adult,
        COALESCE(wk_nrs_child,   0)::numeric AS wk_nrs_child,
        COALESCE(wk_nrs_senior,  0)::numeric AS wk_nrs_senior,

        -- weekend
        COALESCE(we_res_adult,   0)::numeric AS we_res_adult,
        COALESCE(we_res_child,   0)::numeric AS we_res_child,
        COALESCE(we_res_senior,  0)::numeric AS we_res_senior,
        COALESCE(we_nrs_adult,   0)::numeric AS we_nrs_adult,
        COALESCE(we_nrs_child,   0)::numeric AS we_nrs_child,
        COALESCE(we_nrs_senior,  0)::numeric AS we_nrs_senior,

        -- holiday
        COALESCE(hd_res_adult,   0)::numeric AS hd_res_adult,
        COALESCE(hd_res_child,   0)::numeric AS hd_res_child,
        COALESCE(hd_res_senior,  0)::numeric AS hd_res_senior,
        COALESCE(hd_nrs_adult,   0)::numeric AS hd_nrs_adult,
        COALESCE(hd_nrs_child,   0)::numeric AS hd_nrs_child,
        COALESCE(hd_nrs_senior,  0)::numeric AS hd_nrs_senior
      FROM entry_sites es
      WHERE
        ($1 = '' OR es.city ILIKE $2) AND
        ($3 = '' OR es.name_ru ILIKE $4 OR es.name_en ILIKE $4 OR es.name_uz ILIKE $4)
      ORDER BY
        NULLIF(name_en,'') NULLS LAST,
        NULLIF(name_ru,'') NULLS LAST,
        NULLIF(name_uz,'') NULLS LAST,
        id
      LIMIT $5
    `;

    const params = [
      String(city).trim(), cityLike,
      String(q).trim(),    qLike,
      lim,
    ];

    const { rows } = await pool.query(sql, params);
    return res.json({ items: rows });
  } catch (e) {
    console.error("GET /api/entry-fees error:", e);
    return res.status(500).json({ error: "failed" });
  }
});

module.exports = router;
