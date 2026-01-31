//backend/controllers/donasPurchasesController.js

const db = require("../db");

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

exports.addPurchase = async (req, res) => {
  const { date, ingredient, qty, price, type } = req.body;

  // Keep "total" consistent (CAPEX/OPEX summaries rely on it).
  const q = toNum(qty);
  const p = toNum(price);
  const total = q * p;

  const { rows } = await db.query(
    `INSERT INTO donas_purchases (date, ingredient, qty, price, total, type)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [date, ingredient, q, p, total, type]
  );

  res.json(rows[0]);
};

exports.deletePurchase = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Bad id" });
    }

    const { rows } = await db.query(
      `DELETE FROM donas_purchases WHERE id = $1 RETURNING *`,
      [id]
    );

    if (!rows.length) return res.status(404).json({ error: "Not found" });
    return res.json({ ok: true, deleted: rows[0] });
  } catch (e) {
    console.error("deletePurchase error:", e);
    return res.status(500).json({ error: "Failed to delete purchase" });
  }
};

exports.listPurchases = async (req, res) => {
  const { month } = req.query;

  const { rows } = await db.query(
    `SELECT * FROM donas_purchases
     WHERE to_char(date,'YYYY-MM') = $1
     ORDER BY date DESC`,
    [month]
  );

  res.json(rows);
};
