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
function ymToDate(ym) {
  return `${ym}-01`;
}
function hasLockedTag(notes) {
  return String(notes || "").toLowerCase().includes("#locked");
}

async function getCashStart() {
  try {
    const { rows } = await db.query(
      `
      SELECT cash_start
      FROM donas_finance_settings
      WHERE slug=$1
      ORDER BY id DESC
      LIMIT 1
      `,
      [SLUG]
    );
    return toNum(rows?.[0]?.cash_start);
  } catch {
    return 0;
  }
}

/**
 * Sales agg: revenue/cogs за ym
 */
async function getSalesAggForMonth(ym) {
  if (!isYm(ym)) return { revenue: 0, cogs: 0, cnt: 0 };

  const { rows } = await db.query(
    `
    SELECT
      COALESCE(SUM(revenue_total), 0) AS revenue,
      COALESCE(SUM(cogs_total), 0)    AS cogs,
      COUNT(*)::int                  AS cnt
    FROM donas_sales
    WHERE to_char(sold_at, 'YYYY-MM') = $1
    `,
    [ym]
  );

  const r = rows?.[0] || {};
  return {
    revenue: toNum(r.revenue),
    cogs: toNum(r.cogs),
    cnt: Number(r.cnt || 0) || 0,
  };
}

/**
 * Purchases agg: opex/capex за ym
 * ожидаем donas_purchases(date, total, type)
 */
async function getPurchasesAggForMonth(ym) {
  if (!isYm(ym)) return { opex: 0, capex: 0 };

  const { rows } = await db.query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN LOWER(type)='opex'  THEN COALESCE(total,0) ELSE 0 END), 0) AS opex,
      COALESCE(SUM(CASE WHEN LOWER(type)='capex' THEN COALESCE(total,0) ELSE 0 END), 0) AS capex
    FROM donas_purchases
    WHERE to_char(date, 'YYYY-MM') = $1
    `,
    [ym]
  );

  const r = rows?.[0] || {};
  return { opex: toNum(r.opex), capex: toNum(r.capex) };
}

async function getMonthRow(ym) {
  if (!isYm(ym)) return null;
  const { rows } = await db.query(
    `
    SELECT *
    FROM donas_finance_months
    WHERE slug=$1 AND month = ($2)::date
    ORDER BY id DESC
    LIMIT 1
    `,
    [SLUG, ymToDate(ym)]
  );
  return rows?.[0] || null;
}

async function ensureMonthRowExists(ym) {
  const cur = await getMonthRow(ym);
  if (cur) return cur;

  const { rows } = await db.query(
    `
    INSERT INTO donas_finance_months
      (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes)
    VALUES
      ($1, ($2)::date, 0, 0, 0, 0, 0, 0, '')
    RETURNING *
    `,
    [SLUG, ymToDate(ym)]
  );
  return rows?.[0] || null;
}

async function listMonthsFrom(fromYm) {
  const { rows } = await db.query(
    `
    SELECT to_char(month,'YYYY-MM') AS ym, notes
    FROM donas_finance_months
    WHERE slug=$1 AND month >= ($2)::date
    ORDER BY month ASC
    `,
    [SLUG, ymToDate(fromYm)]
  );
  return (rows || []).map((r) => ({ ym: r.ym, notes: r.notes || "" }));
}

async function getPrevExistingMonthYm(ym) {
  const { rows } = await db.query(
    `
    SELECT to_char(month,'YYYY-MM') AS ym
    FROM donas_finance_months
    WHERE slug=$1 AND month < ($2)::date
    ORDER BY month DESC
    LIMIT 1
    `,
    [SLUG, ymToDate(ym)]
  );
  return rows?.[0]?.ym || null;
}

/**
 * Пересчитать 1 месяц (если не locked):
 * revenue/cogs (Sales) + opex/capex (Purchases) + cash_end chain
 *
 * cash_end = prevCashEnd + ( (revenue - cogs - opex) - loan_paid - capex )
 */
async function recomputeOneMonth(ym, prevCashEnd) {
  const row = await ensureMonthRowExists(ym);
  if (!row) return { ok: false, ym, reason: "no_row" };

  if (hasLockedTag(row.notes)) {
    return { ok: true, ym, locked: true, cash_end: toNum(row.cash_end) };
  }

  const sales = await getSalesAggForMonth(ym);
  const purch = await getPurchasesAggForMonth(ym);

  const loan = toNum(row.loan_paid);

  const gp = sales.revenue - sales.cogs;
  const netOp = gp - purch.opex;
  const cf = netOp - loan - purch.capex;

  const cash_end = toNum(prevCashEnd) + cf;

  await db.query(
    `
    UPDATE donas_finance_months
    SET revenue=$1,
        cogs=$2,
        opex=$3,
        capex=$4,
        cash_end=$5
    WHERE slug=$6 AND month=($7)::date
    `,
    [sales.revenue, sales.cogs, purch.opex, purch.capex, cash_end, SLUG, ymToDate(ym)]
  );

  return {
    ok: true,
    ym,
    locked: false,
    revenue: sales.revenue,
    cogs: sales.cogs,
    opex: purch.opex,
    capex: purch.capex,
    loan_paid: loan,
    cash_end,
    cf,
    sales_cnt: sales.cnt,
  };
}

/**
 * FULL auto-touch:
 * - стартуем с fromYm
 * - пересчитываем цепочку cash_end вперед по существующим months
 * - если встречаем locked месяц -> STOP (его не трогаем и дальше не идём)
 */
async function touchMonthsFrom(fromYm) {
  if (!isYm(fromYm)) return { ok: false, reason: "bad_ym", fromYm };

  await ensureMonthRowExists(fromYm);

  const months = await listMonthsFrom(fromYm);
  if (!months.length) return { ok: true, fromYm, touched: 0, stoppedOnLocked: false, items: [] };

  const prevYm = await getPrevExistingMonthYm(fromYm);
  let prevCashEnd;
  if (prevYm) {
    const prevRow = await getMonthRow(prevYm);
    prevCashEnd = toNum(prevRow?.cash_end);
  } else {
    prevCashEnd = await getCashStart();
  }

  const items = [];
  let stoppedOnLocked = false;

  for (const m of months) {
    const curRow = await getMonthRow(m.ym);
    if (curRow && hasLockedTag(curRow.notes)) {
      items.push({
        ym: m.ym,
        locked: true,
        skipped: true,
        cash_end: toNum(curRow.cash_end),
      });
      stoppedOnLocked = true;
      break;
    }

    const r = await recomputeOneMonth(m.ym, prevCashEnd);
    items.push(r);

    if (r && r.ok && !r.locked) {
      prevCashEnd = toNum(r.cash_end);
    } else {
      // если ошибка — лучше стоп
      break;
    }
  }

  return {
    ok: true,
    fromYm,
    touched: items.filter((x) => x && x.ok && !x.locked).length,
    stoppedOnLocked,
    items,
  };
}

/**
 * Когда затронуто несколько ym (например move sale),
 * нужно пересчитывать с минимального ym (чтобы цепочка cash_end была корректной).
 */
async function touchMonthsFromYms(yms) {
  const list = []
    .concat(yms || [])
    .map((s) => String(s || "").slice(0, 7))
    .filter((s) => isYm(s));

  if (!list.length) return { ok: false, reason: "no_valid_yms" };

  list.sort(); // YYYY-MM сортируется лексикографически корректно
  return await touchMonthsFrom(list[0]);
}

/**
 * BACKWARD COMPAT:
 * старый контракт "touch month from sales"
 * теперь это full touch с этого ym
 */
async function touchMonthFromSales(ym) {
  return await touchMonthsFrom(ym);
}

module.exports = {
  getSalesAggForMonth,
  getPurchasesAggForMonth,

  touchMonthsFrom,
  touchMonthsFromYms,

  // legacy
  touchMonthFromSales,
};
