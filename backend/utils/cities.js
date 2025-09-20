//backend/utils/cities.js

const pool = require("../db");

function toLc(s) { return String(s || "").trim().toLowerCase(); }

/** Возвращает slug по любому написанию; null если не нашли */
async function resolveCitySlug(input) {
  const v = toLc(input);
  if (!v) return null;
  const { rows } = await pool.query(
    `SELECT slug
       FROM cities
      WHERE lower(slug) = $1
         OR $1 = ANY(aliases)
      LIMIT 1`,
    [v]
  );
  return rows[0]?.slug || null;
}

/** Массив строк → массив slug (уникальных) */
async function resolveCitySlugs(inputs = []) {
  const uniq = [...new Set(inputs.map(toLc).filter(Boolean))];
  if (!uniq.length) return [];
  const { rows } = await pool.query(
    `SELECT DISTINCT slug
       FROM cities
      WHERE lower(slug) = ANY($1)
         OR EXISTS (
              SELECT 1 FROM unnest(aliases) a
              WHERE a = ANY($1)
            )`,
    [uniq]
  );
  return rows.map(r => r.slug);
}

module.exports = { resolveCitySlug, resolveCitySlugs };
