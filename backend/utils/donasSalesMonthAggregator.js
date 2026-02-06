// backend/utils/donasSalesMonthAggregator.js
const db = require("../db");

const SLUG = "donas-dosas";

function isYm(s) {
  return /^\d{4}-\d{2}$/.test(String(s || ""));
}

function toNum(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function hasLockedTag(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}

function ymToMonthDate(ym) {
  return `${ym}-01`;
}

function nextYm(ym) {
  const [y, m] = String(ym).split("-").map((v) => Number(v));
  const d = new Date(Date.UTC(y, (m - 1) + 1, 1)); // next month
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

async function listMonthsRange(startYm, endYm) {
  const { rows } = await db.query(
    `
    SELECT *
    FROM donas_finance_months
    WHERE slug=$1
      AND month >= ($2)::date
      AND month <= ($3)::date
    ORDER BY month ASC, id ASC
    `,
    [SLUG, ymToMonthDate(startYm), ymToMonthDate(endYm)]
  );
  return rows || [];
}

function pickLastByMonth(rows) {
  const map = new Map();
  for (const r of rows) {
    const ym = String(r.month).slice(0, 7);
    const prev = map.get(ym);
    if (!prev || Number(r.id) > Number(prev.id)) map.set(ym, r);
  }
  return map;
}

async function ensureMonthRow(ym) {
  const monthDate = ymToMonthDate(ym);

  const q = await db.query(
    `
    SELECT *
    FROM donas_finance_months
    WHERE slug=$1 AND month=($2)::date
    ORDER BY id DESC
    LIMIT 1
    `,
    [SLUG, monthDate]
  );

  if (q.rows?.[0]) return q.rows[0];

  const ins = await db.query(
    `
    INSERT INTO donas_finance_months
      (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes)
    VALUES
      ($1, ($2)::date, 0, 0, 0, 0, 0, 0, '')
    RETURNING *
    `,
    [SLUG, monthDate]
  );

  return ins.rows[0];
}

async function isLockedMonth(ym) {
  const r = await ensureMonthRow(ym);
  return hasLockedTag(r?.notes || "");
}

// Sales → revenue/cogs
async function getSalesAggForMonth(ym) {
  const { rows } = await db.query(
    `
    SELECT
      COALESCE(SUM(revenue_total),0) AS revenue,
      COALESCE(SUM(cogs_total),0)    AS cogs
    FROM donas_sales
    WHERE to_char(sold_at,'YYYY-MM') = $1
    `,
    [ym]
  );
  const r = rows?.[0] || {};
  return { revenue: toNum(r.revenue), cogs: toNum(r.cogs) };
}

// Purchases → opex/capex
async function getPurchasesAggForMonth(ym) {
  const { rows } = await db.query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN upper(type)='OPEX'  THEN total ELSE 0 END),0) AS opex,
      COALESCE(SUM(CASE WHEN upper(type)='CAPEX' THEN total ELSE 0 END),0) AS capex
    FROM donas_purchases
    WHERE to_char(date,'YYYY-MM') = $1
    `,
    [ym]
  );
  const r = rows?.[0] || {};
  return { opex: toNum(r.opex), capex: toNum(r.capex) };
}

async function updateMonthAgg(ym) {
  if (await isLockedMonth(ym)) {
    return { ym, ok: true, locked: true, updated: false };
  }

  await ensureMonthRow(ym);

  const [sales, pur] = await Promise.all([getSalesAggForMonth(ym), getPurchasesAggForMonth(ym)]);

  await db.query(
    `
    UPDATE donas_finance_months
    SET revenue=$1,
        cogs=$2,
        opex=$3,
        capex=$4
    WHERE slug=$5 AND month=($6)::date
    `,
    [sales.revenue, sales.cogs, pur.opex, pur.capex, SLUG, ymToMonthDate(ym)]
  );

  return { ym, ok: true, locked: false, updated: true, ...sales, ...pur };
}

// cash_end chain: stop on #locked month
async function recomputeCashChainFrom(startYm, endYm) {
  // ensure every month row exists
  let cur = startYm;
  while (true) {
    await ensureMonthRow(cur);
    if (cur === endYm) break;
    cur = nextYm(cur);
  }

  const rows = await listMonthsRange(startYm, endYm);
  const byMonth = pickLastByMonth(rows);

  // prevYm
  const [sy, sm] = startYm.split("-").map(Number);
  const prevDate = new Date(Date.UTC(sy, sm - 2, 1));
  const prevYm = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(
    2,
    "0"
  )}`;

  let prevCash = 0;
  try {
    const prevRowQ = await db.query(
      `
      SELECT cash_end
      FROM donas_finance_months
      WHERE slug=$1 AND month=($2)::date
      ORDER BY id DESC
      LIMIT 1
      `,
      [SLUG, ymToMonthDate(prevYm)]
    );
    if (prevRowQ.rows?.[0]) prevCash = toNum(prevRowQ.rows[0].cash_end);
  } catch {
    // ignore
  }

  const results = [];
  cur = startYm;

  while (true) {
    const row = byMonth.get(cur) || (await ensureMonthRow(cur));
    const locked = hasLockedTag(row?.notes || "");

    if (locked) {
      results.push({ ym: cur, locked: true, cash_end: toNum(row.cash_end), updated: false });
      break;
    }

    const revenue = toNum(row.revenue);
    const cogs = toNum(row.cogs);
    const opex = toNum(row.opex);
    const capex = toNum(row.capex);
    const loan = toNum(row.loan_paid);

    const cf = revenue - cogs - opex - capex - loan;
    const cashEnd = prevCash + cf;

    await db.query(
      `
      UPDATE donas_finance_months
      SET cash_end=$1
      WHERE slug=$2 AND month=($3)::date
      `,
      [cashEnd, SLUG, ymToMonthDate(cur)]
    );

    results.push({ ym: cur, locked: false, cash_end: cashEnd, updated: true });

    prevCash = cashEnd;

    if (cur === endYm) break;
    cur = nextYm(cur);
  }

  return results;
}

/**
 * PUBLIC: full auto-touch for months (sales+purchases + cash_end chain + locked stop)
 */
async function touchMonthsFromYms(yms = []) {
  const list = (yms || []).filter(Boolean).filter(isYm);
  const uniq = [...new Set(list)].sort();
  if (!uniq.length) return { ok: true, touched: [], cash: [] };

  const startYm = uniq[0];
  const endYm = uniq[uniq.length - 1];

  const touched = [];
  for (const ym of uniq) {
    touched.push(await updateMonthAgg(ym));
  }

  const cash = await recomputeCashChainFrom(startYm, endYm);

  return { ok: true, touched, cash, range: { startYm, endYm } };
}

module.exports = {
  touchMonthsFromYms,
  getSalesAggForMonth,
};
