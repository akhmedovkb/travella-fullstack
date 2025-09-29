// backend/controllers/marketplaceController.js

const db = require("../db");
const pg = db?.query ? db : db?.pool;

if (!pg || typeof pg.query !== "function") {
  throw new Error("DB driver not available: expected node-postgres Pool with .query()");
}

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
  package: ["refused_tour", "author_tour"],
};
const expandCategory = (cat) => (cat ? (CATEGORY_ALIAS[String(cat).trim()] || [String(cat).trim()]) : null);
const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : undefined);

/* ------------------------------------------------------------------ */
/* SEARCH: ищем по providers (type/location/languages) -> provider_ids */
/* затем подтягиваем услуги этих провайдеров                           */
/* ------------------------------------------------------------------ */
module.exports.search = async (req, res, next) => {
  try {
    const src = { ...(req.query || {}), ...(req.body || {}) };

    const q           = typeof src.q === "string" ? src.q.trim() : "";
    const category    = src.category ?? null;
    const sort        = src.sort ?? null;
    const only_active = String(src.only_active ?? "true").toLowerCase() !== "false";

    const limit  = Math.min(200, Math.max(1, parseInt(src.limit  ?? "60", 10)));
    const offset = Math.max(0, parseInt(src.offset ?? "0", 10));
    const cats   = expandCategory(category);

    /* 1) Разбиваем запрос на токены и ищем подходящих провайдеров */
    const tokens = q.split(/\s+/).map(s => s.trim()).filter(Boolean);

    let providerIds = null;
    if (tokens.length) {
      const conds = [];
      const params = [];
      let p = 1;

      // Для каждого слова требуется совпадение в ЛЮБОМ из полей провайдера
      for (const t of tokens) {
        const like = `%${t}%`;
        params.push(like, like, like);
        const c1 = `$${p++}`, c2 = `$${p++}`, c3 = `$${p++}`;

        // languages может быть array/jsonb — приводим к text.
        conds.push(`(
          COALESCE(p.type::text,'') ILIKE ${c1}
          OR COALESCE(p.location::text,'') ILIKE ${c2}
          OR COALESCE(p.languages::text,'') ILIKE ${c3}
        )`);
      }

      const provSql = `
        SELECT p.id
        FROM providers p
        WHERE ${conds.join(" AND ")}
      `;
      const { rows } = await pg.query(provSql, params);
      providerIds = rows.map(r => r.id);
      if (!providerIds.length) {
        return res.json({ items: [], limit, offset });
      }
    }

    /* 2) Тянем услуги выбранных провайдеров */
    const where = [];
    const params = [];
    let p = 1;

    // только опубликованные
    params.push("published");
    where.push(`s.status = $${p++}`);

    if (only_active) {
      where.push(`COALESCE((s.details->>'isActive')::boolean, true) = true`);
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

    // сортировка
    let orderBy = "s.created_at DESC";
    switch (sort) {
      case "newest":     orderBy = "s.created_at DESC"; break;
      case "price_asc":  orderBy = `${PRICE_SQL} ASC NULLS LAST`; break;
      case "price_desc": orderBy = `${PRICE_SQL} DESC NULLS LAST`; break;
    }

    params.push(limit, offset);

    const sql = `
      SELECT
        s.id, s.provider_id, s.title, s.description, s.category, s.price, s.images, s.availability,
        s.created_at, s.status, s.details, s.expiration_at,
        row_to_json(p) AS provider
      FROM services s
      LEFT JOIN providers p ON p.id = s.provider_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY ${orderBy}
      LIMIT $${p++} OFFSET $${p++}
    `;

    const { rows } = await pg.query(sql, params);
    return res.json({ items: rows, limit, offset });
  } catch (err) {
    next(err);
  }
};

// --- SUGGEST: подсказки из providers (type/location/languages) ---
module.exports.suggest = async (req, res, next) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit || "8", 10)));
    if (q.length < 2) return res.json({ items: [] });

    const like = `%${q}%`;

    const { rows } = await pg.query(
      `
      WITH cand AS (
        -- тип провайдера
        SELECT NULLIF(TRIM(p.type::text), '')       AS label, 100 AS w
        FROM providers p
        WHERE COALESCE(p.type::text,'') ILIKE $1

        UNION ALL
        -- локация провайдера
        SELECT NULLIF(TRIM(p.location::text), '')   AS label, 90  AS w
        FROM providers p
        WHERE COALESCE(p.location::text,'') ILIKE $1

        UNION ALL
        -- языки: режем любую форму (text/json/array) как текст на токены
        SELECT NULLIF(TRIM(BOTH ' "[]{}' FROM lang), '') AS label, 80 AS w
        FROM providers p
        CROSS JOIN LATERAL regexp_split_to_table(p.languages::text, '[,;\\s]+') AS lang
        WHERE COALESCE(lang,'') <> '' AND lang ILIKE $1
      ),
      norm AS (
        SELECT LOWER(label) AS key, MIN(label) AS label, MAX(w) AS w
        FROM cand
        WHERE label IS NOT NULL
        GROUP BY LOWER(label)
      )
      SELECT label
      FROM norm
      ORDER BY w DESC, label ASC
      LIMIT $2
      `,
      [like, limit]
    );

    res.json({ items: rows.map(r => r.label) });
  } catch (err) {
    next(err);
  }
};
