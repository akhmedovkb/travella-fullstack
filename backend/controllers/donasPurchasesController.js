//backend/controllers/donasPurchasesController.js

const db = require("../db");

exports.addPurchase = async (req, res) => {
  const { date, ingredient, qty, price, type } = req.body;

  const { rows } = await db.query(
    `INSERT INTO donas_purchases (date, ingredient, qty, price, type)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING *`,
    [date, ingredient, qty, price, type]
  );

  res.json(rows[0]);
};

exports.listPurchases = async (req, res) => {
  const { month } = req.query;

  const { rows } = await db.query(
    `SELECT * FROM donas_purchases
     WHERE to_char(date,'YYYY-MM') = $1
     ORDER BY date DESC`,
    [month]
  );

  res.json(rows);
};
