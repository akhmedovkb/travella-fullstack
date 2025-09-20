// backend/controllers/providerController.js

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const { resolveCitySlugs } = require("../utils/cities");


// ---------- Helpers ----------

// ISO-639-1: приводим любые названия/коды к массиву кодов ["ru","en","uz"]
const ISO6391 = require("iso-639-1");
function normalizeLanguagesISO(input, fallback = []) {
  let raw;
  if (input == null) {
    raw = Array.isArray(fallback)
      ? fallback
      : (typeof fallback === "object" && fallback) ? Object.keys(fallback) : [];
  } else if (Array.isArray(input)) {
    raw = input;
  } else if (typeof input === "object") {
    raw = Object.keys(input); // {"ru":"native"} -> ["ru"]
  } else if (typeof input === "string") {
    raw = input.split(/[,\|;\n•]+/).map((s) => s.trim()).filter(Boolean);
  } else {
    raw = [];
  }

  const codes = raw
    .map((x) => String(x || "").trim())
    .map((x) => {
      if (x.length === 2 && ISO6391.validate(x)) return x.toLowerCase();
      const code = ISO6391.getCode(x); // English/Русский/... -> en/ru
      return code || null;
    })
    .filter(Boolean);

  return Array.from(new Set(codes));
}

// Нормализуем Telegram username к виду "@username"
function normalizeTelegramUsername(input) {
  if (!input) return null;
  let s = String(input).trim();
  if (!s) return null;
  s = s.replace(/\s+/g, "");
  let m = s.match(/^tg:\/\/resolve\?domain=([A-Za-z0-9_]{3,})/i);
  if (m) return "@" + m[1];
  m = s.match(/^(?:https?:\/\/)?(?:t\.me|telegram\.me|telegram\.dog)\/@?([A-Za-z0-9_]{3,})$/i);
  if (m) return "@" + m[1];
  m = s.match(/^@?([A-Za-z0-9_]{3,})$/);
  if (m) return "@" + m[1];
  return s;
}

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
    try {
      const arr = JSON.parse(val);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
  return [];
}
const sanitizeImages = (images) =>
  toArray(images)
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, 20);

function normalizeServicePayload(body) {
  const { title, description, price, category, images, availability, details } =
    body || {};

  const imagesArr = sanitizeImages(images);
  const availabilityArr = Array.isArray(availability)
    ? availability
    : toArray(availability);

  let detailsObj = null;
  if (details) {
    if (typeof details === "string") {
      try {
        detailsObj = JSON.parse(details);
      } catch {
        detailsObj = { value: String(details) };
      }
    } else if (typeof details === "object") {
      detailsObj = details;
    }
  }

  const titleStr = title != null ? String(title).trim() : null;
  const descStr = description != null ? String(description).trim() : null;
  const catStr = category != null ? String(category).trim() : null;
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
    const { name, email, password, type, location, phone, social, photo, address } =
      req.body || {};

    if (!name || !email || !password || !type || !location || !phone) {
      return res.status(400).json({ message: "Заполните все обязательные поля" });
    }
    if (photo && typeof photo !== "string") {
      return res.status(400).json({ message: "Некорректный формат изображения" });
    }

    const existing = await pool.query(
      "SELECT 1 FROM providers WHERE email = $1",
      [email]
    );
    if (existing.rows.length) {
      return res.status(400).json({ message: "Email уже используется" });
    }

    const hashed = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO providers (name, email, password, type, location, phone, social, photo, address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        name,
        email,
        hashed,
        type,
        location,
        phone,
        social ?? null,
        photo ?? null,
        address ?? null,
      ]
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

    const isAdmin = row.is_admin === true;
    const payload = { id: row.id, role: "provider", is_admin: isAdmin };
    const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" });


    res.json({
      message: "Вход успешен",
      provider: {
        id: row.id,
        name: row.name,
        email: row.email,
        type: row.type,
        location: row.location,
        phone: row.phone,
        social: row.social,
        photo: row.photo,
        address: row.address,
        certificate: row.certificate,
        telegram_chat_id: row.telegram_chat_id || null,
        tg_chat_id: row.telegram_chat_id || null,
        languages: normalizeLanguagesISO(row.languages ?? []),
        role: "provider",
        is_admin: row.is_admin === true,
        city_slugs: row.city_slugs || [],
      },
      token,
    });
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
      `SELECT id, name, email, type, location, phone, social, photo, certificate, address, telegram_chat_id, languages
       FROM providers WHERE id = $1`,
      [id]
    );
    const p = r.rows[0] || null;
    if (!p) return res.json(null);

    res.json({
      id: p.id,
      name: p.name,
      email: p.email,
      type: p.type,
      location: p.location,
      phone: p.phone,
      social: p.social,
      photo: p.photo,
      certificate: p.certificate,
      address: p.address,
      telegram_chat_id: p.telegram_chat_id || null,
      tg_chat_id: p.telegram_chat_id || null,
      avatar_url: p.photo || null,
      languages: normalizeLanguagesISO(p.languages ?? []),
      role: "provider",
      is_admin: p.is_admin === true,
      city_slugs: p.city_slugs || [],
    });
  } catch (err) {
    console.error("❌ Ошибка получения профиля:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const updateProviderProfile = async (req, res) => {
  try {
    const id = req.user.id;

    // читаем текущее состояние
    const oldQ = await pool.query(
      `SELECT name, location, phone, social, photo, certificate, address, languages, telegram_chat_id, city_slugs
         FROM providers
        WHERE id = $1`,
      [id]
    );
    if (!oldQ.rows.length) {
      return res.status(404).json({ message: "Провайдер не найден" });
    }
    const old = oldQ.rows[0];

    // location как массив (text[])
    const toTextArray = (v, fallback) => {
      if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
      if (typeof v === "string") return [v.trim()].filter(Boolean);
      return Array.isArray(fallback) ? fallback : (typeof fallback === "string" ? [fallback] : []);
    };

    // прислали ли social в payload?
    const hasSocial = Object.prototype.hasOwnProperty.call(req.body || {}, "social");
    const newSocialNorm = hasSocial ? normalizeTelegramUsername(req.body.social) : old.social;

    // сравнение username без "@"
    const canon = (v) => (normalizeTelegramUsername(v) || "").replace(/^@/, "").toLowerCase();
    const tgChanged = hasSocial && canon(newSocialNorm) !== canon(old.social);

    // базовые поля
    const updated = {
      name: req.body.name ?? old.name,
      location: toTextArray(req.body.location, old.location),
      phone: req.body.phone ?? old.phone,
      social: newSocialNorm,
      photo: req.body.photo ?? old.photo,
      certificate: req.body.certificate ?? old.certificate,
      address: req.body.address ?? old.address,
      languages: normalizeLanguagesISO(req.body.languages, old.languages), // jsonb
    };

    // city_slugs: можно прислать готовые (city_slugs), а можно — только location
    let incomingSlugs = Array.isArray(req.body.city_slugs)
      ? req.body.city_slugs.filter(Boolean).map(String)
      : null;

    if (!incomingSlugs) {
      // строим из location
      incomingSlugs = await resolveCitySlugs(pool, updated.location);
    }

    // формируем UPDATE динамически (как у тебя)
    const fields = [
      `name = $1`,
      `location = $2`,
      `phone = $3`,
      `social = $4`,
      `photo = $5`,
      `certificate = $6`,
      `address = $7`,
      `languages = $8::jsonb`,
      `city_slugs = $9::text[]`,
      `telegram_chat_id = CASE WHEN $11::bool THEN NULL ELSE telegram_chat_id END`,
      `updated_at = NOW()`,
    ];
    const values = [
      updated.name,
      updated.location,
      updated.phone,
      updated.social,
      updated.photo,
      updated.certificate,
      updated.address,
      JSON.stringify(updated.languages ?? []),
      incomingSlugs || [],        // $9
      id,                         // $10 — подставим ниже
      tgChanged,                  // $11
    ];

    // обратим внимание: id — это $10, поэтому в запросе используем $10
    const upd = await pool.query(
      `UPDATE providers
          SET ${fields.join(", ")}
        WHERE id = $10
        RETURNING id, name, email, type, location, phone, social, photo, certificate, address, telegram_chat_id, languages, city_slugs`,
      values
    );

    const p = upd.rows[0] || null;

    res.json({
      message: "Профиль обновлён успешно",
      provider: p
        ? {
            id: p.id,
            name: p.name,
            email: p.email,
            type: p.type,
            location: p.location,
            phone: p.phone,
            social: p.social,
            photo: p.photo,
            certificate: p.certificate,
            address: p.address,
            telegram_chat_id: p.telegram_chat_id || null,
            tg_chat_id: p.telegram_chat_id || null,
            avatar_url: p.photo || null,
            languages: normalizeLanguagesISO(p.languages ?? []),
            city_slugs: p.city_slugs || [],
          }
        : null,
    });
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
      title,
      category,
      imagesArr,
      availabilityArr,
      priceNum,
      descriptionStr,
      detailsObj,
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
    const r = await pool.query(
      "SELECT * FROM services WHERE provider_id=$1 ORDER BY id DESC",
      [providerId]
    );
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

    // 1) Узнаём текущий статус и владение
    const cur = await pool.query(
      `SELECT status FROM services WHERE id=$1 AND provider_id=$2`,
      [serviceId, providerId]
    );
    if (!cur.rowCount) {
      return res.status(404).json({ message: "Услуга не найдена" });
    }

    const currentStatus = cur.rows[0].status;

    // 2) Правила редактирования по статусу
    if (currentStatus === "pending") {
      // На модерации редактировать запрещаем (чтобы модерация имела смысл)
      return res.status(409).json({
        message: "Услуга на модерации. Дождитесь решения или снимите с модерации.",
        code: "SERVICE_PENDING",
      });
    }

    if (currentStatus === "published" || currentStatus === "rejected") {
      // Любые правки по опубликованной/отклонённой — это новый черновик
      await pool.query(
        `UPDATE services
            SET status='draft',
                submitted_at=NULL,
                published_at=NULL,
                approved_at=NULL,
                rejected_at=NULL,
                rejected_reason=NULL
          WHERE id=$1 AND provider_id=$2`,
        [serviceId, providerId]
      );
    }

    // 3) Нормализуем вход
    const {
      title,
      category,
      imagesArr,
      availabilityArr,
      priceNum,
      descriptionStr,
      detailsObj,
    } = normalizeServicePayload(req.body);

    const extended = isExtendedCategory(category);

    // 4) Обновляем основное содержимое
    const upd = await pool.query(
      `UPDATE services
          SET title=$1,
              description=$2,
              price=$3,
              category=$4,
              images=$5::jsonb,
              availability=$6::jsonb,
              details=$7::jsonb,
              updated_at=NOW()
        WHERE id=$8 AND provider_id=$9
        RETURNING *`,
      [
        title,
        extended ? null : descriptionStr,
        extended ? null : priceNum,
        category,
        JSON.stringify(imagesArr ?? []),
        JSON.stringify(extended ? [] : (availabilityArr ?? [])),
        JSON.stringify(detailsObj ?? {}),
        serviceId,
        providerId,
      ]
    );

    if (!upd.rowCount) {
      return res.status(404).json({ message: "Услуга не найдена" });
    }

    // В rows[0] уже будет статус (включая 'draft', если мы его демотировали выше)
    return res.json(upd.rows[0]);
  } catch (err) {
    console.error("❌ Ошибка обновления услуги:", err);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};


const deleteService = async (req, res) => {
  try {
    const providerId = req.user.id;
    const serviceId = req.params.id;
    const del = await pool.query(
      "DELETE FROM services WHERE id=$1 AND provider_id=$2",
      [serviceId, providerId]
    );
    if (!del.rowCount) return res.status(404).json({ message: "Услуга не найдена" });
    res.json({ message: "Удалено" });
  } catch (err) {
    console.error("❌ Ошибка удаления услуги:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// Только обновление картинок
const updateServiceImagesOnly = async (req, res) => {
  try {
    const providerId = req.user.id;
    const serviceId = req.params.id;
    const imagesArr = sanitizeImages(req.body.images);
    const upd = await pool.query(
      `UPDATE services
          SET images=$1::jsonb,
              updated_at=NOW()
        WHERE id=$2 AND provider_id=$3
        RETURNING *`,
      [JSON.stringify(imagesArr), serviceId, providerId]
    );
    if (!upd.rowCount) return res.status(404).json({ message: "Услуга не найдена" });
    res.json(upd.rows[0]);
  } catch (err) {
    console.error("❌ Ошибка обновления картинок:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// ---------- Public provider card ----------
const getProviderPublicById = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const r = await pool.query(
      `SELECT id, name, type, location, phone, social, photo, address, languages
         FROM providers
        WHERE id=$1`,
      [id]
    );
    const row = r.rows[0] || null;
    if (!row) return res.json(null);

    res.json({
      id: row.id,
      name: row.name,
      type: row.type,
      location: row.location,
      phone: row.phone,
      social: row.social,
      photo: row.photo,
      address: row.address,
      languages: normalizeLanguagesISO(row.languages ?? []),
      city_slugs: row.city_slugs || [],
    });
  } catch (err) {
    console.error("❌ Ошибка getProviderPublicById:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// ---------- Calendar ----------
const getBookedDates = async (req, res) => {
  try {
    const providerId = req.user.id;
    const q = await pool.query(
      `SELECT DISTINCT bd.date::text AS date
         FROM booking_dates bd
         JOIN bookings b ON b.id = bd.booking_id
        WHERE b.provider_id = $1
          AND b.status IN ('pending','confirmed','active')
          AND bd.date >= CURRENT_DATE
        ORDER BY 1`,
      [providerId]
    );
    res.json(q.rows);
  } catch (err) {
    console.error("getBookedDates error:", err);
    res.status(500).json({ message: "booked-dates error" });
  }
};

const getBlockedDates = async (req, res) => {
  try {
    const providerId = req.user.id;
    const q = await pool.query(
      `SELECT date::text AS date
         FROM provider_blocked_dates
        WHERE provider_id=$1
        ORDER BY 1`,
      [providerId]
    );
    res.json(q.rows);
  } catch (err) {
    console.error("getBlockedDates error:", err);
    res.status(500).json({ message: "blocked-dates error" });
  }
};

// полная замена: { dates: ["YYYY-MM-DD", ...] }
const saveBlockedDates = async (req, res) => {
  const providerId = req.user.id;
  const incoming = Array.isArray(req.body?.dates) ? req.body.dates : [];
  const dates = Array.from(new Set(incoming.map((v) => String(v).slice(0, 10)).filter(Boolean)));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`DELETE FROM provider_blocked_dates WHERE provider_id = $1`, [providerId]);

    if (dates.length) {
      const values = dates.map((_, i) => `($1, $${i + 2}::date)`).join(",");
      await client.query(
        `INSERT INTO provider_blocked_dates (provider_id, date)
         VALUES ${values}
         ON CONFLICT (provider_id, date) DO NOTHING`,
        [providerId, ...dates]
      );
    }

    await client.query("COMMIT");
    res.json({ ok: true, count: dates.length });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("saveBlockedDates error:", e);
    res.status(500).json({ message: "blocked-dates save error" });
  } finally {
    client.release();
  }
};

const getCalendarPublic = async (req, res) => {
  try {
    const providerId = Number(req.params.providerId);
    if (!Number.isFinite(providerId)) {
      return res.status(400).json({ message: "Bad providerId" });
    }

    const [booked, blocked] = await Promise.all([
      pool.query(
        `SELECT DISTINCT bd.date::text AS date
           FROM booking_dates bd
           JOIN bookings b ON b.id = bd.booking_id
          WHERE b.provider_id = $1
            AND b.status IN ('confirmed','active')
            AND bd.date >= CURRENT_DATE
          ORDER BY 1`,
        [providerId]
      ),
      pool.query(
        `SELECT date::text AS date
           FROM provider_blocked_dates
          WHERE provider_id=$1
          ORDER BY 1`,
        [providerId]
      ),
    ]);

    res.json({ booked: booked.rows, blocked: blocked.rows });
  } catch (err) {
    console.error("❌ Ошибка getCalendarPublic:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// ---------- Stats ----------
const getProviderStats = async (_req, res) => {
  try {
    res.json({ new: 0, booked: 0 });
  } catch {
    res.json({ new: 0, booked: 0 });
  }
};

// ---------- Favorites ----------
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

    if (ins.rowCount) return res.json({ added: true });

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
  // календарь
  getBookedDates,
  getBlockedDates,
  saveBlockedDates,
  getCalendarPublic,
  // остальное
  getProviderStats,
  listProviderFavorites,
  toggleProviderFavorite,
  removeProviderFavorite,
};
