// backend/utils/donasMonthAutoAggregator.js
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

async function getSalesAggForMonth(ym) {
  const { rows } = await db.query(
    `
    SELECT
      COALESCE(SUM(revenue_total), 0) AS revenue,
      COALESCE(SUM(cogs_total), 0)    AS cogs
    FROM donas_sales
    WHERE to_char(sold_at, 'YYYY-MM') = $1
    `,
    [ym]
  );

  const r = rows?.[0] || {};
  return { revenue: toNum(r.revenue), cogs: toNum(r.cogs) };
}

async function getPurchasesAggForMonth(ym) {
  // предполагаем: donas_purchases(date, type, total)
  // type: 'OPEX' / 'CAPEX' (или в любом регистре)
  const { rows } = await db.query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN UPPER(type)='OPEX'  THEN total ELSE 0 END), 0) AS opex,
      COALESCE(SUM(CASE WHEN UPPER(type)='CAPEX' THEN total ELSE 0 END), 0) AS capex
    FROM donas_purchases
    WHERE to_char(date, 'YYYY-MM') = $1
    `,
    [ym]
  );

  const r = rows?.[0] || {};
  return { opex: toNum(r.opex), capex: toNum(r.capex) };
}

async function ensureMonthRowExists(ym) {
  const monthDate = ymToDate(ym);

  const upd = await db.query(
    `
    UPDATE donas_finance_months
    SET month = month
    WHERE slug=$1 AND month = ($2)::date
    `,
    [SLUG, monthDate]
  );

  if ((upd.rowCount || 0) > 0) return;

  // создаём пустую строку, loan_paid не трогаем (0), cash_end пока 0 — дальше пересчитаем
  await db.query(
    `
    INSERT INTO donas_finance_months
      (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes)
    VALUES
      ($1, ($2)::date, 0, 0, 0, 0, 0, 0, '')
    `,
    [SLUG, monthDate]
  );
}

async function getMonthRow(ym) {
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

/**
 * Пересчитать только агрегаты месяца (без cash_end chain):
 * - revenue/cogs из Sales (если включено)
 * - opex/capex из Purchases (если включено)
 * LOCKED: если notes содержит #locked — ничего не обновляем.
 */
async function recomputeMonthAgg(ym, { fromSales, fromPurchases } = {}) {
  if (!isYm(ym)) return { ok: false, reason: "bad_ym" };

  await ensureMonthRowExists(ym);

  const row = await getMonthRow(ym);
  if (!row) return { ok: false, reason: "month_missing" };

  const locked = hasLockedTag(row.notes);
  if (locked) {
    return { ok: true, ym, locked: true, updated: false };
  }

  const salesAgg = fromSales ? await getSalesAggForMonth(ym) : null;
  const purAgg = fromPurchases ? await getPurchasesAggForMonth(ym) : null;

  const nextRevenue = fromSales ? toNum(salesAgg.revenue) : toNum(row.revenue);
  const nextCogs = fromSales ? toNum(salesAgg.cogs) : toNum(row.cogs);
  const nextOpex = fromPurchases ? toNum(purAgg.opex) : toNum(row.opex);
  const nextCapex = fromPurchases ? toNum(purAgg.capex) : toNum(row.capex);

  await db.query(
    `
    UPDATE donas_finance_months
    SET revenue=$1, cogs=$2, opex=$3, capex=$4, updated_at=NOW()
    WHERE slug=$5 AND month=($6)::date
    `,
    [nextRevenue, nextCogs, nextOpex, nextCapex, SLUG, ymToDate(ym)]
  );

  return {
    ok: true,
    ym,
    locked: false,
    updated: true,
    revenue: nextRevenue,
    cogs: nextCogs,
    opex: nextOpex,
    capex: nextCapex,
  };
}

/**
 * Пересчитать cash_end цепочку начиная с ym и дальше по всем месяцам, которые есть в таблице.
 * LOCKED: месяц не трогаем, но используем его cash_end как базу для следующего месяца.
 */
async function recomputeCashChainFrom(ym) {
  if (!isYm(ym)) return { ok: false, reason: "bad_ym" };

  await ensureMonthRowExists(ym);

  // prev cash_end: либо из предыдущего месяца в таблице, либо cash_start из settings
  const prevQ = await db.query(
    `
    SELECT *
    FROM donas_finance_months
    WHERE slug=$1 AND month < ($2)::date
    ORDER BY month DESC, id DESC
    LIMIT 1
    `,
    [SLUG, ymToDate(ym)]
  );

  const cashStart = await getCashStart();
  let prevCashEnd =
    prevQ.rows?.[0]?.cash_end != null ? toNum(prevQ.rows[0].cash_end) : cashStart;

  // берём все месяцы >= ym (уже создан), по порядку
  const chainQ = await db.query(
    `
    SELECT *
    FROM donas_finance_months
    WHERE slug=$1 AND month >= ($2)::date
    ORDER BY month ASC, id ASC
    `,
    [SLUG, ymToDate(ym)]
  );

  const updated = [];
  for (const m of chainQ.rows || []) {
    const mYm = String(m.month).slice(0, 7);
    const locked = hasLockedTag(m.notes);

    if (locked) {
      // снепшот: не меняем, но продолжаем от его cash_end
      const snapCash = m.cash_end != null ? toNum(m.cash_end) : prevCashEnd;
      prevCashEnd = snapCash;
      updated.push({ ym: mYm, locked: true, cash_end: snapCash, updated: false });
      continue;
    }

    const revenue = toNum(m.revenue);
    const cogs = toNum(m.cogs);
    const opex = toNum(m.opex);
    const capex = toNum(m.capex);
    const loan = toNum(m.loan_paid);

    const cashEnd = prevCashEnd + revenue - cogs - opex - capex - loan;

    await db.query(
      `
      UPDATE donas_finance_months
      SET cash_end=$1, updated_at=NOW()
      WHERE slug=$2 AND month=($3)::date
      `,
      [cashEnd, SLUG, m.month]
    );

    prevCashEnd = cashEnd;
    updated.push({ ym: mYm, locked: false, cash_end: cashEnd, updated: true });
  }

  return { ok: true, start: ym, updated };
}

/**
 * Главная функция: “FULL auto-touch”
 * - пересчитать агрегаты месяца (sales/purchases)
 * - пересчитать cash_end chain
 * LOCKED: агрегаты месяца не трогаем, chain всё равно пересчитывается от снепшотов.
 */
async function touchMonthFull(ym, { fromSales = false, fromPurchases = false } = {}) {
  const agg = await recomputeMonthAgg(ym, { fromSales, fromPurchases });
  const chain = await recomputeCashChainFrom(ym);
  return { ok: true, ym, agg, chain };
}

module.exports = {
  touchMonthFull,
  recomputeMonthAgg,
  recomputeCashChainFrom,
  getSalesAggForMonth,
  getPurchasesAggForMonth,
};
