// backend/controllers/airportController.js
const pool = require("../db");

function normLang(lang) {
  const l = String(lang || "").toLowerCase();
  if (l.startsWith("ru")) return "ru";
  if (l.startsWith("uz")) return "uz";
  return "en";
}

function isIataLike(q) {
  const s = String(q || "").trim().toUpperCase();
  return /^[A-Z]{2,4}$/.test(s); // TAS, IST, JFK, etc
}

async function searchAirports(req, res) {
  try {
    const qRaw = String(req.query.q || "").trim();
    const q = qRaw.toLowerCase();
    const lang = normLang(req.query.lang);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "10", 10) || 10, 1), 30);

    if (!qRaw || qRaw.length < 2) {
      return res.json({ ok: true, items: [] });
    }

    const qIata = String(qRaw).trim().toUpperCase();
    const wantIata = isIataLike(qRaw);

    // имя под язык, с фолбэком на en
    // (в ответе всё равно отдаём все 3, фронт сам выберет)
    const sql = `
      SELECT
        geoname_id,
        country_code,
        name_en,
        name_ru,
        name_uz,
        iata_codes,
        population,
        search_text,

        CASE
          WHEN $2::boolean AND iata_codes @> ARRAY[$3::text] THEN 1000
          WHEN $2::boolean AND EXISTS (
            SELECT 1 FROM unnest(iata_codes) c WHERE c LIKE ($3 || '%')
          ) THEN 800
          ELSE 0
        END AS rank_iata,

        similarity(search_text, $1) AS sim
      FROM airport_cities
      WHERE
        (
          -- поиск по названию/стране/кодам (у тебя search_text уже lower(...))
          search_text LIKE ('%' || $1 || '%')
          OR ($2::boolean AND EXISTS (
            SELECT 1 FROM unnest(iata_codes) c WHERE c LIKE ($3 || '%')
          ))
        )
      ORDER BY
        rank_iata DESC,
        sim DESC,
        population DESC NULLS LAST,
        geoname_id DESC
      LIMIT $4;
    `;

    const { rows } = await pool.query(sql, [q, wantIata, qIata, limit]);

    return res.json({
      ok: true,
      items: rows.map((r) => ({
        geoname_id: r.geoname_id,
        country_code: r.country_code,
        name_en: r.name_en,
        name_ru: r.name_ru,
        name_uz: r.name_uz,
        iata_codes: r.iata_codes || [],
        population: r.population,
      })),
      lang,
    });
  } catch (e) {
    console.error("searchAirports error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  }
}

module.exports = { searchAirports };
