//backend/controllers/providerServicesController.js - файл для услуг поставищика для tourbuilder

const pool = require("../db");
const { TRANSPORT_SERVICE_CATEGORY_SET: TRANSPORT_ALLOWED } = require("../utils/providerServiceCatalog");
const { addServiceCity, slugifyCity } = require("../utils/cities");
const VEHICLE_INCLUDED_GUIDE_CATEGORIES = new Set(["city_tour_guide_with_transport"]);

// транспортные категории — только для них разрешаем seats

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
      (TRANSPORT_ALLOWED.has(String(category)) || VEHICLE_INCLUDED_GUIDE_CATEGORIES.has(String(category)))
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
           `SELECT id, provider_id, category, title, price, currency, is_active,
              COALESCE(details, '{}'::jsonb) AS details
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
  let client;
  try {
    const providerId = Number(req.params.providerId);
    if (!Number.isFinite(providerId))
      return res.status(400).json({ message: "Bad providerId" });
    if (Number(req.user?.id) !== providerId && !req.user?.is_admin)
      return res.status(403).json({ message: "Forbidden" });

    const { category, title, price, currency, is_active = true, details } =
      req.body || {};
    if (!category) return res.status(400).json({ message: "category is required" });

    const titleStr = normStr(title);
    const priceNum = normPrice(price);
    const curr = normCurrency(currency);
    const detailsObj = normDetails(details, category);
    const destinationCity = normStr(detailsObj.destination_city);
    const destinationSlug = slugifyCity(destinationCity);

    client = await pool.connect();
    await client.query("BEGIN");

    if (destinationSlug) {
      const profileQ = await client.query(
        `SELECT location, city_slugs FROM providers WHERE id = $1 FOR UPDATE`,
        [providerId]
      );
      if (!profileQ.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Provider not found" });
      }

      const mergedCities = addServiceCity(profileQ.rows[0].location, profileQ.rows[0].city_slugs, destinationCity);

      await client.query(
        `UPDATE providers SET location = $1::text[], city_slugs = $2::text[], updated_at = NOW() WHERE id = $3`,
        [mergedCities.location, mergedCities.city_slugs, providerId]
      );
    }

    const ins = await client.query(
      `INSERT INTO provider_services (provider_id, category, title, price, currency, is_active, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
       RETURNING id, provider_id, category, title, price, currency, is_active, details`,
      [providerId, category, titleStr, priceNum, curr, !!is_active, JSON.stringify(detailsObj)]
    );

    await client.query("COMMIT");
    res.status(201).json(ins.rows[0]);
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error("createProviderService:", err);
    res.status(500).json({ message: "Server error" });
  } finally {
    client?.release();
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
