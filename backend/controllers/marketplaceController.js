const pool = require("../db");

const searchListings = async (req, res) => {
  const { category, startDate, endDate, location, adults, children, infants } = req.body;

  try {
    const results = await pool.query(
      `SELECT * FROM services 
       WHERE category = $1 
         AND ($2::DATE IS NULL OR NOT EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(availability) AS a
              WHERE a::DATE BETWEEN $2::DATE AND $3::DATE
            ))
         AND location ILIKE $4`,
      [category, startDate, endDate, `%${location}%`]
    );

    res.json(results.rows);
  } catch (err) {
    console.error("Ошибка при поиске объявлений:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

module.exports = { searchListings };
