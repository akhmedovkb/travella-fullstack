// backend/utils/donasSalesMonthAggregator.js
const { touchMonthFull } = require("./donasMonthAutoAggregator");

/**
 * FULL auto-touch по списку месяцев
 * - revenue / cogs из sales
 * - opex / capex НЕ трогаем
 * - cash_end chain
 * - #locked respected
 */
async function touchMonthsFromYms(yms = []) {
  const uniq = [...new Set((yms || []).filter(Boolean))].sort();
  if (!uniq.length) return { ok: true, touched: [] };

  const results = [];
  for (const ym of uniq) {
    const r = await touchMonthFull(ym, {
      fromSales: true,
      fromPurchases: false,
    });
    results.push(r);
  }

  return { ok: true, touched: results };
}

module.exports = {
  touchMonthsFromYms,
};
