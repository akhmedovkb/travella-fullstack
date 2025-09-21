//backend/controllers/providerServicesController.js - файл для услуг поставищика для tourbuilder

const pool = require("../db");

// транспортные категории — только для них разрешаем seats
const TRANSPORT_ALLOWED = new Set([
  "city_tour_transport",
  "mountain_tour_transport",
  "one_way_transfer",
  "dinner_transfer",
  "border_transfer",
]);

const normStr = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
};
const normCurrency = (v, def = "USD") => {
  const s = String(v || def).toUpperCase();
  return ["USD", "UZS", "EUR"].includes(s) ? s : def;
};
const normPrice = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Number(n.toFixed(2)) : 0;
};

// безопасно нормализуем details + seats
function normDetails(input, category) {
  let obj = {};
  if (input && typeof input === "object") obj = { ...input };

  if (Object.prototype.hasOwnProperty.call(obj, "seats")) {
    const n = Number(obj.seats);
    if (
      Number.isFinite(n) &&
      n > 0 &&
      Number.isInteger(n) &&
      TRANSPORT_ALLOWED.has(String(category))
    ) {
      obj.seats = n;
    } else {
      delete obj.seats; // невалидно или не транспорт — выбрасываем
    }
  }
  return obj;
}

/** GET /api/providers/:providerId/services */
async function listProviderServices(req, res) {
  try {
    const providerId = Number(req.params.providerId);
    if (!Number.isFinite(providerId))
      return res.status(400).json({ message: "Bad providerId" });

    const q = await pool.query(
      `SELECT id, provider_id, category, title, price, currency, is_active, details
         FROM provider_services
        WHERE provider_id = $1
        ORDER BY id DESC`,
      [providerId]
    );
    res.json(q.rows); // важно: здесь уже уходит details -> фронт увидит seats
  } catch (err) {
    console.error("listProviderServices:", err);
    res.status(500).json({ message: "Server error" });
  }
}

/** POST /api/providers/:providerId/services */
async function createProviderService(req, res) {
  try {
    const providerId = Number(req.params.providerId);
    if (!Number.isFinite(providerId))
      return res.status(400).json({ message: "Bad providerId" });

    const { category, title, price, currency, is_active = true, details } =
      req.body || {};
    if (!category) return res.status(400).json({ message: "category is required" });

    const titleStr = normStr(title);
    const priceNum = normPrice(price);
    const curr = normCurrency(currency);
    const detailsObj = normDetails(details, category);

    const ins = await pool.query(
      `INSERT INTO provider_services (provider_id, category, title, price, currency, is_active, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       RETURNING id, provider_id, category, title, price, currency, is_active, details`,
      [providerId, category, titleStr, priceNum, curr, !!is_active, JSON.stringify(detailsObj)]
    );

    res.status(201).json(ins.rows[0]);
  } catch (err) {
    console.error("createProviderService:", err);
    res.status(500).json({ message: "Server error" });
  }
}

/** PATCH /api/providers/:providerId/services/:id */
async function patchProviderService(req, res) {
  try {
    const providerId = Number(req.params.providerId);
    const id = Number(req.params.id);
    if (!Number.isFinite(providerId) || !Number.isFinite(id))
      return res.status(400).json({ message: "Bad ids" });

    const cur = await pool.query(
      `SELECT id, provider_id, category, title, price, currency, is_active, details
         FROM provider_services
        WHERE id=$1 AND provider_id=$2`,
      [id, providerId]
    );
    if (!cur.rowCount) return res.status(404).json({ message: "Service not found" });
    const row = cur.rows[0];

    const patch = req.body || {};
    const next = {
      category: normStr(patch.category) || row.category,
      title: patch.hasOwnProperty("title") ? normStr(patch.title) : row.title,
      price: patch.hasOwnProperty("price") ? normPrice(patch.price) : row.price,
      currency: patch.hasOwnProperty("currency")
        ? normCurrency(patch.currency, row.currency)
        : row.currency,
      is_active: patch.hasOwnProperty("is_active") ? !!patch.is_active : row.is_active,
      details: row.details || {},
    };

    if (patch.details && typeof patch.details === "object") {
      next.details = normDetails({ ...(row.details || {}), ...patch.details }, next.category);
    } else if (patch.hasOwnProperty("details")) {
      next.details = normDetails(patch.details || {}, next.category);
    }

    const upd = await pool.query(
      `UPDATE provider_services
          SET category=$1, title=$2, price=$3, currency=$4, is_active=$5, details=$6::jsonb, updated_at=NOW()
        WHERE id=$7 AND provider_id=$8
        RETURNING id, provider_id, category, title, price, currency, is_active, details`,
      [
        next.category,
        next.title,
        next.price,
        next.currency,
        next.is_active,
        JSON.stringify(next.details || {}),
        id,
        providerId,
      ]
    );

    res.json(upd.rows[0]);
  } catch (err) {
    console.error("patchProviderService:", err);
    res.status(500).json({ message: "Server error" });
  }
}

module.exports = {
  listProviderServices,
  createProviderService,
  patchProviderService,
};
