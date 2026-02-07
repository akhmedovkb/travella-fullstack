// backend/controllers/donasPurchasesController.js

const db = require("../db");

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function normType(t) {
  const v = String(t || "").trim().toLowerCase();
  // В БД constraint: type IN ('opex','capex','cogs')
  if (v === "opex" || v === "capex" || v === "cogs") return v;
  return null;
}

function cleanText(x) {
  const s = String(x ?? "").trim();
  return s ? s : null;
}

function monthStart(ym) {
  // ym: "YYYY-MM" or "YYYY-MM-DD"
  if (!ym) return null;
  const s = String(ym).trim();
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

/**
 * GET /api/admin/donas/purchases
 * поддерживает:
 *   ?month=YYYY-MM&type=opex|capex|cogs
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD&type=...
 */
exports.listPurchases = async (req, res) => {
  try {
    const typeRaw = cleanText(req.query.type);
    const type = typeRaw ? normType(typeRaw) : null;
    if (typeRaw && !type) {
      return res.status(400).json({ error: "Invalid type. Use: opex | capex | cogs" });
    }

    // 1) month имеет приоритет
    const m = monthStart(cleanText(req.query.month));
    const from = m || cleanText(req.query.from);
    const to = m ? null : cleanText(req.query.to); // если month задан — to не нужен

    const where = [];
    const params = [];
    let i = 1;

    if (from) {
      where.push(`date >= $${i++}::date`);
      params.push(from);
    }

    if (m) {
      // диапазон месяца: [start, start + 1 month)
      where.push(`date < ($${i++}::date + INTERVAL '1 month')`);
      params.push(m);
    } else if (to) {
      // from/to: включительно (date <= to)
      where.push(`date <= $${i++}::date`);
      params.push(to);
    }

    if (type) {
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
        created_at,
        updated_at
      FROM donas_purchases
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY date DESC, id DESC
    `;

    const { rows } = await db.query(sql, params);

    // небольшая помощь фронту: total_sum
    const total_sum = rows.reduce((acc, r) => acc + toNum(r.total), 0);

    res.json({ rows, total_sum });
  } catch (e) {
    console.error("listPurchases error:", e);
    res.status(500).json({ error: "Failed to list purchases" });
  }
};

/**
 * POST /api/admin/donas/purchases
 * body: { date, ingredient, qty, price, type, notes }
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
        id, date, ingredient, qty, price, total, type, notes, created_at, updated_at
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
        id, date, ingredient, qty, price, total, type, notes, created_at, updated_at
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

// ✅ Алиасы под старые импорты/роуты, чтобы ничего не падало:
exports.getPurchases = exports.listPurchases;
