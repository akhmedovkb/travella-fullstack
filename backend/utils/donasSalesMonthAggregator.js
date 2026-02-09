// backend/utils/donasSalesMonthAggregator.js

const db = require("../db");

const SLUG = "donas-dosas";

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function isYm(s) {
  return /^\d{4}-\d{2}$/.test(String(s || ""));
}

function ymToMonthDate(ym) {
  return `${ym}-01`;
}

function nextYm(ym) {
  const [y, m] = String(ym).split("-").map((v) => Number(v));
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

function prevYm(ym) {
  const [y, m] = String(ym).split("-").map((v) => Number(v));
  const d = new Date(Date.UTC(y, m - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

function hasLockedTag(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}

async function ensureMonthsTable() {
  // Minimal schema (should match donasFinanceMonthsController)
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

  await db.query(`CREATE INDEX IF NOT EXISTS idx_donas_finance_months_month ON donas_finance_months (month);`);

  // Unique guard for UPSERT
  try {
    await db.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_donas_finance_months_slug_month ON donas_finance_months (slug, month);`
    );
  } catch {}
}

async function ensureMonthRow(ym) {
  await ensureMonthsTable();

  const monthDate = ymToMonthDate(ym);

  const existing = await db.query(
    `SELECT * FROM donas_finance_months WHERE slug=$1 AND month=$2 LIMIT 1`,
    [SLUG, monthDate]
  );
  if (existing.rows && existing.rows[0]) return existing.rows[0];

  // ✅ UPSERT to avoid duplicate-key issues (DB has unique (slug,month))
  const inserted = await db.query(
    `
    INSERT INTO donas_finance_months (slug, month)
    VALUES ($1,$2)
    ON CONFLICT (slug, month) DO UPDATE SET slug = EXCLUDED.slug
    RETURNING *
    `,
    [SLUG, monthDate]
  );

  return inserted.rows[0];
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

async function computeAggsForMonth(ym) {
  // revenue + cogs from sales table
  await db.query(`
    CREATE TABLE IF NOT EXISTS donas_sales (
      id BIGSERIAL PRIMARY KEY,
      sold_at DATE NOT NULL,
      menu_item_id BIGINT NOT NULL,
      qty NUMERIC NOT NULL DEFAULT 1,
      unit_price NUMERIC NOT NULL DEFAULT 0,
      revenue_total NUMERIC NOT NULL DEFAULT 0,
      cogs_snapshot_id BIGINT,
      cogs_unit NUMERIC NOT NULL DEFAULT 0,
      cogs_total NUMERIC NOT NULL DEFAULT 0,
      channel TEXT NOT NULL DEFAULT 'cash',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const salesQ = await db.query(
    `
    SELECT
      COALESCE(SUM(revenue_total),0) AS revenue,
      COALESCE(SUM(cogs_total),0) AS cogs
    FROM donas_sales
    WHERE to_char(sold_at,'YYYY-MM')=$1
    `,
    [ym]
  );

  const revenue = toNum(salesQ.rows?.[0]?.revenue);
  const cogs = toNum(salesQ.rows?.[0]?.cogs);

  // purchases (opex/capex)
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

  const start = `${ym}-01`;
  const end = `${nextYm(ym)}-01`;

  const purQ = await db.query(
    `
    SELECT
      lower(type) AS type,
      COALESCE(SUM(total),0) AS total
    FROM donas_purchases
    WHERE date >= $1 AND date < $2
    GROUP BY lower(type)
    `,
    [start, end]
  );

  let opex = 0;
  let capex = 0;
  let loanPaid = 0;

  for (const r of purQ.rows || []) {
    const t = String(r.type || "").toLowerCase();
    const v = toNum(r.total);
    if (t === "opex") opex += v;
    else if (t === "capex") capex += v;
    else if (t === "loan" || t === "loan_paid") loanPaid += v;
  }

  return { revenue, cogs, opex, capex, loan_paid: loanPaid };
}

async function upsertMonth(ym, patch) {
  await ensureMonthsTable();

  const cur = (await getLatestMonthRow(ym)) || {};
  const notes = String(patch.notes ?? cur.notes ?? "");

  const revenue = patch.revenue == null ? toNum(cur.revenue) : toNum(patch.revenue);
  const cogs = patch.cogs == null ? toNum(cur.cogs) : toNum(patch.cogs);
  const opex = patch.opex == null ? toNum(cur.opex) : toNum(patch.opex);
  const capex = patch.capex == null ? toNum(cur.capex) : toNum(patch.capex);
  const loan_paid = patch.loan_paid == null ? toNum(cur.loan_paid) : toNum(patch.loan_paid);
  const cash_end = patch.cash_end == null ? toNum(cur.cash_end) : toNum(patch.cash_end);

  await db.query(
    `
    INSERT INTO donas_finance_months
      (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes)
    VALUES
      ($1, ($2 || '-01')::date, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (slug, month)
    DO UPDATE SET
      revenue   = EXCLUDED.revenue,
      cogs      = EXCLUDED.cogs,
      opex      = EXCLUDED.opex,
      capex     = EXCLUDED.capex,
      loan_paid = EXCLUDED.loan_paid,
      cash_end  = EXCLUDED.cash_end,
      notes     = EXCLUDED.notes
    `,
    [SLUG, ym, revenue, cogs, opex, capex, loan_paid, cash_end, notes]
  );
}

async function updateMonthAgg(ym) {
  if (!isYm(ym)) return;
  await ensureMonthRow(ym);

  if (await isMonthLocked(ym)) return;

  const agg = await computeAggsForMonth(ym);
  const cur = (await getLatestMonthRow(ym)) || {};
  await upsertMonth(ym, { ...agg, cash_end: toNum(cur.cash_end), notes: String(cur.notes || "") });
}

async function recomputeCashChainFrom(startYm, endYm, openingCash = 0) {
  if (!isYm(startYm) || !isYm(endYm)) return;

  await ensureMonthsTable();

  // previous month cash_end
  const prev = prevYm(startYm);
  const prevRow = await getLatestMonthRow(prev);
  let carry = prevRow ? toNum(prevRow.cash_end) : toNum(openingCash);

  let ym = startYm;
  while (true) {
    await ensureMonthRow(ym);

    const cur = (await getLatestMonthRow(ym)) || {};
    const locked = hasLockedTag(cur.notes);

    let cashEnd = toNum(cur.cash_end);
    if (!locked) {
      const revenue = toNum(cur.revenue);
      const cogs = toNum(cur.cogs);
      const opex = toNum(cur.opex);
      const capex = toNum(cur.capex);
      const loanPaid = toNum(cur.loan_paid);

      cashEnd = carry + revenue - cogs - opex - capex - loanPaid;

      await upsertMonth(ym, {
        revenue,
        cogs,
        opex,
        capex,
        loan_paid: loanPaid,
        cash_end: cashEnd,
        notes: String(cur.notes || ""),
      });
    }

    carry = cashEnd;

    if (ym === endYm) break;
    ym = nextYm(ym);
  }
}

async function getOpeningCash() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS donas_finance_settings (
      id BIGSERIAL PRIMARY KEY,
      slug TEXT NOT NULL,
      opening_cash NUMERIC NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  const q = await db.query(
    `
    SELECT opening_cash
    FROM donas_finance_settings
    WHERE slug=$1
    ORDER BY id DESC
    LIMIT 1
    `,
    [SLUG]
  );
  return toNum(q.rows?.[0]?.opening_cash);
}

async function getMaxYmFromMonthsOrData(fallbackYm) {
  await ensureMonthsTable();

  const a = await db.query(
    `SELECT to_char(max(month),'YYYY-MM') AS max_ym FROM donas_finance_months WHERE slug=$1`,
    [SLUG]
  );
  const maxYmMonths = a.rows?.[0]?.max_ym;

  // try data sources too
  const b = await db.query(`
    SELECT
      MAX(d) AS max_d
    FROM (
      SELECT MAX(date) AS d FROM donas_purchases
      UNION ALL
      SELECT MAX(sold_at) AS d FROM donas_sales
    ) t
  `);

  const maxD = b.rows?.[0]?.max_d;
  const maxYmData = maxD ? String(maxD).slice(0, 7) : null;

  let out = fallbackYm;
  if (isYm(maxYmMonths) && (!out || maxYmMonths > out)) out = maxYmMonths;
  if (isYm(maxYmData) && (!out || maxYmData > out)) out = maxYmData;
  return out;
}

async function touchMonthsFromYms(yms) {
  const uniq = [...new Set((yms || []).filter((x) => isYm(x)))].sort();
  if (!uniq.length) return;

  const chainStart = prevYm(uniq[0]);
  const endYm = await getMaxYmFromMonthsOrData(uniq[uniq.length - 1]);

  // recompute aggs for all touched months (+ chainStart)
  try {
    await updateMonthAgg(chainStart);
  } catch {}

  for (const ym of uniq) {
    await updateMonthAgg(ym);
  }

  const openingCash = await getOpeningCash();
  await recomputeCashChainFrom(chainStart, endYm, openingCash);
}

module.exports = {
  touchMonthsFromYms,
  // export internals for reuse/debug
  _internal: {
    SLUG,
    toNum,
    isYm,
    nextYm,
    prevYm,
    ymToMonthDate,
    ensureMonthsTable,
    ensureMonthRow,
    getLatestMonthRow,
    isMonthLocked,
    updateMonthAgg,
    recomputeCashChainFrom,
    getMaxYmFromMonthsOrData,
  },
};
