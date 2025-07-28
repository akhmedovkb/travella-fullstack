const pool = require("../db");

const searchHotels = async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.json([]);

    const result = await pool.query(
      `SELECT id, name FROM hotels WHERE name ILIKE $1 LIMIT 10`,
      [`%${query}%`]
    );

    const hotels = result.rows.map(h => ({ value: h.name, label: h.name }));
    res.json(hotels);
  } catch (err) {
    console.error("Ошибка поиска отелей:", err.message);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

module.exports = { searchHotels };
