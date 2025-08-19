// backend/controllers/providerController.js
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

// ---------- Helpers ----------
const EXT_CATS = new Set([
  "refused_tour",
  "author_tour",
  "refused_hotel",
  "refused_flight",
  "refused_event_ticket",
  "visa_support",
]);
const isExtendedCategory = (cat) => EXT_CATS.has(String(cat || ""));

function toArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try { const arr = JSON.parse(val); return Array.isArray(arr) ? arr : []; }
    catch (err) { return []; }
  }
  return [];
}

function sanitizeImages(images) {
  const arr = toArray(images);
  return arr
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeServicePayload(body) {
  const { title, description, price, category, images, availability, details } = body || {};

  const imagesArr = sanitizeImages(images);
  const availabilityArr = Array.isArray(availability) ? availability : toArray(availability);

  let detailsObj = null;
  if (details) {
    if (typeof details === "string") {
      try { detailsObj = JSON.parse(details); }
      catch (err) { detailsObj = { value: String(details) }; }
    } else if (typeof details === "object") {
      detailsObj = details;
    }
  }

  const titleStr = title != null ? String(title).trim() : null;
  const descStr  = description != null ? String(description).trim() : null;
  const catStr   = category != null ? String(category).trim() : null;
  const priceNum = price != null && price !== "" ? Number(price) : null;

  return {
    title: titleStr,
    descriptionStr: descStr,
    priceNum: Number.isFinite(priceNum) ? priceNum : null,
    category: catStr,
    imagesArr,
    availabilityArr,
    detailsObj,
  };
}

// ---------- Auth ----------
const registerProvider = async (req, res) => {
  try {
    const { name, email, password, type, location, phone, social, photo, address } = req.body || {};
    if (!name || !email || !password || !type || !location || !phone) {
      return res.status(400).json({ message: "Заполните все обязательные поля" });
    }
    if (photo && typeof photo !== "string") {
      return res.status(400).json({ message: "Некорректный формат изображения" });
    }
    const existing = await pool.query("SELECT 1 FROM providers WHERE email = $1", [email]);
    if (existing.rows.length) {
      return res.status(400).json({ message: "Email уже используется" });
    }
    const hashed = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO providers (name, email, password, type, location, phone, social, photo, address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [name, email, hashed, type, location, phone, social ?? null, photo ?? null, address ?? null]
    );
    res.status(201).json({ message: "Регистрация успешна" });
  } catch (err) {
    console.error("❌ Ошибка регистрации:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const loginProvider = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const q = await pool.query("SELECT * FROM providers WHERE email = $1", [email]);
    if (!q.rows.length) {
      return res.status(400).json({ message: "Неверный email или пароль" });
    }
    const row = q.rows[0];
    const ok = await bcrypt.compare(String(password || ""), row.password);
    if (!ok) {
      return res.status(400).json({ message: "Неверный email или пароль" });
    }
    const token = jwt.sign({ id: row.id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.json({ message: "Вход успешен", provider: { id: row.id, name: row.name, email: row.email }, token });
  } catch (err) {
    console.error("❌ Ошибка входа:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// ---------- Profile ----------
const getProviderProfile = async (req, res) => {
  try {
    const id = req.user.id;
    const r = await pool.query(
      `SELECT id, name, email, type, location, phone, social, photo, certificate, address
       FROM providers WHERE id = $1`,
      [id]
    );
    res.json(r.rows[0] || null);
  } catch (err) {
    console.error("❌ Ошибка получения профиля:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const updateProviderProfile = async (req, res) => {
  try {
    const id = req.user.id;
    const oldQ = await pool.query(
      `SELECT name, location, phone, social, photo, certificate, address
       FROM providers WHERE id = $1`,
      [id]
    );
    if (!oldQ.rows.length) return res.status(404).json({ message: "Провайдер не найден" });
    const old = oldQ.rows[0];

    const updated = {
      name: req.body.name ?? old.name,
      location: req.body.location ?? old.location,
      phone: req.body.phone ?? old.phone,
      social: req.body.social ?? old.social,
      photo: req.body.photo ?? old.photo,
      certificate: req.body.certificate ?? old.certificate,
      address: req.body.address ?? old.address,
    };

    await pool.query(
      `UPDATE providers
         SET name=$1, location=$2, phone=$3, social=$4, photo=$5, certificate=$6, address=$7
       WHERE id=$8`,
      [updated.name, updated.location, updated.phone, updated.social, updated.photo, updated.certificate, updated.address, id]
    );
    res.json({ message: "Профиль обновлён успешно" });
  } catch (err) {
    console.error("❌ Ошибка обновления профиля:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const changeProviderPassword = async (req, res) => {
  try {
    const id = req.user.id;
    const { oldPassword, newPassword } = req.body || {};
    const q = await pool.query("SELECT password FROM providers WHERE id=$1", [id]);
    if (!q.rows.length) return res.status(404).json({ message: "Провайдер не найден" });
    const ok = await bcrypt.compare(String(oldPassword || ""), q.rows[0].password);
    if (!ok) return res.status(400).json({ message: "Неверный старый пароль" });
    const hashed = await bcrypt.hash(String(newPassword || ""), 10);
    await pool.query("UPDATE providers SET password=$1 WHERE id=$2", [hashed, id]);
    res.json({ message: "Пароль обновлён" });
  } catch (err) {
    console.error("❌ Ошибка смены пароля:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// ---------- Services CRUD ----------
const addService = async (req, res) => {
  try {
    const providerId = req.user.id;
    const {
      title, category, imagesArr, availabilityArr, priceNum, descriptionStr, detailsObj,
    } = normalizeServicePayload(req.body);

    const extended = isExtendedCategory(category);

    const ins = await pool.query(
      `INSERT INTO services (provider_id, title, description, price, category, images, availability, details)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb)
       RETURNING *`,
      [
        providerId,
        title,
        extended ? null : descriptionStr,
        extended ? null : priceNum,
        category,
        JSON.stringify(imagesArr),
        JSON.stringify(extended ? [] : availabilityArr),
        JSON.stringify(detailsObj ?? {}),
      ]
    );

    res.status(201).json(ins.rows[0]);
  } catch (err) {
    console.error("❌ Ошибка добавления услуги:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const getServices = async (req, res) => {
  try {
    const providerId = req.user.id;
    const r = await pool.query("SELECT * FROM services WHERE provider_id=$1 ORDER BY id DESC", [providerId]);
    res.json(r.rows);
  } catch (err) {
    console.error("❌ Ошибка получения услуг:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const updateService = async (req, res) => {
  try {
    const providerId = req.user.id;
    const serviceId = req.params.id;

    const {
      title, category, imagesArr, availabilityArr, priceNum, descriptionStr, detailsObj,
    } = normalizeServicePayload(req.body);

    const extended = isExtendedCategory(category);

    const upd = await pool.query(
      `UPDATE services
          SET title=$1,
              description=$2,
              price=$3,
              category=$4,
              images=$5::jsonb,
              availability=$6::jsonb,
              details=$7::jsonb
        WHERE id=$8 AND provider_id=$9
        RETURNING *`,
      [
        title,
        extended ? null : descriptionStr,
        extended ? null : priceNum,
        category,
        JSON.stringify(imagesArr),
        JSON.stringify(extended ? [] : availabilityArr),
        JSON.stringify(detailsObj ?? {}),
        serviceId,
        providerId,
      ]
    );

    if (!upd.rowCount) return res.status(404).json({ message: "Услуга не найдена" });
    res.json(upd.rows[0]);
  } catch (err) {
    console.error("❌ Ошибка обновления услуги:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const deleteService = async (req, res) => {
  try {
    const providerId = req.user.id;
    const serviceId = req.params.id;
    const del = await pool.query("DELETE FROM services WHERE id=$1 AND provider_id=$2", [serviceId, providerId]);
    if (!del.rowCount) return res.status(404).json({ message: "Услуга не найдена" });
    res.json({ message: "Удалено" });
  } catch (err) {
    console.error("❌ Ошибка удаления услуги:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// ---------- Public provider card ----------
const getProviderPublicById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const r = await pool.query(
      `SELECT id, name, type, location, phone, social, photo, address FROM providers WHERE id=$1`,
      [id]
    );
    res.json(r.rows[0] || null);
  } catch (err) {
    console.error("❌ Ошибка getProviderPublicById:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// ---------- Calendar ----------
const getBookedDates = async (req, res) => {
  try {
    const providerId = req.user.id;
    const r = await pool.query(
      `SELECT day::date AS date FROM provider_blocked_dates WHERE provider_id=$1 ORDER BY day`,
      [providerId]
    ).catch(() => ({ rows: [] }));
    res.json(r.rows.map((x) => x.date));
  } catch (err) {
    console.error("❌ Ошибка получения занятых дат:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const saveBlockedDates = async (req, res) => {
  try {
    const providerId = req.user.id;
    const { add, remove } = req.body || {};
    const addArr = toArray(add);
    const remArr = toArray(remove);

    await pool.query(
      `CREATE TABLE IF NOT EXISTS provider_blocked_dates (
         provider_id integer not null,
         day date not null,
         primary key(provider_id, day)
       )`
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (addArr.length) {
        for (const d of addArr) {
          await client.query(
            `INSERT INTO provider_blocked_dates(provider_id, day)
               VALUES ($1, $2::date) ON CONFLICT DO NOTHING`,
            [providerId, d]
          );
        }
      }
      if (remArr.length) {
        for (const d of remArr) {
          await client.query(
            `DELETE FROM provider_blocked_dates WHERE provider_id=$1 AND day=$2::date`,
            [providerId, d]
          );
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ Ошибка сохранения занятых дат:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// ---------- Stats (заглушка) ----------
const getProviderStats = async (_req, res) => {
  try {
    res.json({ new: 0, booked: 0 });
  } catch (err) {
    res.json({ new: 0, booked: 0 });
  }
};

// ===== Provider Favorites =====
const listProviderFavorites = async (req, res) => {
  try {
    const providerId = req.user.id;
    const q = await pool.query(
      `SELECT s.*,
              COALESCE( (s.details->>'netPrice')::numeric, s.price ) AS net_price
         FROM provider_favorites f
         JOIN services s ON s.id = f.service_id
        WHERE f.provider_id = $1
        ORDER BY f.created_at DESC`,
      [providerId]
    );
    res.json(q.rows);
  } catch (err) {
    console.error("❌ listProviderFavorites:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const toggleProviderFavorite = async (req, res) => {
  try {
    const providerId = req.user.id;
    const { service_id } = req.body || {};
    if (!service_id) return res.status(400).json({ message: "service_id обязателен" });

    const ins = await pool.query(
      `INSERT INTO provider_favorites(provider_id, service_id)
       VALUES ($1,$2)
       ON CONFLICT (provider_id, service_id) DO NOTHING
       RETURNING id`,
      [providerId, service_id]
    );

    if (ins.rowCount) {
      return res.json({ added: true });
    }

    await pool.query(
      `DELETE FROM provider_favorites WHERE provider_id=$1 AND service_id=$2`,
      [providerId, service_id]
    );
    res.json({ added: false });
  } catch (err) {
    console.error("❌ toggleProviderFavorite:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const removeProviderFavorite = async (req, res) => {
  try {
    const providerId = req.user.id;
    const serviceId = Number(req.params.serviceId);
    await pool.query(
      `DELETE FROM provider_favorites WHERE provider_id=$1 AND service_id=$2`,
      [providerId, serviceId]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("❌ removeProviderFavorite:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

module.exports = {
  isExtendedCategory,
  registerProvider,
  loginProvider,
  getProviderProfile,
  updateProviderProfile,
  changeProviderPassword,
  addService,
  getServices,
  updateService,
  deleteService,
  updateServiceImagesOnly,
  getProviderPublicById,
  getBookedDates,
  saveBlockedDates,
  getProviderStats,
  listProviderFavorites,
  toggleProviderFavorite,
  removeProviderFavorite,
};
