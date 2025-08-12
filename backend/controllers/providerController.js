const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");
// ========= helpers =========
const isExtendedCategory = (cat) =>
  [
    "refused_tour",
    "author_tour",
    "refused_hotel",
    "refused_flight",
    "refused_event_ticket",
    "visa_support",
  ].includes(cat);

/**
 * Приводим поля к ожидаемым типам
 * - images/availability -> массив
 * - details -> объект или null
 * - price -> число либо null
 * - description -> строка либо null
 */
function sanitizeImages(images) {
  const arr = Array.isArray(images) ? images : images ? [images] : [];
  return arr
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, 10);
}
function normalizeServicePayload(body) {
  const { title, description, price, category, images, availability, details } = body;

  const imagesArr = sanitizeImages(images);
  const availabilityArr = Array.isArray(availability) ? availability : [];

  let detailsObj = null;
  if (details && isExtendedCategory(category)) {
    if (typeof details === "string") {
      try { detailsObj = JSON.parse(details); }
      catch { detailsObj = { value: String(details) }; }
    } else if (typeof details === "object") {
      detailsObj = details;
    }
  }

  const priceNum =
    price === undefined || price === null || price === "" ? null : Number(price);

  return {
    title: title ?? "",
    category: category ?? "",
    imagesArr,
    availabilityArr,
    priceNum,
    descriptionStr:
      description === undefined || description === null ? null : String(description),
    detailsObj,
  };
}

// =====================
// Регистрация поставщика
// =====================
const registerProvider = async (req, res) => {
  try {
    console.log("📦 Получено тело запроса:", req.body);
    const { name, email, password, type, location, phone, social, photo, address } = req.body;

    if (!name || !email || !password || !type || !location || !phone) {
      return res.status(400).json({ message: "Заполните все обязательные поля" });
    }

    if (photo && typeof photo !== "string") {
      return res.status(400).json({ message: "Некорректный формат изображения" });
    }

    const existingProvider = await pool.query("SELECT * FROM providers WHERE email = $1", [email]);
    if (existingProvider.rows.length > 0) {
      return res.status(400).json({ message: "Email уже используется" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newProvider = await pool.query(
      `INSERT INTO providers (name, email, password, type, location, phone, social, photo, address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, email`,
      [name, email, hashedPassword, type, location, phone, social, photo, address]
    );

    const token = jwt.sign({ id: newProvider.rows[0].id }, process.env.JWT_SECRET, { expiresIn: "7d" });

    res.status(201).json({
      message: "Регистрация прошла успешно",
      provider: newProvider.rows[0],
      token,
    });

  } catch (error) {
    console.error("❌ Ошибка регистрации:", error.message);
    res.status(500).json({ message: "Ошибка сервера", error: error.message });
  }
};

// =====================
// Логин поставщика
// =====================
const loginProvider = async (req, res) => {
  try {
    const { email, password } = req.body;
    const provider = await pool.query("SELECT * FROM providers WHERE email = $1", [email]);

    if (provider.rows.length === 0) {
      return res.status(400).json({ message: "Пользователь не найден" });
    }

    const isMatch = await bcrypt.compare(password, provider.rows[0].password);
    if (!isMatch) {
      return res.status(400).json({ message: "Неверный пароль" });
    }

    const token = jwt.sign({ id: provider.rows[0].id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });

    res.status(200).json({
      message: "Вход успешен",
      provider: {
        id: provider.rows[0].id,
        name: provider.rows[0].name,
        email: provider.rows[0].email,
      },
      token,
    });
  } catch (error) {
    console.error("❌ Ошибка входа:", error.message);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// =====================
// Профиль
// =====================
const getProviderProfile = async (req, res) => {
  try {
    const id = req.user.id;
    const result = await pool.query(
      "SELECT id, name, email, type, location, phone, social, photo, certificate, address FROM providers WHERE id = $1",
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Поставщик не найден" });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("❌ Ошибка получения профиля:", error.message);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const updateProviderProfile = async (req, res) => {
  try {
    const id = req.user.id;

    const current = await pool.query("SELECT * FROM providers WHERE id = $1", [id]);
    if (current.rows.length === 0) {
      return res.status(404).json({ message: "Поставщик не найден" });
    }

    const old = current.rows[0];

    const updated = {
      name: req.body.name ?? old.name,
      location: req.body.location ?? old.location,
      phone: req.body.phone ?? old.phone,
      social: req.body.social ?? old.social,
      photo: req.body.photo ?? old.photo,
      certificate: req.body.certificate ?? old.certificate,
      address: req.body.address ?? old.address
    };

    await pool.query(
      `UPDATE providers
       SET name = $1, location = $2, phone = $3, social = $4, photo = $5, certificate = $6, address = $7
       WHERE id = $8`,
      [updated.name, updated.location, updated.phone, updated.social, updated.photo, updated.certificate, updated.address, id]
    );

    res.status(200).json({ message: "Профиль обновлён успешно" });
  } catch (error) {
    console.error("❌ Ошибка обновления профиля:", error.message);
    res.status(500).json({ message: "Ошибка сервера", error: error.message });
  }
};

// =====================
// Услуги
// =====================
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

    // Для jsonb ВСЕГДА передаём валидную строку JSON и явно кастуем ::jsonb
    const result = await pool.query(
      `INSERT INTO services
         (provider_id, title, description, price, category, images, availability, details)
       VALUES
         ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
       RETURNING *`,
      [
        providerId,
        title,
        extended ? null : descriptionStr,
        extended ? null : priceNum,
        category,
        JSON.stringify(imagesArr),        // -> []
        JSON.stringify(extended ? [] : availabilityArr), // simple cat: [], extended: []
        JSON.stringify(extended ? (detailsObj ?? {}) : {}), // extended: {} или то, что пришло; simple: null
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("❌ Ошибка добавления услуги:", error);
    res.status(500).json({ message: "Ошибка сервера", error: error.message });
  }
};

const getServices = async (req, res) => {
  try {
    const providerId = req.user.id;
    const result = await pool.query(
      "SELECT * FROM services WHERE provider_id = $1",
      [providerId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Ошибка получения услуг:", error.message);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const updateService = async (req, res) => {
  try {
    const providerId = req.user.id;
    const serviceId = req.params.id;

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

    const result = await pool.query(
      `UPDATE services
         SET title = $1,
             description = $2,
             price = $3,
             category = $4,
             images = $5::jsonb,
             availability = $6::jsonb,
             details = $7::jsonb
       WHERE id = $8 AND provider_id = $9
       RETURNING *`,
      [
        title,
        extended ? null : descriptionStr,
        extended ? null : priceNum,
        category,
        JSON.stringify(imagesArr),
        JSON.stringify(extended ? [] : availabilityArr),
        JSON.stringify(extended ? (detailsObj ?? {}) : {}),
        serviceId,
        providerId,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Услуга не найдена" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Ошибка обновления услуги:", error);
    res.status(500).json({ message: "Ошибка сервера", error: error.message });
  }
};

const deleteService = async (req, res) => {
  try {
    const providerId = req.user.id;
    const serviceId = req.params.id;

    const result = await pool.query(
      "DELETE FROM services WHERE id=$1 AND provider_id=$2 RETURNING *",
      [serviceId, providerId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Услуга не найдена" });
    }

    res.json({ message: "Услуга удалена" });
  } catch (error) {
    console.error("❌ Ошибка удаления услуги:", error.message);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// =====================
// Пароль
// =====================
const changeProviderPassword = async (req, res) => {
  try {
    const id = req.user.id;
    const { password } = req.body;

    if (!password || password.length < 6) {
      return res.status(400).json({ message: "Пароль должен содержать минимум 6 символов" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query("UPDATE providers SET password = $1 WHERE id = $2", [hashedPassword, id]);

    res.status(200).json({ message: "Пароль обновлён успешно" });
  } catch (error) {
    console.error("❌ Ошибка смены пароля:", error.message);
    res.status(500).json({ message: "Ошибка сервера", error: error.message });
  }
};

// =====================
// Календарь
// =====================
const getBookedDates = async (req, res) => {
  try {
    const providerId = req.user.id;

    const manual = await pool.query(
      `SELECT date FROM blocked_dates WHERE provider_id = $1 AND service_id IS NULL`,
      [providerId]
    );

    const booked = await pool.query(
      `SELECT b.date, s.title
       FROM blocked_dates b
       JOIN services s ON b.service_id = s.id
       WHERE b.provider_id = $1 AND b.service_id IS NOT NULL`,
      [providerId]
    );

    const bookedDates = [
      ...manual.rows.map((r) => ({
        date: new Date(r.date).toISOString().split("T")[0],
        serviceTitle: null,
      })),
      ...booked.rows.map((r) => ({
        date: new Date(r.date).toISOString().split("T")[0],
        serviceTitle: r.title,
      })),
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    res.json(bookedDates);
  } catch (error) {
    console.error("❌ Ошибка получения занятых дат:", error);
    res.status(500).json({ message: "calendar.load_error" });
  }
};

const saveBlockedDates = async (req, res) => {
  try {
    const providerId = req.user.id;
    const { dates } = req.body;

    if (!Array.isArray(dates)) {
      return res.status(400).json({ message: "Некорректные даты" });
    }

    await pool.query("DELETE FROM blocked_dates WHERE provider_id = $1", [providerId]);

    const insertPromises = dates.map((date) =>
      pool.query("INSERT INTO blocked_dates (provider_id, date) VALUES ($1, $2)", [providerId, date])
    );

    await Promise.all(insertPromises);

    res.json({ message: "calendar.saved_successfully" });
  } catch (error) {
    console.error("❌ Ошибка сохранения занятых дат:", error);
    res.status(500).json({ message: "calendar.save_error" });
  }
};

const updateServiceImagesOnly = async (req, res) => {
  try {
    const providerId = req.user?.providerId ?? (req.user?.role === "provider" ? req.user?.id : null);
    if (!providerId) return res.status(403).json({ message: "provider_required" });

    const serviceId = Number(req.params.id);
    if (!Number.isInteger(serviceId)) {
      return res.status(400).json({ message: "invalid_service_id" });
    }

    const raw = Array.isArray(req.body?.images) ? req.body.images : [];
    const images = raw.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 10);

    const { rows, rowCount } = await pool.query(
      `UPDATE services
       SET images = $1::jsonb
       WHERE id = $2 AND provider_id = $3
       RETURNING id, title, images`,
      [JSON.stringify(images), serviceId, providerId]
    );
    if (rowCount === 0) return res.status(404).json({ message: "service_not_found_or_forbidden" });
    res.json(rows[0]);
  } catch (e) {
    console.error("updateServiceImagesOnly error", e);
    res.status(500).json({ message: "update_images_failed" });
  }
};

// =====================
// Статистика/рейтинг поставщика
// =====================
const getProviderStats = async (req, res) => {
  try {
    const providerId = req.user?.id;
    if (!providerId) {
      return res.status(401).json({ message: "unauthorized" });
    }

    // Универсальные помощники, чтобы не падать, если таблицы/статусы отличаются
    const safeCount = async (sql, params = []) => {
      try {
        const r = await pool.query(sql, params);
        const v = r.rows?.[0]?.count ?? r.rows?.[0]?.c ?? 0;
        return Number(v) || 0;
      } catch (e) {
        // логируем, но не валим весь ответ
        console.warn("getProviderStats count error:", e.message);
        return 0;
      }
    };

    // Запросы (requests)
    const requestsTotal = await safeCount(
      "SELECT COUNT(*) FROM requests WHERE provider_id = $1",
      [providerId]
    );
    const requestsActive = await safeCount(
      `SELECT COUNT(*) FROM requests
         WHERE provider_id = $1
           AND status IN ('new','pending','open','active','accepted','in_progress')`,
      [providerId]
    );

    // Бронирования (bookings)
    const bookingsTotal = await safeCount(
      "SELECT COUNT(*) FROM bookings WHERE provider_id = $1",
      [providerId]
    );
    const completed = await safeCount(
      `SELECT COUNT(*) FROM bookings
         WHERE provider_id = $1 AND status IN ('completed','confirmed','done')`,
      [providerId]
    );
    const cancelled = await safeCount(
      `SELECT COUNT(*) FROM bookings
         WHERE provider_id = $1 AND status IN ('cancelled','rejected','canceled')`,
      [providerId]
    );

    // Рейтинг/уровень — пробуем взять из providers, иначе дефолт
    let rating = 0;
    let tier = "Bronze";
    try {
      const r = await pool.query(
        "SELECT rating, tier FROM providers WHERE id = $1",
        [providerId]
      );
      rating = Number(r.rows?.[0]?.rating) || 3.0;
      tier = r.rows?.[0]?.tier || "Bronze";
    } catch (e) {
      console.warn("getProviderStats rating error:", e.message);
    }

    res.json({
      rating,
      tier,
      requests_total: requestsTotal,
      requests_active: requestsActive,
      bookings_total: bookingsTotal,
      completed,
      cancelled,
    });
  } catch (err) {
    console.error("❌ getProviderStats:", err.message);
    res.status(500).json({ message: "server_error" });
  }
};



module.exports = {
  registerProvider,
  loginProvider,
  getProviderProfile,
  updateProviderProfile,
  addService,
  getServices,
  updateService,
  deleteService,
  changeProviderPassword,
  getBookedDates,
  saveBlockedDates,
  updateServiceImagesOnly,
  getProviderStats,
};
