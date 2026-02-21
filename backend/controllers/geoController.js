// backend/controllers/geoController.js
const pool = require("../db");

function normLang(x) {
  const s = String(x || "").toLowerCase();
  if (s === "ru" || s === "uz" || s === "en") return s;
  return "en";
}

function clampInt(n, a, b) {
  const v = Number(n);
  if (!Number.isFinite(v)) return a;
  return Math.min(b, Math.max(a, Math.trunc(v)));
}

exports.searchAirports = async (req, res) => {
  try {
    const qRaw = String(req.query.q || req.query.query || "").trim();
    const q = qRaw.toLowerCase();
    const lang = normLang(req.query.lang);
    const limit = clampInt(req.query.limit, 1, 30);

    if (q.length < 2) {
      return res.json({ items: [] });
    }

    const nameCol =
      lang === "ru" ? "name_ru" : lang === "uz" ? "name_uz" : "name_en";

    // если ввели IATA (3 буквы) — отдаём сначала точные совпадения
    const iata = qRaw.trim().toUpperCase();
    const isIata = /^[A-Z]{3}$/.test(iata);

    const sql = `
      WITH base AS (
        SELECT
          geoname_id,
          country_code,
          name_en, name_ru, name_uz,
          iata_codes,
          population,
          COALESCE(NULLIF(${nameCol}, ''), name_en) AS name_local,
          search_text
        FROM airport_cities
        WHERE
          (
            $3::boolean = true AND iata_codes @> ARRAY[$4]::text[]
          )
          OR
          (
            search_text % $1
            OR search_text ILIKE '%' || $1 || '%'
          )
      )
      SELECT
        geoname_id,
        country_code,
        name_en, name_ru, name_uz,
        name_local,
        iata_codes,
        population
      FROM base
      ORDER BY
        CASE WHEN $3::boolean = true AND iata_codes @> ARRAY[$4]::text[] THEN 0 ELSE 1 END,
        similarity(search_text, $1) DESC,
        population DESC NULLS LAST,
        geoname_id DESC
      LIMIT $2;
    `;

    const { rows } = await pool.query(sql, [q, limit, isIata, iata]);

    // нормализуем под фронт
    const items = rows.map((r) => {
      const codes = Array.isArray(r.iata_codes) ? r.iata_codes : [];
      const primaryIata = codes[0] || null;

      return {
        geoname_id: r.geoname_id,
        country_code: r.country_code,
        name: r.name_local || r.name_en,
        name_en: r.name_en,
        name_ru: r.name_ru,
        name_uz: r.name_uz,
        iata: primaryIata,
        iata_codes: codes,
        population: r.population,
      };
    });

    return res.json({ items });
  } catch (e) {
    console.error("searchAirports error:", e?.message || e);
    return res.status(500).json({ error: "search_failed" });
  }
};

exports.getAirportByIata = async (req, res) => {
  try {
    const code = String(req.params.code || "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      return res.status(400).json({ error: "bad_iata" });
    }

    const sql = `
      SELECT
        geoname_id,
        country_code,
        name_en, name_ru, name_uz,
        iata_codes,
        population
      FROM airport_cities
      WHERE iata_codes @> ARRAY[$1]::text[]
      ORDER BY population DESC NULLS LAST, geoname_id DESC
      LIMIT 1;
    `;

    const { rows } = await pool.query(sql, [code]);
    if (!rows.length) return res.status(404).json({ error: "not_found" });

    const r = rows[0];
    return res.json({
      geoname_id: r.geoname_id,
      country_code: r.country_code,
      name_en: r.name_en,
      name_ru: r.name_ru,
      name_uz: r.name_uz,
      iata_codes: r.iata_codes || [],
      population: r.population,
    });
  } catch (e) {
    console.error("getAirportByIata error:", e?.message || e);
    return res.status(500).json({ error: "lookup_failed" });
  }
};
