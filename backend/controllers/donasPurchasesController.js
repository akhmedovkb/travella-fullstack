// backend/controllers/donasPurchasesController.js

const db = require("../db");
const { touchMonthsFromYms } = require("../utils/donasSalesMonthAggregator");
const { autoSyncMonthsForDate } = require("../utils/donasFinanceAutoSync");

const SLUG = "donas-dosas";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 7);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 7);
  if (/^\d{4}-\d{2}/.test(s)) return s.slice(0, 7);
  return "";
}

function hasLockedTag(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}

function normType(t) {
  const v = String(t || "").trim().toLowerCase();
  // allow only
  if (v === "opex" || v === "capex" || v === "cogs") return v;
  return null;
}

function nextYm(ym) {
  const [y, m] = String(ym).split("-").map((v) => Number(v));
  const d = new Date(Date.UTC(y, m - 1 + 1, 1));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

async function ensureMonthsTable() {
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
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_donas_finance_months_slug_month ON donas_finance_months (slug, month);
  `);
}

async function ensurePurchasesTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS donas_purchases (
      id BIGSERIAL PRIMARY KEY,
      date DATE NOT NULL,
      ingredient TEXT NOT NULL,
      qty NUMERIC NOT NULL DEFAULT 0,
      price NUMERIC NOT NULL DEFAULT 0,
      total NUMERIC GENERATED ALWAYS AS (qty * price) STORED,
      type TEXT NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await db.query(`CREATE INDEX IF NOT EXISTS idx_donas_purchases_date ON donas_purchases (date);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_donas_purchases_type ON donas_purchases (type);`);
}

async function getLatestMonthRow(ym) {
  await ensureMonthsTable();
  const q = await db.query(
    `
    SELECT *
    FROM donas_finance_months
    WHERE slug=$1 AND month=($2 || '-01')::date
    ORDER BY id DESC
    LIMIT 1
    `,
    [SLUG, ym]
  );
  return q.rows?.[0] || null;
}

async function isMonthLocked(ym) {
  if (!isYm(ym)) return false;
  const row = await getLatestMonthRow(ym);
  if (!row) return false;
  return hasLockedTag(row.notes);
}

/**
 * =========================
 * Controllers
 * =========================
 */

exports.listPurchases = async (req, res) => {
  try {
    await ensurePurchasesTable();

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
      where.push(`lower(type) = $${i++}`);
      params.push(type);
    }

    const sql = `
      SELECT
        id,
        date,
        ingredient,
        qty,
        price,
        total,
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

exports.addPurchase = async (req, res) => {
  try {
    await ensurePurchasesTable();

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

    // ✅ legacy recompute hook (keeps current behavior)
    await touchMonthsFromYms([ym]);

    // ✅ NEW: auto-sync chain (cash_end) immediately
    await autoSyncMonthsForDate(req, date, "purchases.add");

    res.json(rows[0]);
  } catch (e) {
    console.error("addPurchase error:", e);
    res.status(500).json({ error: "Failed to add purchase" });
  }
};

exports.updatePurchase = async (req, res) => {
  try {
    await ensurePurchasesTable();

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

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

    // lock guard: old and new months
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

    // touch both months if moved
    const touch = new Set();
    if (isYm(oldYm)) touch.add(oldYm);
    if (isYm(ym)) touch.add(ym);

    // ✅ legacy recompute hook (keeps current behavior)
    await touchMonthsFromYms([...touch]);

    // ✅ NEW: auto-sync chain for affected months (old + new dates)
    const dates = new Set([String(oldDate).slice(0, 10), date]);
    for (const d of dates) {
      await autoSyncMonthsForDate(req, d, "purchases.update");
    }

    res.json(rows[0]);
  } catch (e) {
    console.error("updatePurchase error:", e);
    res.status(500).json({ error: "Failed to update purchase" });
  }
};

exports.deletePurchase = async (req, res) => {
  try {
    await ensurePurchasesTable();

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

    const oldQ = await db.query(`SELECT id, date FROM donas_purchases WHERE id=$1 LIMIT 1`, [id]);
    if (!oldQ.rows?.length) return res.status(404).json({ error: "Not found" });

    const oldDate = oldQ.rows[0].date;
    const ym = ymFromDate(oldDate);

    if (isYm(ym) && (await isMonthLocked(ym))) {
      return res.status(409).json({ error: `Month ${ym} is locked (#locked)` });
    }

    const { rowCount } = await db.query(`DELETE FROM donas_purchases WHERE id=$1`, [id]);

    if (isYm(ym)) {
      // ✅ legacy recompute hook (keeps current behavior)
      await touchMonthsFromYms([ym]);

      // ✅ NEW: auto-sync chain immediately
      await autoSyncMonthsForDate(req, String(oldDate).slice(0, 10), "purchases.delete");
    }

    res.json({ ok: true, deleted: rowCount });
  } catch (e) {
    console.error("deletePurchase error:", e);
    res.status(500).json({ error: "Failed to delete purchase" });
  }
};
