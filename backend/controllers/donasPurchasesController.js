// backend/controllers/donasPurchasesController.js

const db = require("../db");

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

exports.addPurchase = async (req, res) => {
  const { date, ingredient, qty, price, type, category, notes } = req.body;

  const q = toNum(qty);
  const p = toNum(price);
  const total = q * p;

  const { rows } = await db.query(
    `INSERT INTO donas_purchases (date, ingredient, qty, price, total, type, category, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      date,
      ingredient,
      q,
      p,
      total,
      type,
      category || null,
      notes || null,
    ]
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
  try {
    const { month, type } = req.query;

    if (!month || !/^\d{4}-\d{2}$/.test(String(month))) {
      return res.status(400).json({ error: "Bad month (expected YYYY-MM)" });
    }

    const hasType = typeof type === "string" && type.trim().length > 0;

    const { rows } = await db.query(
      `
      SELECT *
      FROM donas_purchases
      WHERE to_char(date,'YYYY-MM') = $1
        AND ($2::text IS NULL OR type = $2)
      ORDER BY date DESC, id DESC
      `,
      [month, hasType ? type.trim() : null]
    );

    res.json(rows);
  } catch (e) {
    console.error("listPurchases error:", e);
    res.status(500).json({ error: "Failed to load purchases" });
  }
};
