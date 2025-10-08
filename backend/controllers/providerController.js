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

// --- Dates helpers (robust parse for ISO/YYYY-MM-DD) -------------------------
function parseDateSafe(v) {
  if (!v) return null;
  try {
    const d = new Date(String(v));
    return Number.isFinite(d.getTime()) ? d : null;
  } catch { return null; }
}
function pickFirst(obj, keys = []) {
  for (const k of keys) {
    if (!k) continue;
    const val = k.includes(".")
      ? k.split(".").reduce((o, kk) => (o && o[kk] != null ? o[kk] : undefined), obj)
      : obj?.[k];
    if (val != null && String(val).trim() !== "") return val;
  }
  return null;
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

// Транспортные категории — только здесь допускаем details.seats
const TRANSPORT_CATS = new Set([
  "city_tour_transport",
  "mountain_tour_transport",
  "one_way_transfer",
  "dinner_transfer",
  "border_transfer",
]);
const isTransportCategory = (cat) => TRANSPORT_CATS.has(String(cat || ""));

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


// ---------------- Cars in provider profile (no new table) ----------------
function normalizeCarFleet(input) {
  // ожидаем массив объектов: [{model, seats, images?, is_active?}, ...]
  const arr = Array.isArray(input) ? input : [];
  const out = [];
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const model = String(it.model || "").trim();
    const seatsNum = Number(it.seats);
    const seats = Number.isInteger(seatsNum) && seatsNum > 0 ? seatsNum : null;
    if (!model || !seats) continue;
    const images = sanitizeImages(it.images);
    const is_active = it.is_active === false ? false : true;
    out.push({ model, seats, images, is_active });
    if (out.length >= 10) break; // ограничим до 10 машин на профиль
  }
  return out;
}

// Нормализатор чисел «как с фронта»: "1 200,50" -> 1200.5
function parseMoneySafe(v) {
  if (v === null || v === undefined) return NaN;
  let s = String(v).trim();
  if (!s) return NaN;
  s = s.replace(/\s+/g, "");
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) s = s.replace(/\./g, "");
  s = s.replace(/,/g, ".");
  s = s.replace(/\.(?=.*\.)/g, "");
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

// Главное: единая и безопасная нормализация входа сервиса
function normalizeServicePayload(body = {}) {
  const { title, description, price, category, images, availability, details } = body;

  const titleStr = String(title ?? "").trim();
  const descStr = typeof description === "string" ? description : "";
  const catStr = String(category ?? "").trim();

  let priceNum = null;
  if (price !== undefined && price !== null && String(price).trim() !== "") {
    const p = parseMoneySafe(price);
    priceNum = Number.isFinite(p) ? p : null;
  }

  const imagesArr = sanitizeImages(images);
  const availabilityArr = toArray(availability);

  let detailsObj = null;
  if (details) {
    if (typeof details === "string") {
      try {
        detailsObj = JSON.parse(details);
      } catch {
        detailsObj = { value: String(details) };
      }
    } else if (typeof details === "object") {
      detailsObj = { ...details };
    }
  }

  // seats — только у транспорта
  if (detailsObj && Object.prototype.hasOwnProperty.call(detailsObj, "seats")) {
    if (isTransportCategory(catStr)) {
      const n = Number(detailsObj.seats);
      if (Number.isFinite(n) && n > 0) {
        detailsObj.seats = Math.trunc(n);
      } else {
        delete detailsObj.seats;
      }
    } else {
      delete detailsObj.seats;
    }
  }

  // Нормализуем цены в details (если пришли строками)
  if (detailsObj) {
    for (const k of ["netPrice", "grossPrice"]) {
      if (detailsObj[k] !== undefined && detailsObj[k] !== null && String(detailsObj[k]).trim() !== "") {
        const n = parseMoneySafe(detailsObj[k]);
        if (Number.isFinite(n)) detailsObj[k] = n;
      }
    }
    // expiration_ts допускаем в секундах/миллисекундах/ISO
    if (detailsObj.expiration_ts !== undefined) {
      let ts = Number(detailsObj.expiration_ts);
      if (Number.isFinite(ts)) {
        if (ts < 1e12) ts = Math.floor(ts) * 1000; // секунды -> мс
        detailsObj.expiration_ts = Math.floor(ts / 1000); // в БД храним секунды
      } else {
        delete detailsObj.expiration_ts;
      }
    }
  }

  return {
    title: titleStr,
    descriptionStr: descStr,
    priceNum,
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
    const emailNorm = String(email || "").trim().toLowerCase();

    if (!name || !email || !password || !type || !location || !phone) {
      return res.status(400).json({ message: "Заполните все обязательные поля" });
    }
    if (photo && typeof photo !== "string") {
      return res.status(400).json({ message: "Некорректный формат изображения" });
    }

    const existing = await pool.query(
      "SELECT 1 FROM providers WHERE lower(email) = $1",
      [emailNorm]
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
        emailNorm,
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
        car_fleet: Array.isArray(row.car_fleet) ? row.car_fleet : [],
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
      `SELECT id, name, email, type, location, phone, social, photo, certificate, address, telegram_chat_id, languages, is_admin, city_slugs, car_fleet
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
      car_fleet: Array.isArray(p.car_fleet) ? p.car_fleet : [],
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
      `SELECT name, location, phone, social, photo, certificate, address, languages, telegram_chat_id, city_slugs, car_fleet
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

        // car_fleet (массив авто) — опционально; если не прислали, оставляем как было
    const hasFleet = Object.prototype.hasOwnProperty.call(req.body || {}, "car_fleet");
    const nextFleet = hasFleet ? normalizeCarFleet(req.body.car_fleet) : (old.car_fleet || []);


    // city_slugs: можно прислать готовые (city_slugs), а можно — только location
    let incomingSlugs = Array.isArray(req.body.city_slugs)
      ? req.body.city_slugs.filter(Boolean).map(String)
      : null;

    if (!incomingSlugs) {
      // строим из location
      incomingSlugs = await resolveCitySlugs(pool, updated.location);
    }

    // формируем UPDATE динамически
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
      `car_fleet = $10::jsonb`,
      `telegram_chat_id = CASE WHEN $12::bool THEN NULL ELSE telegram_chat_id END`,
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
      JSON.stringify(nextFleet || []), // $10
      id,                              // $11 — WHERE id = $11
      tgChanged,                       // $12 — для CASE WHEN $12::bool
    ];

    const upd = await pool.query(
      `UPDATE providers
          SET ${fields.join(", ")}
        WHERE id = $11
        RETURNING id, name, email, type, location, phone, social, photo, certificate, address, telegram_chat_id, languages, city_slugs, car_fleet, is_admin`,
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
            car_fleet: Array.isArray(p.car_fleet) ? p.car_fleet : [],
            is_admin: p.is_admin === true,
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
    
    // ── Business validation: expire_at must not be earlier than start_date
    // Источники: либо в теле напрямую, либо в details.*
    const startRaw  = pickFirst(req.body, ["start_date"]) ?? pickFirst(detailsObj, ["start_date","start_at","begin_date"]);
    const expireRaw = pickFirst(req.body, ["expire_at","expiration_at"]) ?? pickFirst(detailsObj, ["expire_at","expiration_at","valid_until"]);
    const startDate  = parseDateSafe(startRaw);
    const expireDate = parseDateSafe(expireRaw);
    if (startDate && expireDate && expireDate < startDate) {
      return res.status(400).json({
        code: "EXPIRY_BEFORE_START",
        message: "Expiration must not be earlier than start date"
      });
    }

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
        // дружелюбный маппинг pg: time zone displacement out of range (22009)
    const msg = (err && err.message) || "";
    const where = (err && err.where) || "";
    const routine = (err && err.routine) || "";
    const isTzOutOfRange =
      err?.code === "22009" ||
      /time zone displacement out of range/i.test(msg) ||
      /parse_iso_minute_utc/i.test(where) ||
      /DateTimeParseError/i.test(routine);
    if (isTzOutOfRange) {
      return res.status(400).json({
        code: "EXPIRY_BEFORE_START",
        message: "Expiration must not be earlier than start date"
      });
    }
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
      return res.status(409).json({
        message: "Услуга на модерации. Дождитесь решения или снимите с модерации.",
        code: "SERVICE_PENDING",
      });
    }

    if (currentStatus === "published" || currentStatus === "rejected") {
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
    
    // ── Business validation: expire_at must not be earlier than start_date
    const startRaw  = pickFirst(req.body, ["start_date"]) ?? pickFirst(detailsObj, ["start_date","start_at","begin_date"]);
    const expireRaw = pickFirst(req.body, ["expire_at","expiration_at"]) ?? pickFirst(detailsObj, ["expire_at","expiration_at","valid_until"]);
    const startDate  = parseDateSafe(startRaw);
    const expireDate = parseDateSafe(expireRaw);
    if (startDate && expireDate && expireDate < startDate) {
      return res.status(400).json({
        code: "EXPIRY_BEFORE_START",
        message: "Expiration must not be earlier than start date"
      });
    }

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

    return res.json(upd.rows[0]);
  } catch (err) {
    console.error("❌ Ошибка обновления услуги:", err);
        // дружелюбный маппинг pg: time zone displacement out of range (22009)
    const msg = (err && err.message) || "";
    const where = (err && err.where) || "";
    const routine = (err && err.routine) || "";
    const isTzOutOfRange =
      err?.code === "22009" ||
      /time zone displacement out of range/i.test(msg) ||
      /parse_iso_minute_utc/i.test(where) ||
      /DateTimeParseError/i.test(routine);
    if (isTzOutOfRange) {
      return res.status(400).json({
        code: "EXPIRY_BEFORE_START",
        message: "Expiration must not be earlier than start date"
      });
    }
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
      `SELECT id, name, type, location, phone, social, photo, address, languages, city_slugs
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


/* ===========================
 *  PUBLIC: SEARCH / AVAILABLE
 * =========================== */

// Категории для каскада (как в UI)
const GUIDE_CATS_PUBLIC = [
  "city_tour_guide","mountain_tour_guide",
  "desert_tour_guide","safari_tour_guide",
  "meet","seeoff","translation",
];
const TRANSPORT_CATS_PUBLIC = [
  "city_tour_transport","mountain_tour_transport",
  "desert_tour_transport","safari_tour_transport",
  "one_way_transfer","dinner_transfer","border_transfer",
];
function catsForPublic(type) {
  const t = String(type || "").toLowerCase();
  if (t === "guide" || t === "gid") return GUIDE_CATS_PUBLIC;
  if (t === "transport") return TRANSPORT_CATS_PUBLIC;
  return [...GUIDE_CATS_PUBLIC, ...TRANSPORT_CATS_PUBLIC];
}
function parsePublicQuery(qs = {}) {
  const type = String(qs.type || "").trim();
  const city = String(qs.city || qs.location || "").trim();
  const q = String(qs.q || "").trim();
  const language = String(qs.language || qs.lang || "").trim();
  const date = String(qs.date || "").trim();
  const start = String(qs.start || "").trim();
  const end = String(qs.end || "").trim();
  const limit = Math.min(Math.max(parseInt(qs.limit, 10) || 30, 1), 100);
  return { type, city, q, language, date, start, end, limit };
}
// Универсальный фильтр по p.languages (text | text[] | jsonb[])
function pushLangWhere(where, vals, lang) {
  if (!lang) return;
  vals.push(lang);
  const iLang = vals.length;
  where.push(`
    (
      (pg_typeof(p.languages)::text = 'text'
        AND LOWER(p.languages::text) = LOWER($${iLang}))
      OR
      EXISTS (
        SELECT 1
        FROM jsonb_array_elements_text(
               CASE
                 WHEN jsonb_typeof(to_jsonb(p.languages)) = 'array'
                   THEN to_jsonb(p.languages)
                 ELSE NULL::jsonb
               END
             ) AS lang(code)
        WHERE LOWER(lang.code) = LOWER($${iLang})
      )
    )
  `);
}

// SELECT из provider_services (каскад), затем join на providers и доп.фильтры
async function baseSearchFromServices({ type, city, q, language, limit, date, start, end }) {
  const vals = [];
  const whereProv = [];

  // 1) slug города
  let citySlug = null;
  if (city) {
    try {
      const slugs = await resolveCitySlugs(pool, [city]);
      citySlug = slugs?.[0] || null;
    } catch {}
  }

  // 2) категории
  const categories = catsForPublic(type);
  vals.push(categories);                 // $1
  const iCats = 1;

  // 3) CTE по услугам — без фильтра города, только актив/цены/категории
  const svcCTE = `
    WITH svc AS (
      SELECT DISTINCT s.provider_id
      FROM provider_services s
      WHERE s.is_active = TRUE
        AND COALESCE( (s.details->>'netPrice')::numeric, s.price ) > 0
        AND s.category = ANY($${iCats})
    )
  `;

  // 4) фильтр текста по провайдеру
  if (q) {
    vals.push(`%${q}%`);
    const i = vals.length;
    whereProv.push(`(p.name ILIKE $${i} OR p.email ILIKE $${i} OR p.phone ILIKE $${i})`);
  }

  // 5) язык провайдера
  pushLangWhere(whereProv, vals, language);

  // 6) город — фильтруем на уровне провайдера:
  if (citySlug) {
    vals.push(citySlug);
    const iSlug = vals.length;
    whereProv.push(`
      (
        EXISTS (
          SELECT 1
          FROM provider_services s2
          WHERE s2.provider_id = p.id
            AND LOWER(s2.details->>'city_slug') = LOWER($${iSlug})
        )
        OR EXISTS (
          SELECT 1
          FROM unnest(COALESCE(p.city_slugs, ARRAY[]::text[])) cs
          WHERE LOWER(cs) = LOWER($${iSlug})
        )
      )
    `);
  }

  // 7) занятость как было
  let busyClause = "";
  if (date) {
    vals.push(date);
    const i = vals.length;
    busyClause = `
      AND NOT EXISTS (
        SELECT 1
        FROM bookings b
        JOIN booking_dates bd ON bd.booking_id = b.id
        WHERE b.provider_id = p.id
          AND b.status IN ('confirmed','active')
          AND bd.date = $${i}::date
      )
      AND NOT EXISTS (
        SELECT 1
        FROM provider_blocked_dates d
        WHERE d.provider_id = p.id
          AND d.date = $${i}::date
      )
    `;
  } else if (start && end) {
    vals.push(start); const is = vals.length;
    vals.push(end);   const ie = vals.length;
    busyClause = `
      AND NOT EXISTS (
        SELECT 1
        FROM bookings b
        JOIN booking_dates bd ON bd.booking_id = b.id
        WHERE b.provider_id = p.id
          AND b.status IN ('confirmed','active')
          AND bd.date BETWEEN $${is}::date AND $${ie}::date
      )
      AND NOT EXISTS (
        SELECT 1
        FROM provider_blocked_dates d
        WHERE d.provider_id = p.id
          AND d.date BETWEEN $${is}::date AND $${ie}::date
      )
    `;
  }

  // 8) лимит
  vals.push(Math.min(Math.max(Number(limit) || 30, 1), 100));
  const iLimit = vals.length;

  const sql = `
    ${svcCTE}
    SELECT p.id, p.name, p.type, p.location, p.city_slugs,
           p.phone, p.email, p.photo, p.languages, p.social AS telegram
    FROM providers p
    JOIN svc ON svc.provider_id = p.id
    ${whereProv.length ? "WHERE " + whereProv.join(" AND ") : ""}
    ${busyClause}
    ORDER BY p.name ASC
    LIMIT $${iLimit};
  `;

  const { rows } = await pool.query(sql, vals);
  return rows;
}


// GET /api/providers/search
async function searchProvidersPublic(req, res) {
  try {
    const params = parsePublicQuery(req.query);
    const items = await baseSearchFromServices({ ...params });
    res.json({ items });
  } catch (e) {
    console.error("GET /api/providers/search", e);
    res.status(500).json({ error: "Failed to search providers" });
  }
}

// GET /api/providers/available
async function availableProvidersPublic(req, res) {
  try {
    const params = parsePublicQuery(req.query);
    // если нет даты/интервала — это тот же /search
    if (!params.date && !(params.start && params.end)) {
      const items = await baseSearchFromServices({ ...params });
      return res.json({ items });
    }
    const items = await baseSearchFromServices({ ...params });
    res.json({ items });
  } catch (e) {
    console.error("GET /api/providers/available", e);
    res.status(500).json({ error: "Failed to get available providers" });
  }
}

// экспортируем публичные обработчики
module.exports.searchProvidersPublic = searchProvidersPublic;
module.exports.availableProvidersPublic = availableProvidersPublic;
