//backend/controllers/donasFinanceMonthsController.js

const db = require("../db");

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

// расчёт месяца (единая точка правды)
async function calculateMonth(month) {
  const { rows: [settings] } = await db.query(
    `SELECT opening_cash, currency FROM donas_finance_settings WHERE id = 1`
  );

  const openingCash = toNum(settings?.opening_cash);

  const { rows } = await db.query(
    `
    SELECT
      type,
      COALESCE(SUM(qty * price), 0) AS total
    FROM donas_purchases
    WHERE to_char(date,'YYYY-MM') = $1
    GROUP BY type
    `,
    [month]
  );

  const map = {};
  rows.forEach(r => map[r.type] = toNum(r.total));

  const revenue = map.revenue || 0;
  const loan    = map.loan || 0;
  const opex    = map.opex || 0;
  const capex   = map.capex || 0;
  const cogs    = map.cogs || 0;

  const net = revenue - opex - cogs;
  const cashEnd = openingCash + revenue + loan - opex - capex - cogs;

  return {
    month,
    openingCash,
    revenue,
    loan,
    opex,
    capex,
    cogs,
    net,
    cashEnd,
    currency: settings.currency
  };
}

// GET /api/admin/donas/finance/months/:month
exports.getMonth = async (req, res) => {
  const { month } = req.params;

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return res.status(400).json({ error: "Bad month format" });
  }

  const { rows: [row] } = await db.query(
    `SELECT * FROM donas_finance_months WHERE month = $1`,
    [month]
  );

  if (row?.locked && row.snapshot) {
    return res.json({ locked: true, snapshot: row.snapshot });
  }

  const calc = await calculateMonth(month);

  await db.query(
    `
    INSERT INTO donas_finance_months (month)
    VALUES ($1)
    ON CONFLICT (month) DO NOTHING
    `,
    [month]
  );

  res.json({ locked: false, data: calc });
};

// POST /api/admin/donas/finance/months/:month/lock
exports.lockMonth = async (req, res) => {
  const { month } = req.params;

  const calc = await calculateMonth(month);

  await db.query(
    `
    UPDATE donas_finance_months
    SET locked = true,
        snapshot = $2
    WHERE month = $1
    `,
    [month, calc]
  );

  res.json({ ok: true, locked: true, snapshot: calc });
};

// POST /api/admin/donas/finance/months/:month/unlock
exports.unlockMonth = async (req, res) => {
  const { month } = req.params;

  await db.query(
    `
    UPDATE donas_finance_months
    SET locked = false,
        snapshot = NULL
    WHERE month = $1
    `,
    [month]
  );

  res.json({ ok: true, locked: false });
};
