// backend/controllers/marketplaceController.js

const db = require("../db");
const pg = db?.query ? db : db?.pool;

if (!pg || typeof pg.query !== "function") {
  throw new Error("DB driver not available: expected node-postgres Pool with .query()");
}

const PRICE_SQL = `COALESCE(NULLIF(s.details->>'netPrice','')::numeric, s.price)`;

// ===== helpers =====
function splitTokens(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

// ключевые слова типов
const TYPE_SYNONYMS = {
  guide: ["guide", "гид", "ekskursiya", "экскурсия", "экскурсовод", "gid"],
  transport: ["transport", "transfer", "транспорт", "трансфер", "driver", "car", "авто"],
};

// словарь языков → синонимы для поиска
const LANG_SYNONYMS = {
  en: ["en", "eng", "англ", "english"],
  ru: ["ru", "rus", "рус", "russian"],
  uz: ["uz", "uzb", "узб", "o'z", "oz", "uzbek"],
  es: ["es", "spa", "испан", "spanish"],
  tr: ["tr", "тур", "turk", "turkish"],
};
const ALL_LANG_TOKENS = [...new Set(Object.values(LANG_SYNONYMS).flat())];

// извлекаем из q 3 вещи: type_q, loc_q, lang_syn[]
function parseQueryForProvider(q) {
  const tokens = splitTokens(q);
  if (!tokens.length) return { type_q: "", loc_q: "", lang_syn: [] };

  // 1) язык — любое совпадение из словаря
  const langSyn = [];
  for (const t of tokens) {
    for (const arr of Object.values(LANG_SYNONYMS)) {
      if (arr.includes(t)) langSyn.push(...arr);
    }
  }

  // 2) тип — если встречается слово из TYPE_SYNONYMS.guide — считаем type_q="guide", и т.п.
  let type_q = "";
  for (const [typ, arr] of Object.entries(TYPE_SYNONYMS)) {
    if (tokens.some((t) => arr.includes(t))) {
      type_q = typ; // в БД у вас type хранится как "guide"/"agent"/...
      break;
    }
  }
  // по умолчанию оставим то, что написал пользователь (часть слова)
  if (!type_q) {
    // если юзер написал "гид", это всё равно отловим в loc/type через ILIKE
    type_q = tokens.find((t) => t.length >= 3) || tokens[0] || "";
  }

  // 3) локация — возьмём самый «городоподобный» токен (не язык и не тип)
  const blacklist = new Set([...ALL_LANG_TOKENS, ...Object.values(TYPE_SYNONYMS).flat()]);
  const loc_q =
    tokens.find((t) => !blacklist.has(t) && t.length >= 3) ||
    tokens.find((t) => !blacklist.has(t)) ||
    "";

  return { type_q, loc_q, lang_syn: [...new Set(langSyn)] };
}

/* ======================= SEARCH ======================= */
module.exports.search = async (req, res, next) => {
  try {
    const src = { ...(req.query || {}), ...(req.body || {}) };

    const q = typeof src.q === "string" ? src.q.trim() : "";
    const { type_q, loc_q, lang_syn } = parseQueryForProvider(q);

    const only_active = String(src.only_active ?? "true").toLowerCase() !== "false";
    const sort = src.sort ?? "newest";
    const limit = Math.min(200, Math.max(1, parseInt(src.limit ?? "60", 10)));
    const offset = Math.max(0, parseInt(src.offset ?? "0", 10));

    // 1) Находим подходящих провайдеров (ровно как в вашей рабочей SQL)
    const provSql = `
      WITH params AS (
        SELECT
          $1::text  AS type_q,
          $2::text  AS loc_q,
          $3::text[] AS lang_syn
      )
      SELECT DISTINCT p.id
      FROM providers p
      LEFT JOIN LATERAL (
        SELECT lower(trim(both ' "[]{}' FROM t)) AS lang_token
        FROM regexp_split_to_table(p.languages::text, '[,;\\s]+') AS t
      ) l ON TRUE
      CROSS JOIN params par
      WHERE
        (p.type::text ILIKE '%' || par.type_q || '%')                        -- тип
        AND (
          p.location::text ILIKE '%' || par.loc_q || '%'                     -- локация
          OR (par.lang_syn IS NOT NULL AND array_length(par.lang_syn,1) IS NOT NULL
              AND l.lang_token = ANY (par.lang_syn) )                        -- язык
        )
    `;
    const { rows: provRows } = await pg.query(provSql, [type_q, loc_q, lang_syn]);
    const providerIds = provRows.map((r) => r.id);

    if (!providerIds.length) return res.json({ items: [], limit, offset });

    // 2) Тянем услуги этих провайдеров
    const where = [
      `s.status = 'published'`,
      only_active ? `COALESCE((s.details->>'isActive')::boolean, TRUE) = TRUE` : `TRUE`,
      only_active ? `(s.expiration_at IS NULL OR s.expiration_at > now())` : `TRUE`,
      `s.provider_id = ANY($1)`,
    ].filter(Boolean);

    let orderBy = "s.created_at DESC";
    switch (sort) {
      case "price_asc":
        orderBy = `${PRICE_SQL} ASC NULLS LAST`;
        break;
      case "price_desc":
        orderBy = `${PRICE_SQL} DESC NULLS LAST`;
        break;
      default:
        orderBy = "s.created_at DESC";
    }

    const svcSql = `
      SELECT
        s.id, s.provider_id, s.title, s.description, s.category, s.price, s.images, s.availability,
        s.created_at, s.status, s.details, s.expiration_at,
        row_to_json(p) AS provider
      FROM services s
      JOIN providers p ON p.id = s.provider_id
      WHERE ${where.join(" AND ")}
      ORDER BY ${orderBy}
      LIMIT $2 OFFSET $3
    `;
    const { rows } = await pg.query(svcSql, [providerIds, limit, offset]);

    res.json({ items: rows, limit, offset });
  } catch (err) {
    next(err);
  }
};

/* ======================= SUGGEST ======================= */
/* Подсказки: отдаём уникальные label’ы из providers.type/location/languages */
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
    res.json({ items: rows.map((r) => r.label) });
  } catch (err) {
    next(err);
  }
};
