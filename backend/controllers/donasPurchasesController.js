// backend/controllers/donasPurchasesController.js
const db = require("../db");
const { touchMonthsFromYms } = require("../utils/donasSalesMonthAggregator");

const SLUG = "donas-dosas";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function isYm(s) {
  return /^\d{4}-\d{2}$/.test(String(s || ""));
}

function toYmFromDate(d) {
  if (!d) return "";
  return String(d).slice(0, 7);
}

function hasLockedTag(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}

async function isMonthLocked(ym) {
  if (!isYm(ym)) return false;

  const { rows } = await db.query(
    `
    SELECT notes
    FROM donas_finance_months
    WHERE slug=$1 AND month = ($2 || '-01')::date
    ORDER BY id DESC
    LIMIT 1
    `,
    [SLUG, ym]
  );

  const notes = rows?.[0]?.notes || "";
  return hasLockedTag(notes);
}

/**
 * GET /api/admin/donas/purchases?month=YYYY-MM&type=OPEX|CAPEX
 */
exports.getPurchases = async (req, res) => {
  try {
    const { month, type } = req.query;

    const wh = [];
    const params = [];

    if (month) {
      if (!isYm(month)) return res.status(400).json({ error: "Bad month (YYYY-MM)" });
      params.push(month);
      wh.push(`to_char(date,'YYYY-MM') = $${params.length}`);
    }

    if (type) {
      params.push(String(type).toUpperCase());
      wh.push(`upper(type) = $${params.length}`);
    }

    const where = wh.length ? `WHERE ${wh.join(" AND ")}` : "";

    const { rows } = await db.query(
      `
      SELECT *
      FROM donas_purchases
      ${where}
      ORDER BY date DESC, id DESC
      `,
      params
    );

    return res.json(rows || []);
  } catch (e) {
    console.error("getPurchases error:", e);
    return res.status(500).json({ error: "Failed to load purchases" });
  }
};

/**
 * POST /api/admin/donas/purchases
 * body: { date, ingredient, qty, price, type, notes? }
 */
exports.addPurchase = async (req, res) => {
  try {
    const b = req.body || {};
    const date = String(b.date || "").trim();
    const ingredient = b.ingredient == null ? null : String(b.ingredient);
    const qty = toNum(b.qty);
    const price = toNum(b.price);
    const type = String(b.type || "").toUpperCase();
    const notes = b.notes == null ? null : String(b.notes);

    if (!date) return res.status(400).json({ error: "date required" });
    if (!type || (type !== "OPEX" && type !== "CAPEX")) {
      return res.status(400).json({ error: "type must be OPEX or CAPEX" });
    }

    const ym = toYmFromDate(date);
    if (await isMonthLocked(ym)) {
      return res.status(409).json({ error: `Month ${ym} is locked (#locked)` });
    }

    const total = qty * price;

    const { rows } = await db.query(
      `
      INSERT INTO donas_purchases (date, ingredient, qty, price, total, type, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
      `,
      [date, ingredient, qty, price, total, type, notes]
    );

    // ✅ FULL auto-touch: purchases affect opex/capex + cash_end chain
    await touchMonthsFromYms([ym]);

    return res.json(rows[0]);
  } catch (e) {
    console.error("addPurchase error:", e);
    return res.status(500).json({ error: "Failed to add purchase" });
  }
};

/**
 * PUT /api/admin/donas/purchases/:id
 * body: { date?, ingredient?, qty?, price?, type?, notes? }
 */
exports.updatePurchase = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Bad id" });

    const curQ = await db.query(`SELECT * FROM donas_purchases WHERE id=$1 LIMIT 1`, [id]);
    const cur = curQ.rows?.[0];
    if (!cur) return res.status(404).json({ error: "Purchase not found" });

    const curYm = toYmFromDate(cur.date);
    if (await isMonthLocked(curYm)) {
      return res.status(409).json({ error: `Month ${curYm} is locked (#locked)` });
    }

    const b = req.body || {};
    const date = String(b.date || cur.date);
    const ingredient = b.ingredient === undefined ? cur.ingredient : b.ingredient;
    const qty = b.qty == null ? toNum(cur.qty) : toNum(b.qty);
    const price = b.price == null ? toNum(cur.price) : toNum(b.price);
    const type = b.type == null ? String(cur.type || "").toUpperCase() : String(b.type).toUpperCase();
    const notes = b.notes === undefined ? cur.notes : (b.notes == null ? null : String(b.notes));

    if (!date) return res.status(400).json({ error: "date required" });
    if (!type || (type !== "OPEX" && type !== "CAPEX")) {
      return res.status(400).json({ error: "type must be OPEX or CAPEX" });
    }

    const newYm = toYmFromDate(date);
    if (newYm !== curYm && (await isMonthLocked(newYm))) {
      return res.status(409).json({ error: `Month ${newYm} is locked (#locked)` });
    }

    const total = qty * price;

    const { rows } = await db.query(
      `
      UPDATE donas_purchases
      SET
        date=$2,
        ingredient=$3,
        qty=$4,
        price=$5,
        total=$6,
        type=$7,
        notes=$8
      WHERE id=$1
      RETURNING *
      `,
      [id, date, ingredient, qty, price, total, type, notes]
    );

    // ✅ FULL auto-touch: touch both months if moved
    await touchMonthsFromYms([curYm, newYm]);

    return res.json(rows[0]);
  } catch (e) {
    console.error("updatePurchase error:", e);
    return res.status(500).json({ error: "Failed to update purchase" });
  }
};

/**
 * DELETE /api/admin/donas/purchases/:id
 */
exports.deletePurchase = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: "Bad id" });

    const curQ = await db.query(`SELECT date FROM donas_purchases WHERE id=$1 LIMIT 1`, [id]);
    const cur = curQ.rows?.[0];
    if (!cur) return res.status(404).json({ error: "Purchase not found" });

    const ym = toYmFromDate(cur.date);
    if (await isMonthLocked(ym)) {
      return res.status(409).json({ error: `Month ${ym} is locked (#locked)` });
    }

    await db.query(`DELETE FROM donas_purchases WHERE id=$1`, [id]);

    // ✅ FULL auto-touch
    await touchMonthsFromYms([ym]);

    return res.json({ ok: true });
  } catch (e) {
    console.error("deletePurchase error:", e);
    return res.status(500).json({ error: "Failed to delete purchase" });
  }
};
