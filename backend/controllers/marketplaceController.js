// backend/controllers/marketplaceController.js

const db = require("../db");
const pg = db?.query ? db : db?.pool;

if (!pg || typeof pg.query !== "function") {
  throw new Error("DB driver not available: expected node-postgres Pool with .query()");
}

/* -------------------- константы/хелперы -------------------- */

const PRICE_SQL = `COALESCE(NULLIF(s.details->>'netPrice','')::numeric, s.price)`;

// алиасы категорий (при необходимости добавляйте свои ключи)
const CATEGORY_ALIAS = {
  guide: ["city_tour_guide", "mountain_tour_guide"],
  transport: [
    "city_tour_transport",
    "mountain_tour_transport",
    "one_way_transfer",
    "dinner_transfer",
    "border_transfer",
    "hotel_transfer",
  ],
  refused_tour: ["refused_tour"],
  refused_hotel: ["refused_hotel"],
  refused_flight: ["refused_flight"],
  refused_event_ticket: ["refused_event_ticket"],
  visa_support: ["visa_support"],
};
const expandCategory = (cat) =>
  cat ? CATEGORY_ALIAS[String(cat).trim()] || [String(cat).trim()] : null;

function splitTokens(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

// базовые синонимы для определения типа и языка в свободном тексте
const TYPE_SYNONYMS = {
  guide: ["guide", "гид", "ekskursiya", "экскурсия", "экскурсовод", "gid"],
  transport: ["transport", "transfer", "транспорт", "трансфер", "driver", "car", "авто"],
};
const LANG_SYNONYMS = {
  en: ["en", "eng", "англ", "english"],
  ru: ["ru", "rus", "рус", "russian"],
  uz: ["uz", "uzb", "узб", "o'z", "oz", "uzbek"],
  es: ["es", "spa", "испан", "spanish"],
  tr: ["tr", "тур", "turk", "turkish"],
};
const ALL_LANG_TOKENS = [...new Set(Object.values(LANG_SYNONYMS).flat())];

function parseQueryForProvider(q) {
  const tokens = splitTokens(q);
  if (!tokens.length) return { type_q: "", loc_q: "", lang_syn: [] };

  // языки — накапливаем все найденные синонимы
  const langSyn = [];
  for (const t of tokens) {
    for (const arr of Object.values(LANG_SYNONYMS)) {
      if (arr.includes(t)) langSyn.push(...arr);
    }
  }

  // тип — по словарю; иначе берём любой «длинный» токен
  let type_q = "";
  for (const [typ, arr] of Object.entries(TYPE_SYNONYMS)) {
    if (tokens.some((t) => arr.includes(t))) {
      type_q = typ;
      break;
    }
  }
  if (!type_q) type_q = tokens.find((t) => t.length >= 3) || tokens[0] || "";

  // локация — первый токен не из словарей
  const blacklist = new Set([...ALL_LANG_TOKENS, ...Object.values(TYPE_SYNONYMS).flat()]);
  const loc_q =
    tokens.find((t) => !blacklist.has(t) && t.length >= 3) ||
    tokens.find((t) => !blacklist.has(t)) ||
    "";

  return { type_q, loc_q, lang_syn: [...new Set(langSyn)] };
}

/* -------------------- SEARCH -------------------- */
/**
 * POST/GET /api/marketplace/search
 * Поддерживает:
 *  - q: свободный текст (искать по providers: type/location/languages)
 *  - category: фильтр по services.category (с алиасами)
 *  - sort: newest | price_asc | price_desc
 *  - only_active: true (по умолчанию)
 *  - limit/offset
 */
module.exports.search = async (req, res, next) => {
  try {
    const src = { ...(req.query || {}), ...(req.body || {}) };

    const q           = typeof src.q === "string" ? src.q.trim() : "";
    const category    = src.category ?? null;
    const only_active = String(src.only_active ?? "true").toLowerCase() !== "false";
    const sort        = src.sort ?? "newest";
    const limit       = Math.min(200, Math.max(1, parseInt(src.limit  ?? "60", 10)));
    const offset      = Math.max(0, parseInt(src.offset ?? "0", 10));

    const cats = expandCategory(category);

    // 1) Если q не пустой — найдём подходящих провайдеров
    let providerIds = null;
    if (q) {
      const { type_q, loc_q, lang_syn } = parseQueryForProvider(q);
      const provSql = `
        WITH params AS (
          SELECT $1::text AS type_q, $2::text AS loc_q, $3::text[] AS lang_syn
        )
        SELECT DISTINCT p.id
        FROM providers p
        LEFT JOIN LATERAL (
          -- разложим любое представление languages (json/jsonb/array/text) в токены
          SELECT lower(trim(both ' "[]{}' FROM t)) AS lang_token
          FROM regexp_split_to_table(p.languages::text, '[,;\\s]+') AS t
        ) l ON TRUE
        CROSS JOIN params par
        WHERE
          (p.type::text ILIKE '%' || par.type_q || '%')
          AND (
            p.location::text ILIKE '%' || par.loc_q || '%'
            OR (array_length(par.lang_syn,1) IS NOT NULL AND l.lang_token = ANY (par.lang_syn))
          )
      `;
      const { rows: provRows } = await pg.query(provSql, [type_q, loc_q, lang_syn]);
      providerIds = provRows.map((r) => r.id);
      if (!providerIds.length) return res.json({ items: [], limit, offset });
    }

    // 2) Тянем услуги, применяя фильтры: статус/активность/категория/провайдеры(если были)
    const where = [];
    const params = [];
    let p = 1;

    where.push(`s.status = 'published'`);
    if (only_active) {
      where.push(`COALESCE((s.details->>'isActive')::boolean, TRUE) = TRUE`);
      where.push(`(s.expiration_at IS NULL OR s.expiration_at > now())`);
    }

    if (cats && cats.length) {
      const ph = cats.map(() => `$${p++}`).join(",");
      params.push(...cats);
      where.push(`s.category IN (${ph})`);
    }

    if (providerIds && providerIds.length) {
      params.push(providerIds);
      where.push(`s.provider_id = ANY($${p++})`);
    }

    let orderBy = "s.created_at DESC";
    if (sort === "price_asc") orderBy = `${PRICE_SQL} ASC NULLS LAST`;
    else if (sort === "price_desc") orderBy = `${PRICE_SQL} DESC NULLS LAST`;

    params.push(limit, offset);

    const sql = `
      SELECT
        s.id, s.provider_id, s.title, s.description, s.category, s.price, s.images, s.availability,
        s.created_at, s.status, s.details, s.expiration_at,
        row_to_json(pv) AS provider
      FROM services s
      LEFT JOIN providers pv ON pv.id = s.provider_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY ${orderBy}
      LIMIT $${p++} OFFSET $${p++}
    `;

    const { rows } = await pg.query(sql, params);
    res.json({ items: rows, limit, offset });
  } catch (err) {
    next(err);
  }
};

/* -------------------- SUGGEST -------------------- */
/**
 * GET /api/marketplace/suggest?q=...&limit=8
 * Возвращает уникальные подсказки из providers.type/location/languages.
 * Без использования CASE с SRF — только UNION ALL и последующая агрегация.
 */
module.exports.suggest = async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim().toLowerCase();
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit || "8", 10)));
    if (q.length < 2) return res.json({ items: [] });

    const like = `%${q}%`;

    const sql = `
      WITH
      typ AS (
        SELECT NULLIF(trim(p.type::text),'') AS label, 100 AS w
        FROM providers p
        WHERE COALESCE(p.type::text,'') ILIKE $1
      ),
      loc AS (
        SELECT NULLIF(trim(p.location::text),'') AS label, 90 AS w
        FROM providers p
        WHERE COALESCE(p.location::text,'') ILIKE $1
      ),
      lang_tokens AS (
        -- разбиваем languages в токены (json/array/text → text)
        SELECT NULLIF(trim(both ' "[]{}' FROM t),'') AS label, 80 AS w
        FROM providers p,
             regexp_split_to_table(p.languages::text, '[,;\\s]+') AS t
        WHERE t ILIKE $1
      )
      SELECT label
      FROM (
        SELECT * FROM typ
        UNION ALL
        SELECT * FROM loc
        UNION ALL
        SELECT * FROM lang_tokens
      ) x
      WHERE label <> ''
      GROUP BY label
      ORDER BY MAX(w) DESC, label ASC
      LIMIT $2
    `;

    const { rows } = await pg.query(sql, [like, limit]);
    res.json({ items: rows.map(r => r.label) });
  } catch (err) {
    next(err);
  }
};
