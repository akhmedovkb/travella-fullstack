const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const registerProvider = async (req, res) => {
  try {
    console.log("📦 Получено тело запроса:", req.body);
    const { name, email, password, type, location, phone, social, photo } = req.body;

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
      `INSERT INTO providers (name, email, password, type, location, phone, social, photo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, email`,
      [name, email, hashedPassword, type, [location], phone, social, photo]
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

// 👇 ДОБАВЛЕНО:
const getProviderProfile = async (req, res) => {
  try {
    const id = req.user.id;
    const result = await pool.query(
      "SELECT id, name, email, type, location, phone, social, photo FROM providers WHERE id = $1",
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
    const { name, location, phone, social, photo } = req.body;

    await pool.query(
      `UPDATE providers
       SET name = $1, location = $2, phone = $3, social = $4, photo = $5
       WHERE id = $6`,
      [name, location, phone, social, photo, id]
    );

    res.status(200).json({ message: "Профиль обновлён успешно" });
  } catch (error) {
    console.error("❌ Ошибка обновления профиля:", error.message);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// ДОБАВИТЬ УСЛУГУ
const addService = async (req, res) => {
  try {
    const providerId = req.user.id;
    const { title, description, price, category, images, availability } = req.body;

    const result = await pool.query(
      `INSERT INTO services (provider_id, title, description, price, category, images, availability)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [providerId, title, description, price, category, images, availability]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("❌ Ошибка добавления услуги:", error.message);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// ПОЛУЧИТЬ УСЛУГИ ПОСТАВЩИКА
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

// ОБНОВИТЬ УСЛУГУ
const updateService = async (req, res) => {
  try {
    const providerId = req.user.id;
    const serviceId = req.params.id;
    const { title, description, price, category, images, availability } = req.body;

    const result = await pool.query(
      `UPDATE services SET title=$1, description=$2, price=$3, category=$4, images=$5, availability=$6
       WHERE id=$7 AND provider_id=$8 RETURNING *`,
      [title, description, price, category, images, availability, serviceId, providerId]
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

// УДАЛИТЬ УСЛУГУ
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


// 👇 Обновляем экспорт:
module.exports = {
  registerProvider,
  loginProvider,
  getProviderProfile,
  updateProviderProfile,
  addService,
  getServices,
  updateService,
  deleteService,
};
