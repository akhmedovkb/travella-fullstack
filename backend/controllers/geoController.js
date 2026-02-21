// backend/controllers/geoController.js
const pool = require("../db");

function normLang(lang) {
  const l = String(lang || "").toLowerCase();
  if (l === "ru" || l === "uz" || l === "en") return l;
  return "ru";
}

exports.searchAirports = async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const lang = normLang(req.query.lang);
    const cc = String(req.query.cc || "").trim().toUpperCase(); // ✅ фильтр по стране
    const limit = Math.min(parseInt(req.query.limit || "20", 10) || 20, 50);

    if (!q || q.length < 2) {
      return res.json({ items: [] });
    }

    const nameCol =
      lang === "uz"
        ? "city_name_uz"
        : lang === "en"
        ? "city_name_en"
        : "city_name_ru";

    const params = [];
    let where = `
      (
        city_name_ru ILIKE $1 OR
        city_name_en ILIKE $1 OR
        city_name_uz ILIKE $1 OR
        iata ILIKE $1
      )
    `;
    params.push(`%${q}%`);

    // ✅ если передана страна — фильтруем
    if (cc) {
      params.push(cc);
      where += ` AND country_code = $${params.length}`;
    }

    params.push(limit);

    const sql = `
      SELECT
        iata,
        country_code,
        ${nameCol} AS city_name
      FROM airport_cities
      WHERE ${where}
      ORDER BY
        CASE WHEN iata ILIKE $1 THEN 0 ELSE 1 END,
        ${nameCol} ASC
      LIMIT $${params.length}
    `;

    const { rows } = await pool.query(sql, params);

    const items = rows.map((r) => ({
      value: r.city_name, // ✅ сохраняем строку города
      label: `${r.city_name} (${r.iata})`,
      city: r.city_name,
      iata: r.iata,
      countryCode: r.country_code,
    }));

    res.json({ items });
  } catch (e) {
    console.error("searchAirports error:", e);
    res.status(500).json({ items: [] });
  }
};
