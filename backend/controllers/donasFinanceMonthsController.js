// backend/controllers/donasFinanceMonthsController.js

const db = require("../db");

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function isYm(s) {
  return /^\d{4}-\d{2}$/.test(String(s || ""));
}

// Берём настройки (не завязано на id, потому что у тебя таблица могла быть старой версии)
async function loadSettings() {
  const { rows } = await db.query(
    `SELECT opening_cash, currency
     FROM donas_finance_settings
     ORDER BY updated_at DESC NULLS LAST
     LIMIT 1`
  );

  const s = rows?.[0] || {};
  return {
    openingCash: toNum(s.opening_cash),
    currency: String(s.currency || "UZS"),
  };
}

// Гарантируем, что строка месяца существует
async function ensureMonthRow(month) {
  await db.query(
    `
    INSERT INTO donas_finance_months (month, revenue, loan, notes, locked, snapshot)
    VALUES ($1, 0, 0, '', false, NULL)
    ON CONFLICT (month) DO NOTHING
    `,
    [month]
  );
}

// Расчёт месяца — единая точка правды под ТВОЮ текущую схему
async function calculateMonth(month) {
  const settings = await loadSettings();

  // Берём ручные поля месяца (revenue, loan, notes, locked)
  await ensureMonthRow(month);

  const { rows: monthRows } = await db.query(
    `SELECT month, revenue, loan, notes, locked
     FROM donas_finance_months
     WHERE month = $1
     LIMIT 1`,
    [month]
  );

  const m = monthRows?.[0] || {};
  const revenue = toNum(m.revenue);
  const loan = toNum(m.loan);
  const notes = String(m.notes || "");

  // Суммы из покупок
  const { rows: sums } = await db.query(
    `
    SELECT
      type,
      COALESCE(SUM(qty * price), 0) AS total
    FROM donas_purchases
    WHERE to_char(date,'YYYY-MM') = $1
      AND type IN ('opex','capex','cogs')
    GROUP BY type
    `,
    [month]
  );

  const map = {};
  (sums || []).forEach((r) => {
    map[r.type] = toNum(r.total);
  });

  const opex = map.opex || 0;
  const capex = map.capex || 0;
  const cogs = map.cogs || 0;

  const net = revenue - opex - cogs;
  const cashEnd = settings.openingCash + revenue + loan - opex - capex - cogs;

  return {
    month,
    openingCash: settings.openingCash,
    revenue,
    loan,
    opex,
    capex,
    cogs,
    net,
    cashEnd,
    currency: settings.currency,
    notes,
  };
}

// GET /api/admin/donas/finance/months/:month
exports.getMonth = async (req, res) => {
  try {
    const { month } = req.params;

    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    await ensureMonthRow(month);

    const { rows: [row] } = await db.query(
      `SELECT locked, snapshot FROM donas_finance_months WHERE month=$1`,
      [month]
    );

    if (row?.locked && row.snapshot) {
      return res.json({ locked: true, snapshot: row.snapshot });
    }

    const calc = await calculateMonth(month);
    return res.json({ locked: false, data: calc });
  } catch (e) {
    console.error("getMonth error:", e);
    return res.status(500).json({ error: "Failed to load month" });
  }
};

// PUT /api/admin/donas/finance/months/:month
// сохраняем РУЧНЫЕ поля: revenue, loan, notes (только если не locked)
exports.updateMonth = async (req, res) => {
  try {
    const { month } = req.params;

    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    await ensureMonthRow(month);

    const { rows: [cur] } = await db.query(
      `SELECT locked FROM donas_finance_months WHERE month=$1`,
      [month]
    );

    if (cur?.locked) {
      return res.status(409).json({ error: "Month is locked. Unlock first." });
    }

    const b = req.body || {};
    const revenue = toNum(b.revenue);
    const loan = toNum(b.loan);
    const notes = String(b.notes || "");

    const { rows: [saved] } = await db.query(
      `
      UPDATE donas_finance_months
      SET revenue=$2, loan=$3, notes=$4
      WHERE month=$1
      RETURNING month, revenue, loan, notes, locked
      `,
      [month, revenue, loan, notes]
    );

    // отдаём сразу перерасчёт
    const calc = await calculateMonth(month);
    return res.json({ ok: true, month: saved, data: calc });
  } catch (e) {
    console.error("updateMonth error:", e);
    return res.status(500).json({ error: "Failed to update month" });
  }
};

// POST /api/admin/donas/finance/months/:month/lock
exports.lockMonth = async (req, res) => {
  try {
    const { month } = req.params;

    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    await ensureMonthRow(month);

    const calc = await calculateMonth(month);

    await db.query(
      `
      UPDATE donas_finance_months
      SET locked=true, snapshot=$2
      WHERE month=$1
      `,
      [month, calc]
    );

    return res.json({ ok: true, locked: true, snapshot: calc });
  } catch (e) {
    console.error("lockMonth error:", e);
    return res.status(500).json({ error: "Failed to lock month" });
  }
};

// POST /api/admin/donas/finance/months/:month/unlock
exports.unlockMonth = async (req, res) => {
  try {
    const { month } = req.params;

    if (!isYm(month)) {
      return res.status(400).json({ error: "Bad month format (expected YYYY-MM)" });
    }

    await ensureMonthRow(month);

    await db.query(
      `
      UPDATE donas_finance_months
      SET locked=false, snapshot=NULL
      WHERE month=$1
      `,
      [month]
    );

    return res.json({ ok: true, locked: false });
  } catch (e) {
    console.error("unlockMonth error:", e);
    return res.status(500).json({ error: "Failed to unlock month" });
  }
};
