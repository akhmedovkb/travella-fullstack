//backend/routes/entryFeesRoutes.js

const express = require("express");
const pool = require("../db");
const router = express.Router();

/** GET /api/entry-fees
 *  query:
 *    q      — поиск по названию/городу
 *    city   — фильтр по городу (опц.)
 *    limit  — опц., по умолчанию 50
 */
router.get("/", async (req, res) => {
  const { q = "", city = "", limit = 50 } = req.query;
  const where = [];
  const params = [];

  if (q) {
    params.push(`%${q}%`);
    where.push(`(name_ru ILIKE $${params.length} OR name_uz ILIKE $${params.length} OR name_en ILIKE $${params.length} OR city ILIKE $${params.length})`);
  }
  if (city) {
    params.push(city);
    where.push(`city = $${params.length}`);
  }
  const sql = `
    SELECT id, name_ru, name_uz, name_en, city, currency
    FROM entry_sites
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY name_ru ASC
    LIMIT ${Number(limit) || 50}
  `;
  const { rows } = await pool.query(sql, params);
  res.json({ items: rows });
});

/** GET /api/entry-fees/:id  — детально */
router.get("/:id(\\d+)", async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM entry_sites WHERE id=$1`, [req.params.id]);
  if (!rows.length) return res.status(404).json({ message: "Not found" });
  res.json(rows[0]);
});

module.exports = router;
