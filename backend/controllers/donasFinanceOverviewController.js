// backend/controllers/donasFinanceOverviewController.js
const db = require("../db");

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

exports.getOverview = async (req, res) => {
  const month = req.query.month || currentMonth();

  // manual revenue
  const rev = await db.oneOrNone(
    `SELECT manual_revenue FROM donas_finance_months WHERE month=$1`,
    [month]
  );

  const revenue = Number(rev?.manual_revenue || 0);

  // OPEX
  const opexRow = await db.one(
    `
    SELECT COALESCE(SUM(amount),0) as total
    FROM donas_opex
    WHERE (month=$1 OR recurring=true)
    `,
    [month]
  );
  const opex = Number(opexRow.total);

  // CAPEX amortization
  const capexRow = await db.one(
    `
    SELECT COALESCE(SUM(amount / depreciation_months),0) as total
    FROM donas_capex
    WHERE purchase_month <= $1
      AND purchase_month + (depreciation_months || ' months')::interval > $1
    `,
    [month]
  );
  const capex = Number(capexRow.total);

  // COGS snapshot (last)
  const cogsRow = await db.oneOrNone(`
    SELECT total_cogs
    FROM donas_cogs_snapshots
    WHERE snapshot_month <= $1
    ORDER BY snapshot_month DESC
    LIMIT 1
  `, [month]);

  const cogs = Number(cogsRow?.total_cogs || 0);

  const gross = revenue - cogs;
  const net = gross - opex - capex;
  const margin = revenue > 0 ? (net / revenue) * 100 : 0;

  res.json({
    month,
    revenue,
    cogs,
    opex,
    capex,
    gross,
    net,
    margin
  });
};
