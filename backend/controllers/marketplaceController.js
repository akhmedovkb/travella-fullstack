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

// === SEARCH (исправлено: поддержка категории и пустого q) ===

const PRICE_SQL = `COALESCE(NULLIF(s.details->>'netPrice','')::numeric, s.price)`;

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
const expandCategory = (cat) => (cat ? (CATEGORY_ALIAS[String(cat).trim()] || [String(cat).trim()]) : null);

function splitTokens(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

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

  const langSyn = [];
  for (const t of tokens) {
    for (const arr of Object.values(LANG_SYNONYMS)) {
      if (arr.includes(t)) langSyn.push(...arr);
    }
  }

  let type_q = "";
  for (const [typ, arr] of Object.entries(TYPE_SYNONYMS)) {
    if (tokens.some((t) => arr.includes(t))) { type_q = typ; break; }
  }
  if (!type_q) type_q = tokens.find((t) => t.length >= 3) || tokens[0] || "";

  const blacklist = new Set([...ALL_LANG_TOKENS, ...Object.values(TYPE_SYNONYMS).flat()]);
  const loc_q =
    tokens.find((t) => !blacklist.has(t) && t.length >= 3) ||
    tokens.find((t) => !blacklist.has(t)) ||
    "";

  return { type_q, loc_q, lang_syn: [...new Set(langSyn)] };
}

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

    // --- 1) Если есть q — находим подходящих провайдеров. Если q пусто — НЕ фильтруем по провайдеру.
    let providerIds = null;
    if (q) {
      const { type_q, loc_q, lang_syn } = parseQueryForProvider(q);
      const provSql = `
        WITH params AS (
          SELECT
            $1::text    AS type_q,
            $2::text    AS loc_q,
            $3::text[]  AS lang_syn
        )
        SELECT DISTINCT p.id
        FROM providers p
        LEFT JOIN LATERAL (
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
      providerIds = provRows.map(r => r.id);
      if (!providerIds.length) return res.json({ items: [], limit, offset });
    }

    // --- 2) Тянем услуги с опциональными фильтрами: статус/активность/категория/провайдеры
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
