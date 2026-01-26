//backend/controllers/donasShiftController.js

const db = require("../db");

exports.createShift = async (req, res) => {
  const {
    date,
    staff_name,
    units_sold,
    revenue,
    gross_profit,
    fixed_pay,
    percent_pay,
    bonus,
    status
  } = req.body;

  const total_pay =
    Number(fixed_pay || 0) +
    Number(percent_pay || 0) +
    Number(bonus || 0);

  const { rows } = await db.query(
    `INSERT INTO donas_shifts
     (date, staff_name, units_sold, revenue, gross_profit,
      fixed_pay, percent_pay, bonus, total_pay, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      date,
      staff_name,
      units_sold,
      revenue,
      gross_profit,
      fixed_pay,
      percent_pay,
      bonus,
      total_pay,
      status || "ok"
    ]
  );

  res.json(rows[0]);
};

exports.listShifts = async (req, res) => {
  const { month } = req.query;

  const { rows } = await db.query(
    `SELECT * FROM donas_shifts
     WHERE to_char(date, 'YYYY-MM') = $1
     ORDER BY date DESC`,
    [month]
  );

  res.json(rows);
};
