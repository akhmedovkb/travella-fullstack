//backend/controllers/donasCogsCheckController.js

const db = require("../db");

exports.checkCogs = async (req, res) => {
  const { month } = req.query;

  const sold = await db.query(
    `SELECT SUM(units_sold) units FROM donas_shifts
     WHERE to_char(date,'YYYY-MM')=$1`,
    [month]
  );

  const norms = await db.query(`SELECT * FROM donas_recipe_norms`);
  const purchases = await db.query(
    `SELECT SUM(total) actual FROM donas_purchases
     WHERE type='purchase' AND to_char(date,'YYYY-MM')=$1`,
    [month]
  );

  let ideal = 0;
  norms.rows.forEach(n => {
    ideal +=
      (Number(sold.rows[0].units || 0) *
        Number(n.grams_per_unit) *
        Number(n.price_per_kg)) / 1000;
  });

  const actual = Number(purchases.rows[0].actual || 0);
  const diff = actual - ideal;

  if (diff > ideal * 0.1) {
    await db.query(
      `INSERT INTO donas_alerts (type,severity,message)
       VALUES ('cogs','warn',$1)`,
      [`COGS превышен на ${Math.round(diff)} UZS`]
    );
  }

  res.json({ sold: sold.rows[0].units, ideal, actual, diff });
};
