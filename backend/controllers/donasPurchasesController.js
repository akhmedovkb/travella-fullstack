// backend/controllers/donasPurchasesController.js
const db = require("../db");
const { touchMonthsFromYms } = require("../utils/donasSalesMonthAggregator");

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

function isYm(s) {
  return /^\d{4}-\d{2}$/.test(String(s || ""));
}

function ymFromDate(dateStr) {
  const s = String(dateStr || "").trim();
  if (!s) return "";
  // ожидаем YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 7);
  // если вдруг пришёл ISO
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 7);
  // fallback
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  return "";
}

function hasLockedTag(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}

async function isMonthLocked(ym) {
  if (!isYm(ym)) return false;
  try {
    // таблица может ещё не существовать на “чистом” окружении
    await db.query(`
      CREATE TABLE IF NOT EXISTS donas_finance_months (
        id BIGSERIAL PRIMARY KEY,
        slug TEXT NOT NULL,
        month DATE NOT NULL,
        revenue NUMERIC NOT NULL DEFAULT 0,
        cogs NUMERIC NOT NULL DEFAULT 0,
        opex NUMERIC NOT NULL DEFAULT 0,
        capex NUMERIC NOT NULL DEFAULT 0,
        loan_paid NUMERIC NOT NULL DEFAULT 0,
        cash_end NUMERIC NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const { rows } = await db.query(
      `
      SELECT notes
      FROM donas_finance_months
      WHERE slug=$1 AND month = ($2 || '-01')::date
      ORDER BY id DESC
      LIMIT 1
      `,
      ["donas-dosas", ym]
    );
    return hasLockedTag(rows?.[0]?.notes || "");
  } catch {
    return false;
  }
}

function nextYm(ym) {
  const [y, m] = String(ym).split("-").map((v) => Number(v));
  const d = new Date(Date.UTC(y, (m - 1) + 1, 1));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

/**
 * GET /api/admin/donas/purchases?month=YYYY-MM&from=YYYY-MM-DD&to=YYYY-MM-DD&type=opex|capex|cogs
 *
 * Приоритет:
 * - если передан month=YYYY-MM → фильтруем по этому месяцу (date >= month-01 AND date < nextMonth-01)
 * - иначе используем from/to
 */
exports.listPurchases = async (req, res) => {
  try {
    const month = cleanText(req.query.month);
    const from = cleanText(req.query.from);
    const to = cleanText(req.query.to);
    const type = req.query.type ? normType(req.query.type) : null;

    const where = [];
    const params = [];
    let i = 1;

    if (month) {
      if (!isYm(month)) {
        return res.status(400).json({ error: "Invalid month. Use YYYY-MM" });
      }
      const start = `${month}-01`;
      const end = `${nextYm(month)}-01`;
      where.push(`date >= $${i++} AND date < $${i++}`);
      params.push(start, end);
    } else {
      if (from) {
        where.push(`date >= $${i++}`);
        params.push(from);
      }
      if (to) {
        where.push(`date <= $${i++}`);
        params.push(to);
      }
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

    const ym = ymFromDate(date);
    if (!isYm(ym)) return res.status(400).json({ error: "date invalid (expected YYYY-MM-DD)" });

    if (await isMonthLocked(ym)) {
      return res.status(409).json({ error: `Month ${ym} is locked (#locked)` });
    }

    const { rows } = await db.query(
      `
      INSERT INTO donas_purchases (date, ingredient, qty, price, type, notes)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id, date, ingredient, qty, price, total, type, notes, created_at
      `,
      [date, ingredient, qty, price, type, notes]
    );

    // ✅ auto-update Months (revenue/cogs/opex/capex + cash_end chain)
    await touchMonthsFromYms([ym]);

    res.json(rows[0]);
  } catch (e) {
    console.error("addPurchase error:", e);
    res.status(500).json({ error: "Failed to add purchase" });
  }
};

exports.updatePurchase = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    // read old (to detect month change)
    const oldQ = await db.query(`SELECT id, date FROM donas_purchases WHERE id=$1 LIMIT 1`, [id]);
    if (!oldQ.rows?.length) return res.status(404).json({ error: "Not found" });

    const oldDate = oldQ.rows[0].date;
    const oldYm = ymFromDate(oldDate);

    const date = cleanText(req.body.date);
    const ingredient = cleanText(req.body.ingredient);
    const qty = toNum(req.body.qty);
    const price = toNum(req.body.price);
    const type = normType(req.body.type);
    const notes = cleanText(req.body.notes);

    if (!date) return res.status(400).json({ error: "date is required" });
    if (!ingredient) return res.status(400).json({ error: "ingredient is required" });
    if (!type) return res.status(400).json({ error: "type must be: opex | capex | cogs" });

    const ym = ymFromDate(date);
    if (!isYm(ym)) return res.status(400).json({ error: "date invalid (expected YYYY-MM-DD)" });

    // lock guard: both old and new months should be protected
    if (isYm(oldYm) && (await isMonthLocked(oldYm))) {
      return res.status(409).json({ error: `Month ${oldYm} is locked (#locked)` });
    }
    if (await isMonthLocked(ym)) {
      return res.status(409).json({ error: `Month ${ym} is locked (#locked)` });
    }

    const { rows } = await db.query(
      `
      UPDATE donas_purchases
      SET date=$2, ingredient=$3, qty=$4, price=$5, type=$6, notes=$7
      WHERE id=$1
      RETURNING id, date, ingredient, qty, price, total, type, notes, created_at
      `,
      [id, date, ingredient, qty, price, type, notes]
    );

    if (!rows.length) return res.status(404).json({ error: "Not found" });

    // ✅ touch both months if it moved
    const touch = new Set();
    if (isYm(oldYm)) touch.add(oldYm);
    if (isYm(ym)) touch.add(ym);
    await touchMonthsFromYms([...touch]);

    res.json(rows[0]);
  } catch (e) {
    console.error("updatePurchase error:", e);
    res.status(500).json({ error: "Failed to update purchase" });
  }
};

exports.deletePurchase = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    // read old date before delete
    const oldQ = await db.query(`SELECT id, date FROM donas_purchases WHERE id=$1 LIMIT 1`, [id]);
    if (!oldQ.rows?.length) return res.status(404).json({ error: "Not found" });

    const ym = ymFromDate(oldQ.rows[0].date);

    if (isYm(ym) && (await isMonthLocked(ym))) {
      return res.status(409).json({ error: `Month ${ym} is locked (#locked)` });
    }

    const { rowCount } = await db.query(`DELETE FROM donas_purchases WHERE id=$1`, [id]);

    if (isYm(ym)) {
      // ✅ auto-update Months after deletion
      await touchMonthsFromYms([ym]);
    }

    res.json({ ok: true, deleted: rowCount });
  } catch (e) {
    console.error("deletePurchase error:", e);
    res.status(500).json({ error: "Failed to delete purchase" });
  }
};
