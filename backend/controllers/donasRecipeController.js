//backend/controllers/donasRecipeController.js

const db = require("../db");

exports.upsertNorm = async (req, res) => {
  const { ingredient, grams_per_unit, price_per_kg } = req.body;

  const { rows } = await db.query(
    `INSERT INTO donas_recipe_norms (ingredient, grams_per_unit, price_per_kg)
     VALUES ($1,$2,$3)
     ON CONFLICT (ingredient)
     DO UPDATE SET
       grams_per_unit = EXCLUDED.grams_per_unit,
       price_per_kg = EXCLUDED.price_per_kg
     RETURNING *`,
    [ingredient, grams_per_unit, price_per_kg]
  );

  res.json(rows[0]);
};

exports.listNorms = async (req, res) => {
  const { rows } = await db.query(
    `SELECT * FROM donas_recipe_norms ORDER BY ingredient`
  );
  res.json(rows);
};
