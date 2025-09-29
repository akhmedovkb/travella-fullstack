// backend/controllers/marketplaceController.js
const db = require("../db");
const pg = db?.query ? db : db?.pool;

if (!pg || typeof pg.query !== "function") {
  throw new Error("DB driver not available: expected node-postgres Pool with .query()");
}

// ====== TRACE HELPERS ======
const { performance } = require("perf_hooks");

function mkTracer(req, tag = "MP") {
  // включать: env MP_DEBUG=1 | query ?debug=1 | header x-mp-debug:1
  const enable =
    String(process.env.MP_DEBUG || "").toLowerCase() === "1" ||
    String(req?.query?.debug || "").toLowerCase() === "1" ||
    String(req?.headers?.["x-mp-debug"] || "").toLowerCase() === "1";

  const t0 = performance.now();
  const rid = Math.random().toString(36).slice(2, 8);

  const stamp = (label = "") =>
    `[${tag}#${rid}${label ? " " + label : ""}] +${(performance.now() - t0).toFixed(1)}ms`;

  const sanitizeParam = (v) => {
    if (v == null) return v;
    if (typeof v === "string") {
      const s = v.length > 200 ? v.slice(0, 200) + "…(trunc)" : v;
      return s.replace(/\s+/g, " ");
    }
    if (Array.isArray(v)) return v.map(sanitizeParam);
    if (typeof v === "object") {
      try { return JSON.parse(JSON.stringify(v)); } catch { return "[Object]"; }
    }
    return v;
  };

  const log = (...args) => { if (enable) console.log(stamp(), ...args); };
  const logSQL = (title, sql, params) => {
    if (!enable) return;
    const oneLine = String(sql || "").replace(/\s+/g, " ").trim();
    console.log(stamp(title), oneLine.length > 1000 ? oneLine.slice(0, 1000) + "…(trunc)" : oneLine);
    if (params) console.log(stamp(title + " params"), sanitizeParam(params));
  };

  const wrapQuery = async (sql, params, title = "SQL") => {
    logSQL(title, sql, params);
    const t1 = performance.now();
    try {
      const res = await pg.query(sql, params);
      log(`${title} ok`, `rows=${res?.rowCount ?? res?.rows?.length ?? 0}`, `dt=${(performance.now()-t1).toFixed(1)}ms`);
      return res;
    } catch (e) {
      console.error(stamp(title + " ERR"), e?.message || e);
      throw e;
    }
  };

  const done = (label = "done") => log(label);

  // ВАЖНО: эти заголовки будут видны в Network → Response Headers
  const attach = (res) => {
    if (!res?.set) return;
    res.set("x-mp-rid", rid);
    if (enable) res.set("x-mp-debug", "1");
  };

  return { enable, log, logSQL, wrapQuery, done, rid, attach };
}
// ====== /TRACE HELPERS ======


/* -------------------- константы/хелперы -------------------- */
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

// ---- нормализация/транслит и паттерны LIKE ----
const _norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
function _cyr2lat(s) {
  return _norm(s)
    .replace(/shch/g, "shch").replace(/щ/g, "shch")
    .replace(/ш/g, "sh").replace(/ч/g, "ch").replace(/ж/g, "zh")
    .replace(/ю/g, "yu").replace(/я/g, "ya").replace(/й/g, "y").replace(/ё/g, "e")
    .replace(/ъ|’|ʻ|`/g, "").replace(/ь/g, "")
    .replace(/х/g, "kh").replace(/ц/g, "ts")
    .replace(/қ/g, "q").replace(/ғ/g, "g'").replace(/ў/g, "o'").replace(/ҳ/g, "h")
    .replace(/а/g, "a").replace(/б/g, "b").replace(/в/g, "v").replace(/г/g, "g")
    .replace(/д/g, "d").replace(/е/g, "e").replace(/з/g, "z").replace(/и/g, "i")
    .replace(/к/g, "k").replace(/л/g, "l").replace(/м/g, "m").replace(/н/g, "n")
    .replace(/о/g, "o").replace(/п/g, "p").replace(/р/g, "r").replace(/с/g, "s")
    .replace(/т/g, "t").replace(/у/g, "u").replace(/ф/g, "f").replace(/ы/g, "y");
}
function _lat2cyr(s) {
  let x = _norm(s)
    .replace(/shch/g, "щ").replace(/sch/g, "щ")
    .replace(/sh/g, "ш").replace(/ch/g, "ч").replace(/zh/g, "ж")
    .replace(/ya/g, "я").replace(/yu/g, "ю").replace(/yo/g, "ё")
    .replace(/kh/g, "х").replace(/ts/g, "ц");
  x = x.replace(/g'|gʼ|g‘/g, "ғ").replace(/o'|oʼ|o‘/g, "ў");
  x = x.replace(/q/g, "қ").replace(/x/g, "х").replace(/h/g, "ҳ");
  x = x
    .replace(/a/g, "а").replace(/b/g, "б").replace(/v/g, "в").replace(/g/g, "г")
    .replace(/d/g, "д").replace(/e/g, "е").replace(/z/g, "з").replace(/i/g, "и")
    .replace(/j/g, "й").replace(/k/g, "к").replace(/l/g, "л").replace(/m/g, "м")
    .replace(/n/g, "н").replace(/o/g, "о").replace(/p/g, "п").replace(/r/g, "р")
    .replace(/s/g, "с").replace(/t/g, "т").replace(/u/g, "у").replace(/f/g, "ф")
    .replace(/y/g, "ы").replace(/c/g, "к").replace(/w/g, "в");
  return x;
}
function makeLikePatterns(input) {
  const s = _norm(input);
  if (!s) return [];
  const parts = s.split(/[,\s]+/).filter(Boolean);
  const set = new Set();
  for (const t of parts) {
    const a = _norm(t);
    const b = _cyr2lat(a);
    const c = _lat2cyr(a);
    [a, b, c].forEach((v) => v && v.length >= 2 && set.add(`%${v}%`));
    if (a.includes("samarkand")) set.add("%samarqand%");
    if (a.includes("samarqand")) set.add("%samarkand%");
  }
  return Array.from(set);
}

function parseQueryForProvider(q) {
  const tokens = splitTokens(q);
  if (!tokens.length) return { type_q: null, loc_q: "", lang_syn: [] };

  const langSyn = [];
  for (const t of tokens) for (const arr of Object.values(LANG_SYNONYMS)) if (arr.includes(t)) langSyn.push(...arr);

  let type_q = null;
  for (const [typ, arr] of Object.entries(TYPE_SYNONYMS)) {
    if (tokens.some((t) => arr.includes(t))) { type_q = typ; break; }
  }

  const blacklist = new Set([...ALL_LANG_TOKENS, ...Object.values(TYPE_SYNONYMS).flat()]);
  const loc_q =
    tokens.find((t) => !blacklist.has(t) && t.length >= 3) ||
    tokens.find((t) => !blacklist.has(t)) || "";

  return { type_q, loc_q, lang_syn: [...new Set(langSyn)] };
}

/* -------------------- SEARCH -------------------- */
module.exports.search = async (req, res, next) => {
  try {
    const tr = mkTracer(req, "MP:search");
    tr.attach(res); // заголовки для Network

    const src = { ...(req.query || {}), ...(req.body || {}) };
    tr.log("incoming src", { q: src.q, category: src.category, sort: src.sort, only_active: src.only_active, limit: src.limit, offset: src.offset });

    const q           = typeof src.q === "string" ? src.q.trim() : "";
    const category    = src.category ?? null;
    const only_active = String(src.only_active ?? "true").toLowerCase() !== "false";
    const sort        = src.sort ?? "newest";
    const limit       = Math.min(200, Math.max(1, parseInt(src.limit  ?? "60", 10)));
    const offset      = Math.max(0, parseInt(src.offset ?? "0", 10));

    const cats = expandCategory(category);
    tr.log("filters", { q, category, cats, only_active, sort, limit, offset });

    // --- провайдеры
    let providerIds = null;
    let textPatterns = [];

    if (q) {
      const parsed = parseQueryForProvider(q);
      tr.log("parsed", parsed);
      const locPatterns = makeLikePatterns(parsed.loc_q);
      textPatterns = makeLikePatterns(q);
      tr.log("patterns", { locPatterns, textPatternsLen: textPatterns.length });

      const nothingToFilter = !parsed.type_q && locPatterns.length === 0 && parsed.lang_syn.length === 0;
      if (!nothingToFilter) {
        const provSql = `
          WITH params AS (
            SELECT $1::text AS type_q, $2::text[] AS loc_patterns, $3::text[] AS lang_syn
          )
          SELECT DISTINCT p.id
          FROM providers p
          LEFT JOIN LATERAL (
            SELECT lower(trim(both ' "[]{}' FROM t)) AS lang_token
            FROM regexp_split_to_table(p.languages::text, '[,;\\s]+') AS t
          ) l ON TRUE
          CROSS JOIN params par
          WHERE
            (par.type_q IS NULL OR p.type::text ILIKE '%' || par.type_q || '%')
            AND (
              (COALESCE(array_length(par.loc_patterns,1),0) > 0 AND p.location::text ILIKE ANY(par.loc_patterns))
              OR (COALESCE(array_length(par.lang_syn,1),0) > 0 AND l.lang_token = ANY (par.lang_syn))
            )
        `;
        const r = await tr.wrapQuery(provSql, [parsed.type_q, locPatterns, parsed.lang_syn], "prov");
        providerIds = r.rows.map((x) => x.id);
        tr.log("providerIds", { count: providerIds.length, sample: providerIds.slice(0, 10) });
      } else {
        tr.log("provider filter skipped (nothingToFilter)");
      }
    }

    // --- where для services
    const where = [];
    const params = [];
    let p = 1;

    where.push(`(s.status IS NULL OR lower(s.status) IN ('published','active','approved'))`);
    if (only_active) {
      where.push(`COALESCE((s.details->>'isActive')::boolean, TRUE) = TRUE`);
      where.push(`(s.expiration_at IS NULL OR s.expiration_at > now())`);
    }

    if (cats && cats.length) {
      const ph = cats.map(() => `$${p++}`).join(",");
      params.push(...cats);
      where.push(`s.category IN (${ph})`);
    }

    if (Array.isArray(providerIds) && providerIds.length > 0) {
      params.push(providerIds);
      where.push(`s.provider_id = ANY($${p++})`);
    }

    // Фоллбек по тексту, если провайдеров не нашли/фильтр пуст
    if (q && (!providerIds || providerIds.length === 0) && textPatterns.length > 0) {
      params.push(textPatterns);
      const ph = `$${p++}`;
      where.push(`(
        s.title ILIKE ANY(${ph})
        OR s.description ILIKE ANY(${ph})
        OR s.details::text ILIKE ANY(${ph})
        OR EXISTS (
         SELECT 1 FROM providers pp
         WHERE pp.id = s.provider_id
           AND (
             pp.name ILIKE ANY(${ph})
             OR pp.type::text ILIKE ANY(${ph})
             OR pp.location::text ILIKE ANY(${ph})
           )
       )
      )`);
      tr.log("fallback text filter enabled", { patterns: textPatterns.length });
    }

    let orderBy = "s.created_at DESC";
    if (sort === "price_asc")  orderBy = `${PRICE_SQL} ASC NULLS LAST`;
    if (sort === "price_desc") orderBy = `${PRICE_SQL} DESC NULLS LAST`;

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

    tr.log("where", where);
    const { rows } = await tr.wrapQuery(sql, params, "services");
    tr.log("result", { rows: rows.length });
    tr.done();

    return res.json({ items: rows, limit, offset });
  } catch (err) {
    console.error("[MP:search ERR]", err?.message || err);
    next(err);
  }
};

/* -------------------- SUGGEST -------------------- */
module.exports.suggest = async (req, res, next) => {
  try {
    const tr = mkTracer(req, "MP:suggest");
    tr.attach(res); // заголовки для Network

    const q = String(req.query.q || "").trim().toLowerCase();
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit || "8", 10)));
    tr.log("incoming", { q, limit });

    if (q.length < 2) { tr.log("short q — skip"); return res.json({ items: [] }); }

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
        FROM providers p, regexp_split_to_table(p.languages::text, '[,;\\s]+') AS t
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
    const { rows } = await tr.wrapQuery(sql, [like, limit], "suggest");
    tr.log("result", rows.length);
    tr.done();
    res.json({ items: rows.map(r => r.label) });
  } catch (err) {
    console.error("[MP:suggest ERR]", err?.message || err);
    next(err);
  }
};
