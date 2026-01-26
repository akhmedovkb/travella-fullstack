//backend/controllers/donasFinanceController.js

const db = require("../db");

exports.getFinanceSummary = async (req, res) => {
  const { month } = req.query;

  const revenue = await db.query(
    `SELECT SUM(revenue) v FROM donas_shifts
     WHERE to_char(date,'YYYY-MM')=$1`,
    [month]
  );

  const cogs = await db.query(
    `SELECT SUM(total) v FROM donas_purchases
     WHERE type='purchase' AND to_char(date,'YYYY-MM')=$1`,
    [month]
  );

  const payroll = await db.query(
    `SELECT SUM(total_pay) v FROM donas_shifts
     WHERE to_char(date,'YYYY-MM')=$1`,
    [month]
  );

  const opex = await db.query(
    `SELECT COALESCE(SUM(fixed_pay + percent_pay + bonus),0) v
     FROM donas_shifts
     WHERE to_char(date,'YYYY-MM')=$1`,
    [month]
  );

  const loan = await db.query(
    `SELECT 6000000::numeric AS v`
  );

  const R = Number(revenue.rows[0].v || 0);
  const C = Number(cogs.rows[0].v || 0);
  const O = Number(opex.rows[0].v || 0);
  const L = Number(loan.rows[0].v || 0);

  const netOperating = R - C - O;
  const cashFlow = netOperating - L;
  const dscr = L > 0 ? netOperating / L : null;

  res.json({
    revenue: R,
    cogs: C,
    opex: O,
    netOperating,
    loan: L,
    cashFlow,
    dscr
  });
};
