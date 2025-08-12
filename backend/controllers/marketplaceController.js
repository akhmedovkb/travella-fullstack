// controllers/marketplaceController.js
// CommonJS, работает с уже настроенным knex из ../db

const dbModule = require("../db");
const db = dbModule?.knex || dbModule;
if (typeof db !== "function") {
  throw new Error("Knex instance not found in ../db");
}

// Цена: сначала details.netPrice (если есть), иначе services.price
const PRICE_SQL = `COALESCE(NULLIF(details->>'netPrice','')::numeric, price)`;

// сопоставление «крупных» категорий из UI -> реальные категории в таблице services.category
const CAT_MAP = {
  guide: [
    "city_tour_guide",
    "mountain_tour_guide"
  ],
  transport: [
    "city_tour_transport",
    "mountain_tour_transport",
    "one_way_transfer",
    "dinner_transfer",
    "border_transfer",
    "hotel_transfer"
  ],
  refused_tour: ["refused_tour", "author_tour"], // авторские туры сюда тоже
  refused_hotel: ["refused_hotel"],
  refused_flight: ["refused_flight"],
  refused_event_ticket: ["refused_event_ticket"],
  visa_support: ["visa_support"]
};

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

module.exports.search = async (req, res, next) => {
  try {
    const {
      q,                // текстовый поиск
      location,         // город/локация из инпута «Внесите локацию…»
      category,         // ключ из селекта
      price_min,
      price_max,
      sort = "newest",
      limit = 60,
      offset = 0,
      only_active = true
    } = req.body || {};

    const lim = Math.min(200, Math.max(1, Number(limit) || 60));
    const off = Math.max(0, Number(offset) || 0);

    const rowsQ = db("services")
      .select([
        "id",
        "provider_id",
        "title",
        "description",
        "category",
        "price",
        "images",
        "availability",
        "created_at",
        "status",
        "details",
        "expiration_at",
      ])
      .modify((qb) => {
        if (only_active) {
          // 1) активные по флагу в JSONB
          qb.andWhereRaw(`COALESCE((details->>'isActive')::boolean, true) = true`);
          // 2) не истёкшие по колонке expiration_at
          qb.andWhere((q2) => {
            q2.whereNull("expiration_at").orWhere("expiration_at", ">", db.fn.now());
          });
        }
      })
      // Категория из селекта
      .modify((qb) => {
        if (!category) return;
        const mapped = CAT_MAP[category];
        if (Array.isArray(mapped)) qb.whereIn("category", mapped);
        else qb.andWhere("category", String(category));
      })
      // Локация: direction_to / directionTo / location / direction
      .modify((qb) => {
        const loc = (location || "").trim();
        if (!loc) return;
        const like = `%${loc}%`;
        qb.andWhere((sub) => {
          sub
            .orWhereRaw(`details->>'direction_to' ILIKE ?`, [like])
            .orWhereRaw(`details->>'directionTo' ILIKE ?`, [like])
            .orWhereRaw(`details->>'location' ILIKE ?`, [like])
            .orWhereRaw(`details->>'direction' ILIKE ?`, [like]);
        });
      })
      // Текстовый q — по title/description/details::text
      .modify((qb) => {
        const text = (q || "").trim();
        if (!text) return;
        const like = `%${text}%`;
        qb.andWhere((sub) => {
          sub
            .orWhere("title", "ilike", like)
            .orWhere("description", "ilike", like)
            .orWhereRaw(`details::text ILIKE ?`, [like]);
        });
      })
      // Диапазон цены (нетто/price)
      .modify((qb) => {
        const pmin = toNum(price_min);
        const pmax = toNum(price_max);
        if (pmin != null) qb.andWhereRaw(`${PRICE_SQL} >= ?`, [pmin]);
        if (pmax != null) qb.andWhereRaw(`${PRICE_SQL} <= ?`, [pmax]);
      })
      // Сортировка
      .modify((qb) => {
        switch (sort) {
          case "price_asc":
            qb.orderByRaw(`${PRICE_SQL} asc nulls last`);
            break;
          case "price_desc":
            qb.orderByRaw(`${PRICE_SQL} desc nulls last`);
            break;
          case "newest":
          default:
            qb.orderBy("created_at", "desc");
        }
      })
      .limit(lim)
      .offset(off);

    const items = await rowsQ;
    res.json({ items, limit: lim, offset: off });
  } catch (err) {
    next(err);
  }
};
