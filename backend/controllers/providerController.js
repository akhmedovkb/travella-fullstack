const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

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

// ДОБАВИТЬ УСЛУГУ
const addService = async (req, res) => {
  try {
    const providerId = req.user.id;
    const { title, description, price, category, images, availability, details } = req.body;

    const isExtended = category === "refused_tour" || category === "author_tour" || category === "refused_hotel";

    const result = await pool.query(
      `INSERT INTO services 
       (provider_id, title, description, price, category, images, availability, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        providerId,
        title,
        isExtended ? null : description,
        isExtended ? null : price,
        category,
        images || [],
        isExtended ? null : availability,
        isExtended ? details : null
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("❌ Ошибка добавления услуги:", error.message);
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
    const { title, description, price, category, images, availability, details } = req.body;

    const result = await pool.query(
      `UPDATE services 
       SET title=$1, description=$2, price=$3, category=$4, images=$5, availability=$6, details=$7
       WHERE id=$8 AND provider_id=$9 RETURNING *`,
      [title, description, price, category, images, availability, details, serviceId, providerId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Услуга не найдена" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Ошибка обновления услуги:", error.message);
    res.status(500).json({ message: "Ошибка сервера" });
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

// ⬇️ Получение всех занятых дат (вручную + бронирования)
const getBookedDates = async (req, res) => {
  try {
    const providerId = req.user.id;

    // 1. Вручную заблокированные даты (без привязки к услуге)
    const manual = await pool.query(
      `SELECT date FROM blocked_dates WHERE provider_id = $1 AND service_id IS NULL`,
      [providerId]
    );

    // 2. Даты с бронированиями по конкретным услугам
    const booked = await pool.query(
      `SELECT b.date, s.title
       FROM blocked_dates b
       JOIN services s ON b.service_id = s.id
       WHERE b.provider_id = $1 AND b.service_id IS NOT NULL`,
      [providerId]
    );

    // 3. Объединяем обе группы
    const bookedDates = [
      ...manual.rows.map((r) => ({
        date: new Date(r.date).toISOString().split("T")[0],
        serviceTitle: null,
      })),
      ...booked.rows.map((r) => ({
        date: new Date(r.date).toISOString().split("T")[0],
        serviceTitle: r.title,
      })),
    ];

    console.log("📌 Заблокированные даты:", bookedDates);

    res.json(bookedDates);
  } catch (error) {
    console.error("❌ Ошибка получения занятых дат:", error);
    res.status(500).json({ message: "calendar.load_error" });
  }
};

// ⬇️ Получение вручную заблокированных дат (без бронирований)
const getBlockedDates = async (req, res) => {
  try {
    const providerId = req.user.id;

    const result = await pool.query(
      `SELECT date FROM blocked_dates WHERE provider_id = $1 AND service_id IS NULL`,
      [providerId]
    );

    const blockedDates = result.rows.map((row) => ({
      date: new Date(row.date).toISOString().split("T")[0],
    }));

    res.json(blockedDates);
  } catch (error) {
    console.error("❌ Ошибка получения заблокированных дат:", error);
    res.status(500).json({ message: "calendar.load_error" });
  }
};

// ⬇️ Сохранение вручную заблокированных дат
const saveBlockedDates = async (req, res) => {
  try {
    const providerId = req.user.id;
    const { dates } = req.body;

    if (!Array.isArray(dates)) {
      return res.status(400).json({ message: "Некорректные даты" });
    }

    console.log("📥 Получены даты для сохранения:", dates);

    await pool.query(
      "DELETE FROM blocked_dates WHERE provider_id = $1 AND service_id IS NULL",
      [providerId]
    );

    const formattedDates = dates.map((d) => new Date(d).toISOString().split("T")[0]);

    if (formattedDates.length > 0) {
      const insertQuery = `
        INSERT INTO blocked_dates (provider_id, date)
        VALUES ${formattedDates.map((_, i) => `($1, $${i + 2})`).join(", ")}
      `;
      const insertParams = [providerId, ...formattedDates];
      await pool.query(insertQuery, insertParams);
    }

    res.json({ message: "calendar.saved_successfully" });
  } catch (error) {
    console.error("❌ Ошибка сохранения занятых дат:", error);
    res.status(500).json({ message: "calendar.save_error" });
  }
};


    // ⬇️ Разблокировка заблокированных поставщиком в ручную дат

const unblockDate = async (req, res) => {
  const providerId = req.provider.id;
  const { date } = req.body;

  try {
    await pool.query(
      "DELETE FROM blocked_dates WHERE provider_id = $1 AND date = $2 AND service_id IS NULL",
      [providerId, date]
    );
    res.json({ message: "Дата разблокирована" });
  } catch (err) {
    console.error("Ошибка при разблокировке даты", err);
    res.status(500).json({ message: "Ошибка при разблокировке даты" });
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
  getBlockedDates,
  saveBlockedDates,
  unblockDate
};
