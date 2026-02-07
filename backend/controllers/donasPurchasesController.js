// backend/controllers/donasPurchasesController.js

const db = require("../db");

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function normType(t) {
  const v = String(t || "").trim().toLowerCase();
  // constraint в БД: type IN ('opex','capex','cogs')
  if (v === "opex" || v === "capex" || v === "cogs") return v;
  return null;
}

function cleanText(x) {
  const s = String(x ?? "").trim();
  return s ? s : null;
}

/**
 * GET /api/admin/donas/purchases?from=YYYY-MM-DD&to=YYYY-MM-DD&type=opex|capex|cogs
 */
exports.listPurchases = async (req, res) => {
  try {
    const from = cleanText(req.query.from);
    const to = cleanText(req.query.to);
    const type = req.query.type ? normType(req.query.type) : null;

    const where = [];
    const params = [];
    let i = 1;

    if (from) {
      where.push(`date >= $${i++}`);
      params.push(from);
    }
    if (to) {
      where.push(`date <= $${i++}`);
      params.push(to);
    }
    if (req.query.type) {
      if (!type) {
        return res.status(400).json({ error: "Invalid type. Use: opex | capex | cogs" });
      }
      where.push(`type = $${i++}`);
      params.push(type);
    }

    const sql = `
      SELECT
        id,
        date,
        ingredient,
        qty,
        price,
        total,   -- generated column
        type,
        notes,
        created_at
      FROM donas_purchases
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY date DESC, id DESC
    `;

    const { rows } = await db.query(sql, params);
    res.json({ rows });
  } catch (e) {
    console.error("listPurchases error:", e);
    res.status(500).json({ error: "Failed to list purchases" });
  }
};

/**
 * POST /api/admin/donas/purchases
 * body: { date, ingredient, qty, price, type, notes }
 *
 * total НЕ передаем — он generated column.
 * type должен быть 'opex'|'capex'|'cogs' (lowercase).
 */
exports.addPurchase = async (req, res) => {
  try {
    const date = cleanText(req.body.date);
    const ingredient = cleanText(req.body.ingredient);
    const qty = toNum(req.body.qty);
    const price = toNum(req.body.price);
    const type = normType(req.body.type);
    const notes = cleanText(req.body.notes);

    if (!date) return res.status(400).json({ error: "date is required" });
    if (!ingredient) return res.status(400).json({ error: "ingredient is required" });
    if (!type) return res.status(400).json({ error: "type must be: opex | capex | cogs" });

    const { rows } = await db.query(
      `
      INSERT INTO donas_purchases (date, ingredient, qty, price, type, notes)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING
        id, date, ingredient, qty, price, total, type, notes, created_at
      `,
      [date, ingredient, qty, price, type, notes]
    );

    res.json(rows[0]);
  } catch (e) {
    console.error("addPurchase error:", e);
    res.status(500).json({ error: "Failed to add purchase" });
  }
};

/**
 * PUT /api/admin/donas/purchases/:id
 * body: { date, ingredient, qty, price, type, notes }
 *
 * total НЕ трогаем.
 */
exports.updatePurchase = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const date = cleanText(req.body.date);
    const ingredient = cleanText(req.body.ingredient);
    const qty = toNum(req.body.qty);
    const price = toNum(req.body.price);
    const type = normType(req.body.type);
    const notes = cleanText(req.body.notes);

    if (!date) return res.status(400).json({ error: "date is required" });
    if (!ingredient) return res.status(400).json({ error: "ingredient is required" });
    if (!type) return res.status(400).json({ error: "type must be: opex | capex | cogs" });

    const { rows } = await db.query(
      `
      UPDATE donas_purchases
      SET date=$2, ingredient=$3, qty=$4, price=$5, type=$6, notes=$7
      WHERE id=$1
      RETURNING
        id, date, ingredient, qty, price, total, type, notes, created_at
      `,
      [id, date, ingredient, qty, price, type, notes]
    );

    if (!rows.length) return res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (e) {
    console.error("updatePurchase error:", e);
    res.status(500).json({ error: "Failed to update purchase" });
  }
};

/**
 * DELETE /api/admin/donas/purchases/:id
 */
exports.deletePurchase = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const { rowCount } = await db.query(`DELETE FROM donas_purchases WHERE id=$1`, [id]);
    res.json({ ok: true, deleted: rowCount });
  } catch (e) {
    console.error("deletePurchase error:", e);
    res.status(500).json({ error: "Failed to delete purchase" });
  }
};
