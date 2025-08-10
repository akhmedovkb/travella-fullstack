const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

// 👉 Регистрация
const registerProvider = async (req, res) => {
  try {
    const { name, email, password, type, location, phone, social, photo, address } = req.body;

    if (!name || !email || !password || !type || !location || !phone) {
      return res.status(400).json({ message: "Заполните все обязательные поля" });
    }

    const existing = await pool.query("SELECT * FROM providers WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: "Email уже используется" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newProvider = await pool.query(
      `INSERT INTO providers (name, email, password, type, location, phone, social, photo, address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [name, email, hashedPassword, type, location, phone, social, photo || null, address || null]
    );

    const token = jwt.sign({ id: newProvider.rows[0].id }, process.env.JWT_SECRET);
    res.status(201).json({ token });
  } catch (error) {
    console.error("Ошибка регистрации:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// 👉 Логин
const loginProvider = async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query("SELECT * FROM providers WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Неверные учетные данные" });
    }

    const provider = result.rows[0];
    const valid = await bcrypt.compare(password, provider.password);
    if (!valid) {
      return res.status(400).json({ message: "Неверные учетные данные" });
    }

    const token = jwt.sign({ id: provider.id }, process.env.JWT_SECRET);
    res.json({ token });
  } catch (error) {
    console.error("Ошибка входа:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// 👉 Получить профиль
const getProviderProfile = async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM providers WHERE id = $1", [req.user.id]);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Ошибка загрузки профиля" });
  }
};

// 👉 Обновить профиль
const updateProviderProfile = async (req, res) => {
  try {
    const { name, location, phone, social, photo, address } = req.body;
    await pool.query(
      `UPDATE providers SET name = $1, location = $2, phone = $3, social = $4, photo = $5, address = $6 WHERE id = $7`,
      [name, location, phone, social, photo, address, req.user.id]
    );
    res.json({ message: "Профиль обновлён" });
  } catch (error) {
    res.status(500).json({ message: "Ошибка обновления профиля" });
  }
};

// 👉 Смена пароля
const changeProviderPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const result = await pool.query("SELECT * FROM providers WHERE id = $1", [req.user.id]);

    const valid = await bcrypt.compare(currentPassword, result.rows[0].password);
    if (!valid) {
      return res.status(400).json({ message: "Неверный текущий пароль" });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE providers SET password = $1 WHERE id = $2", [hashed, req.user.id]);
    res.json({ message: "Пароль обновлён" });
  } catch (error) {
    res.status(500).json({ message: "Ошибка при смене пароля" });
  }
};

// 👉 Добавить услугу

// 👉 Добавить услугу (jsonb: images/availability/details)
const addService = async (req, res) => {
  try {
    const {
      title = "",
      description = "",
      price = 0,
      category = "",
      images,
      availability,
      details,
    } = req.body;

    // Нормализация входных данных
    const imgs = Array.isArray(images)
      ? images
      : images ? [images] : []; // допускаем одиночную строку base64

    const avail = Array.isArray(availability) ? availability : [];
    const det = details && typeof details === "object" ? details : {};

    await pool.query(
      `
      INSERT INTO services
        (provider_id, title, description, price, category, images, availability, details)
      VALUES
        ($1,         $2,    $3,          $4,   $5,       $6::jsonb, $7::jsonb,  $8::jsonb)
      `,
      [
        req.user.id,
        title,
        description,
        price,
        category,
        JSON.stringify(imgs),   // -> jsonb
        JSON.stringify(avail),  // -> jsonb
        JSON.stringify(det),    // -> jsonb
      ]
    );

    res.status(201).json({ message: "Услуга добавлена" });
  } catch (error) {
    console.error("Ошибка при добавлении услуги:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};


    res.status(201).json({ message: "Услуга добавлена" });
  } catch (error) {
    console.error("Ошибка при добавлении услуги:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};



// 👉 Получить услуги
const getServices = async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM services WHERE provider_id = $1", [req.user.id]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ message: "Ошибка загрузки услуг" });
  }
};

// 👉 Обновить услугу
const updateService = async (req, res) => {
  try {
    const { id } = req.params;

    // что прислал клиент (могут быть undefined — тогда не трогаем поле)
    const {
      title,
      description,
      price,
      category,
      images,
      availability,
      details,
    } = req.body;

    // флаги «поле прислали»
    const hasImages = typeof images !== "undefined";
    const hasAvailability = typeof availability !== "undefined";
    const hasDetails = typeof details !== "undefined";

    // нормализация тех, что прислали
    const imgs = hasImages
      ? (Array.isArray(images) ? images : images ? [images] : [])
      : null;

    const avail = hasAvailability
      ? (Array.isArray(availability) ? availability : [])
      : null;

    const det = hasDetails
      ? (details && typeof details === "object" ? details : {})
      : null;

    const result = await pool.query(
      `
      UPDATE services
      SET
        title        = COALESCE($2, title),
        description  = COALESCE($3, description),
        price        = COALESCE($4, price),
        category     = COALESCE($5, category),
        images       = COALESCE($6::jsonb, images),
        availability = COALESCE($7::jsonb, availability),
        details      = COALESCE($8::jsonb, details)
      WHERE id = $1 AND provider_id = $9
      `,
      [
        id,
        title ?? null,
        description ?? null,
        typeof price !== "undefined" ? price : null,
        category ?? null,
        hasImages ? JSON.stringify(imgs) : null,
        hasAvailability ? JSON.stringify(avail) : null,
        hasDetails ? JSON.stringify(det) : null,
        req.user.id,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Услуга не найдена" });
    }

    res.json({ message: "Услуга обновлена" });
  } catch (error) {
    console.error("Ошибка при обновлении услуги:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};



// 👉 Удалить услугу
const deleteService = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM services WHERE id = $1 AND provider_id = $2", [
      id,
      req.user.id,
    ]);
    res.json({ message: "Услуга удалена" });
  } catch (error) {
    res.status(500).json({ message: "Ошибка при удалении услуги" });
  }
};

// 👉 Получить занятые даты (бронирования)
const getBookedDates = async (req, res) => {
  try {
    const providerId = req.user.id;
    const result = await pool.query(
      "SELECT date FROM bookings WHERE provider_id = $1",
      [providerId]
    );

    const bookedDates = result.rows.map((row) => new Date(row.date));
    res.json(bookedDates);
  } catch (error) {
    console.error("Ошибка получения занятых дат:", error);
    res.status(500).json({ message: "Ошибка загрузки" });
  }
};

// 👉 Получить заблокированные вручную даты
const getBlockedDates = async (req, res) => {
  try {
    const providerId = req.user.id;
    const result = await pool.query(
      "SELECT date FROM blocked_dates WHERE provider_id = $1 AND service_id IS NULL",
      [providerId]
    );
    const blockedDates = result.rows.map((row) => row.date.toISOString().split("T")[0]);
    res.json(blockedDates);
  } catch (error) {
    console.error("Ошибка получения заблокированных дат:", error);
    res.status(500).json({ message: "calendar.load_error" });
  }
};

// ✅ Сохранить вручную заблокированные даты (add/remove)
const saveBlockedDates = async (req, res) => {
  const providerId = req.user.id;
  const { add = [], remove = [] } = req.body;

  try {
    if (remove.length > 0) {
      await pool.query(
        "DELETE FROM blocked_dates WHERE provider_id = $1 AND date = ANY($2::date[])",
        [providerId, remove]
      );
    }

    for (const date of add) {
      await pool.query(
        "INSERT INTO blocked_dates (provider_id, date) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [providerId, date]
      );
    }

    res.status(200).json({ message: "Даты успешно обновлены." });
  } catch (error) {
    console.error("Ошибка сохранения дат:", error);
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
