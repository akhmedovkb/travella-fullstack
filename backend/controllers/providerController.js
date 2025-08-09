const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

/* =========================
   Helpers
========================= */
const sign = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET || "dev_secret", { expiresIn: "30d" });

/* =========================
   Auth
========================= */
// Регистрация
const registerProvider = async (req, res) => {
  try {
    const { name, email, password, type, location, phone, social, photo, address } = req.body;

    if (!name || !email || !password || !type || !location || !phone) {
      return res.status(400).json({ message: "Заполните все обязательные поля" });
    }

    const existing = await pool.query("SELECT 1 FROM providers WHERE email=$1", [email]);
    if (existing.rows.length) {
      return res.status(400).json({ message: "Email уже используется" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const ins = await pool.query(
      `INSERT INTO providers (name,email,password,type,location,phone,social,photo,address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [name, email, hashed, type, location, phone, social || null, photo || null, address || null]
    );

    const token = sign({ id: ins.rows[0].id });
    res.status(201).json({ token });
  } catch (e) {
    console.error("Ошибка регистрации:", e);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// Логин
const loginProvider = async (req, res) => {
  try {
    const { email, password } = req.body;
    const q = await pool.query("SELECT * FROM providers WHERE email=$1", [email]);
    if (!q.rows.length) return res.status(400).json({ message: "Неверные учетные данные" });

    const provider = q.rows[0];
    const ok = await bcrypt.compare(password, provider.password);
    if (!ok) return res.status(400).json({ message: "Неверные учетные данные" });

    const token = sign({ id: provider.id });
    res.json({ token });
  } catch (e) {
    console.error("Ошибка входа:", e);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

/* =========================
   Profile
========================= */
const getProviderProfile = async (req, res) => {
  try {
    const q = await pool.query("SELECT * FROM providers WHERE id=$1", [req.user.id]);
    res.json(q.rows[0]);
  } catch (e) {
    res.status(500).json({ message: "Ошибка загрузки профиля" });
  }
};

const updateProviderProfile = async (req, res) => {
  try {
    const { name, location, phone, social, photo, address } = req.body;
    await pool.query(
      `UPDATE providers
       SET name=$1, location=$2, phone=$3, social=$4, photo=$5, address=$6
       WHERE id=$7`,
      [name, location, phone, social, photo, address, req.user.id]
    );
    res.json({ message: "Профиль обновлён" });
  } catch (e) {
    res.status(500).json({ message: "Ошибка обновления профиля" });
  }
};

const changeProviderPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const q = await pool.query("SELECT password FROM providers WHERE id=$1", [req.user.id]);
    const ok = await bcrypt.compare(currentPassword, q.rows[0].password);
    if (!ok) return res.status(400).json({ message: "Неверный текущий пароль" });

    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE providers SET password=$1 WHERE id=$2", [hashed, req.user.id]);
    res.json({ message: "Пароль обновлён" });
  } catch (e) {
    res.status(500).json({ message: "Ошибка при смене пароля" });
  }
};

/* =========================
   Services
   images: text[]  (ВАЖНО!)
   availability/details: JSON/JSONB
========================= */
// Добавить услугу
const addService = async (req, res) => {
  try {
    const { title, description, price, category, images, availability, details } = req.body;

    // images — массив строк (base64). НИКАКОГО stringify.
    const imgPayload = Array.isArray(images) ? images : [];

    await pool.query(
      `INSERT INTO services
       (provider_id, title, description, price, category, images, availability, details)
       VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8)`,
      [
        req.user.id,
        title,
        description,
        price != null ? Number(price) : null,
        category,
        imgPayload, // <-- массив
        JSON.stringify(availability || []),
        details ? JSON.stringify(details) : null,
      ]
    );

    res.status(201).json({ message: "Услуга добавлена" });
  } catch (e) {
    console.error("Ошибка при добавлении услуги:", e);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// Получить услуги текущего провайдера
const getServices = async (req, res) => {
  try {
    const q = await pool.query("SELECT * FROM services WHERE provider_id=$1 ORDER BY created_at DESC", [
      req.user.id,
    ]);
    res.json(q.rows);
  } catch (e) {
    res.status(500).json({ message: "Ошибка загрузки услуг" });
  }
};

// Обновить услугу
const updateService = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, price, category, images, availability, details } = req.body;

    const imgParam = images !== undefined ? (Array.isArray(images) ? images : []) : null;

    await pool.query(
      `UPDATE services
       SET title=COALESCE($1,title),
           description=COALESCE($2,description),
           price=COALESCE($3,price),
           category=COALESCE($4,category),
           images=COALESCE($5::text[], images),
           availability=COALESCE($6, availability),
           details=COALESCE($7, details),
           updated_at=NOW()
       WHERE id=$8 AND provider_id=$9`,
      [
        title ?? null,
        description ?? null,
        price !== undefined ? Number(price) : null,
        category ?? null,
        imgParam, // <-- массив
        JSON.stringify(availability || []),
        details ? JSON.stringify(details) : null,
        id,
        req.user.id,
      ]
    );

    res.json({ message: "Услуга обновлена" });
  } catch (e) {
    console.error("Ошибка при обновлении услуги:", e);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// Удалить услугу
const deleteService = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM services WHERE id=$1 AND provider_id=$2", [id, req.user.id]);
    res.json({ message: "Услуга удалена" });
  } catch (e) {
    res.status(500).json({ message: "Ошибка при удалении услуги" });
  }
};

/* =========================
   Calendar
========================= */
// Занятые даты из бронирований
const getBookedDates = async (req, res) => {
  try {
    const providerId = req.user.id;
    const q = await pool.query("SELECT date FROM bookings WHERE provider_id=$1", [providerId]);
    res.json(q.rows.map((r) => new Date(r.date)));
  } catch (e) {
    console.error("Ошибка получения занятых дат:", e);
    res.status(500).json({ message: "Ошибка загрузки" });
  }
};

// Заблокированные вручную даты
const getBlockedDates = async (req, res) => {
  try {
    const providerId = req.user.id;
    const q = await pool.query(
      "SELECT date FROM blocked_dates WHERE provider_id=$1 AND service_id IS NULL",
      [providerId]
    );
    res.json(q.rows.map((r) => r.date.toISOString().split("T")[0]));
  } catch (e) {
    console.error("Ошибка получения заблокированных дат:", e);
    res.status(500).json({ message: "calendar.load_error" });
  }
};

// Сохранить add/remove
const saveBlockedDates = async (req, res) => {
  const providerId = req.user.id;
  const { add = [], remove = [] } = req.body;

  try {
    if (remove.length) {
      await pool.query(
        "DELETE FROM blocked_dates WHERE provider_id=$1 AND date = ANY($2::date[])",
        [providerId, remove]
      );
    }

    for (const d of add) {
      await pool.query(
        "INSERT INTO blocked_dates (provider_id, date) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [providerId, d]
      );
    }

    res.status(200).json({ message: "Даты успешно обновлены." });
  } catch (e) {
    console.error("Ошибка сохранения дат:", e);
    res.status(500).json({ message: "Ошибка при сохранении дат." });
  }
};

module.exports = {
  registerProvider,
  loginProvider,
  getProviderProfile,
  updateProviderProfile,
  changeProviderPassword,
  addService,
  getServices,
  updateService,
  deleteService,
  getBookedDates,
  getBlockedDates,
  saveBlockedDates,
};
