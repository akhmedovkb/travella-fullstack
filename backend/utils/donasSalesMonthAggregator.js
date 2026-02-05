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

/**
 * Считает агрегаты revenue/cogs по donas_sales за месяц ym (YYYY-MM)
 */
async function getSalesAggForMonth(ym) {
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
 * Обновляет (или создаёт) строку в donas_finance_months для ym:
 * - revenue/cogs ставим из Sales
 * - остальные поля не трогаем
 *
 * Не требует UNIQUE индекса — сначала UPDATE, если 0 строк -> INSERT.
 */
async function upsertMonthsRevenueCogsFromSales(ym) {
  if (!isYm(ym)) return { ok: false, reason: "bad_ym" };

  const agg = await getSalesAggForMonth(ym);

  const monthDate = `${ym}-01`;

  // 1) пробуем обновить существующий месяц
  const upd = await db.query(
    `
    UPDATE donas_finance_months
    SET revenue = $1,
        cogs = $2
    WHERE slug = $3
      AND month = ($4)::date
    `,
    [agg.revenue, agg.cogs, SLUG, monthDate]
  );

  if ((upd.rowCount || 0) > 0) {
    return { ok: true, ym, ...agg, mode: "update" };
  }

  // 2) если месяца нет — создаём
  // (остальные поля по умолчанию 0/пусто; notes пустые)
  await db.query(
    `
    INSERT INTO donas_finance_months
      (slug, month, revenue, cogs, opex, capex, loan_paid, cash_end, notes)
    VALUES
      ($1, ($2)::date, $3, $4, 0, 0, 0, 0, '')
    `,
    [SLUG, monthDate, agg.revenue, agg.cogs]
  );

  return { ok: true, ym, ...agg, mode: "insert" };
}

/**
 * Публичная функция: "touch month by sales"
 * (вызывай из Sales controller после изменений)
 */
async function touchMonthFromSales(ym) {
  try {
    return await upsertMonthsRevenueCogsFromSales(ym);
  } catch (e) {
    console.error("touchMonthFromSales error:", e);
    return { ok: false, ym, error: e?.message || "touch failed" };
  }
}

module.exports = {
  touchMonthFromSales,
  getSalesAggForMonth,
};
