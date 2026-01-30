//backend/controllers/donasOpexController.js

const db = require("../db");

// GET /api/admin/donas/opex?month=2026-02
exports.list = async (req, res) => {
  const { month } = req.query;
  let where = "";
  const params = [];
  if (month) {
    params.push(`${month}-01`);
    where = `WHERE month = $${params.length}`;
  }
  const r = await db.query(
    `SELECT * FROM donas_opex ${where} ORDER BY month DESC, id DESC`,
    params
  );
  res.json({ items: r.rows || [] });
};

// POST /api/admin/donas/opex
exports.create = async (req, res) => {
  const { title, category, amount, month, notes } = req.body;
  if (!title || !category || amount == null || !month) {
    return res.status(400).json({ error: "Missing fields" });
  }
  const r = await db.query(
    `INSERT INTO donas_opex (title, category, amount, month, notes)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [title, category, Number(amount), `${month}-01`, notes || null]
  );
  res.json({ ok: true, item: r.rows[0] });
};

// PUT /api/admin/donas/opex/:id
exports.update = async (req, res) => {
  const id = Number(req.params.id);
  const { title, category, amount, month, notes } = req.body;
  const r = await db.query(
    `UPDATE donas_opex
     SET title=$1, category=$2, amount=$3, month=$4, notes=$5
     WHERE id=$6 RETURNING *`,
    [title, category, Number(amount), `${month}-01`, notes || null, id]
  );
  res.json({ ok: true, item: r.rows[0] });
};

// DELETE /api/admin/donas/opex/:id
exports.remove = async (req, res) => {
  const id = Number(req.params.id);
  await db.query(`DELETE FROM donas_opex WHERE id=$1`, [id]);
  res.json({ ok: true });
};

// GET /api/admin/donas/opex/summary?month=2026-02
exports.summary = async (req, res) => {
  const { month } = req.query;
  if (!month) return res.status(400).json({ error: "month required" });
  const r = await db.query(
    `SELECT COALESCE(SUM(amount),0) AS total
     FROM donas_opex WHERE month = $1`,
    [`${month}-01`]
  );
  res.json({ total: Number(r.rows[0]?.total || 0) });
};
