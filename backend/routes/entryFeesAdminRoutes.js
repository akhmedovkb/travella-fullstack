const express = require("express");
const pool = require("../db");
const authenticateToken = require("../middleware/authenticateToken");
const router = express.Router();

// возьмём ту же логику, что у вас в adminRoutes
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ message: "Unauthorized" });
  const role = String(req.user.role || "").toLowerCase();
  const isAdmin =
    req.user.is_admin === true ||
    role === "admin" ||
    req.user.is_moderator === true ||
    req.user.moderator === true ||
    role === "moderator";
  return isAdmin ? next() : res.status(403).json({ message: "Admin only" });
}

router.use(authenticateToken, requireAdmin);

/** LIST + поиск + пагинация */
router.get("/", async (req, res) => {
  const { q = "", page = 1, limit = 20 } = req.query;
  const off = (Number(page) - 1) * Number(limit);
  const where = [];
  const params = [];

  if (q) {
    params.push(`%${q}%`);
    where.push(`(name_ru ILIKE $${params.length} OR name_uz ILIKE $${params.length} OR name_en ILIKE $${params.length} OR city ILIKE $${params.length})`);
  }

  const total = await pool.query(
    `SELECT count(*) FROM entry_sites ${where.length ? "WHERE " + where.join(" AND ") : ""}`,
    params
  );
  const list = await pool.query(
    `SELECT * FROM entry_sites ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY id DESC LIMIT ${Number(limit)} OFFSET ${off}`,
    params
  );
  res.json({ items: list.rows, total: Number(total.rows[0].count) });
});

/** CREATE */
router.post("/", async (req, res) => {
  const b = req.body || {};
  const sql = `
    INSERT INTO entry_sites
      (name_ru,name_uz,name_en,city,currency,
       wk_res_adult,wk_res_child,wk_res_senior,wk_nrs_adult,wk_nrs_child,wk_nrs_senior,
       we_res_adult,we_res_child,we_res_senior,we_nrs_adult,we_nrs_child,we_nrs_senior,
       hd_res_adult,hd_res_child,hd_res_senior,hd_nrs_adult,hd_nrs_child,hd_nrs_senior)
    VALUES
      ($1,$2,$3,$4,$5,
       $6,$7,$8,$9,$10,$11,
       $12,$13,$14,$15,$16,$17,
       $18,$19,$20,$21,$22,$23)
    RETURNING *`;
  const v = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
  const vals = [
    b.name_ru, b.name_uz, b.name_en, b.city, b.currency || "UZS",
    v(b.wk_res_adult), v(b.wk_res_child), v(b.wk_res_senior),
    v(b.wk_nrs_adult), v(b.wk_nrs_child), v(b.wk_nrs_senior),
    v(b.we_res_adult), v(b.we_res_child), v(b.we_res_senior),
    v(b.we_nrs_adult), v(b.we_nrs_child), v(b.we_nrs_senior),
    v(b.hd_res_adult), v(b.hd_res_child), v(b.hd_res_senior),
    v(b.hd_nrs_adult), v(b.hd_nrs_child), v(b.hd_nrs_senior),
  ];
  const { rows } = await pool.query(sql, vals);
  res.json({ item: rows[0] });
});

/** UPDATE */
router.put("/:id(\\d+)", async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const v = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
  const sql = `
    UPDATE entry_sites SET
      name_ru=$1,name_uz=$2,name_en=$3,city=$4,currency=$5,
      wk_res_adult=$6,wk_res_child=$7,wk_res_senior=$8,wk_nrs_adult=$9,wk_nrs_child=$10,wk_nrs_senior=$11,
      we_res_adult=$12,we_res_child=$13,we_res_senior=$14,we_nrs_adult=$15,we_nrs_child=$16,we_nrs_senior=$17,
      hd_res_adult=$18,hd_res_child=$19,hd_res_senior=$20,hd_nrs_adult=$21,hd_nrs_child=$22,hd_nrs_senior=$23
    WHERE id=$24 RETURNING *`;
  const vals = [
    b.name_ru, b.name_uz, b.name_en, b.city, b.currency || "UZS",
    v(b.wk_res_adult), v(b.wk_res_child), v(b.wk_res_senior),
    v(b.wk_nrs_adult), v(b.wk_nrs_child), v(b.wk_nrs_senior),
    v(b.we_res_adult), v(b.we_res_child), v(b.we_res_senior),
    v(b.we_nrs_adult), v(b.we_nrs_child), v(b.we_nrs_senior),
    v(b.hd_res_adult), v(b.hd_res_child), v(b.hd_res_senior),
    v(b.hd_nrs_adult), v(b.hd_nrs_child), v(b.hd_nrs_senior),
    id
  ];
  const { rows } = await pool.query(sql, vals);
  res.json({ item: rows[0] });
});

/** DELETE */
router.delete("/:id(\\d+)", async (req, res) => {
  await pool.query(`DELETE FROM entry_sites WHERE id=$1`, [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
