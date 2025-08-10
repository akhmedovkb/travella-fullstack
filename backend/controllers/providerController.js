// backend/controllers/providerController.js
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

// 📌 Регистрация поставщика
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
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name, email, hashedPassword, type, location, phone, social || null, photo || null, address || null]
    );

    const token = jwt.sign({ id: newProvider.rows[0].id }, process.env.JWT_SECRET, { expiresIn: "7d" });

    res.json({ token, provider: newProvider.rows[0] });
  } catch (error) {
    console.error("Ошибка регистрации:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// 📌 Логин поставщика
const loginProvider = async (req, res) => {
  try {
    const { email, password } = req.body;

    const provider = await pool.query("SELECT * FROM providers WHERE email = $1", [email]);
    if (provider.rows.length === 0) {
      return res.status(400).json({ message: "Неверный email или пароль" });
    }

    const validPassword = await bcrypt.compare(password, provider.rows[0].password);
    if (!validPassword) {
      return res.status(400).json({ message: "Неверный email или пароль" });
    }

    const token = jwt.sign({ id: provider.rows[0].id }, process.env.JWT_SECRET, { expiresIn: "7d" });

    res.json({ token, provider: provider.rows[0] });
  } catch (error) {
    console.error("Ошибка логина:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// 📌 Получить профиль поставщика
const getProviderProfile = async (req, res) => {
  try {
    const provider = await pool.query("SELECT * FROM providers WHERE id = $1", [req.user.id]);
    if (provider.rows.length === 0) {
      return res.status(404).json({ message: "Провайдер не найден" });
    }
    res.json(provider.rows[0]);
  } catch (error) {
    console.error("Ошибка загрузки профиля:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// 📌 Обновить профиль поставщика
const updateProviderProfile = async (req, res) => {
  try {
    const { name, location, phone, social, photo, address, password } = req.body;

    let updateFields = { name, location, phone, social, photo, address };
    let queryParts = [];
    let values = [];
    let index = 1;

    for (let key in updateFields) {
      if (updateFields[key] !== undefined) {
        queryParts.push(`${key} = $${index}`);
        values.push(updateFields[key]);
        index++;
      }
    }

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      queryParts.push(`password = $${index}`);
      values.push(hashedPassword);
      index++;
    }

    if (queryParts.length === 0) {
      return res.status(400).json({ message: "Нет данных для обновления" });
    }

    values.push(req.user.id);

    const updated = await pool.query(
      `UPDATE providers SET ${queryParts.join(", ")} WHERE id = $${index} RETURNING *`,
      values
    );

    res.json(updated.rows[0]);
  } catch (error) {
    console.error("Ошибка обновления профиля:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// 📌 Получить все услуги поставщика
const getProviderServices = async (req, res) => {
  try {
    const services = await pool.query("SELECT * FROM services WHERE provider_id = $1", [req.user.id]);
    res.json(services.rows);
  } catch (error) {
    console.error("Ошибка получения услуг:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// 📌 Добавить услугу
const addService = async (req, res) => {
  try {
    const { title, description, category, price, images, details, availability } = req.body;

    const newService = await pool.query(
      `INSERT INTO services (provider_id, title, description, category, price, images, details, availability, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [
        req.user.id,
        title,
        description,
        category,
        price,
        images || [],
        details || {},
        availability || [],
        "draft"
      ]
    );

    res.json(newService.rows[0]);
  } catch (error) {
    console.error("Ошибка добавления услуги:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// 📌 Обновить услугу
const updateService = async (req, res) => {
  try {
    const { title, description, category, price, images, details, availability, status } = req.body;

    const updated = await pool.query(
      `UPDATE services SET title=$1, description=$2, category=$3, price=$4, images=$5, details=$6, availability=$7, status=$8
       WHERE id = $9 AND provider_id = $10 RETURNING *`,
      [
        title,
        description,
        category,
        price,
        images || [],
        details || {},
        availability || [],
        status || "draft",
        req.params.id,
        req.user.id
      ]
    );

    res.json(updated.rows[0]);
  } catch (error) {
    console.error("Ошибка обновления услуги:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// 📌 Удалить услугу
const deleteService = async (req, res) => {
  try {
    await pool.query("DELETE FROM services WHERE id = $1 AND provider_id = $2", [
      req.params.id,
      req.user.id
    ]);
    res.json({ message: "Услуга удалена" });
  } catch (error) {
    console.error("Ошибка удаления услуги:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// 📌 Заблокированные даты
const updateBlockedDates = async (req, res) => {
  try {
    const { add, remove } = req.body;

    if (add && add.length > 0) {
      for (let date of add) {
        await pool.query(
          `INSERT INTO blocked_dates (provider_id, date) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [req.user.id, date]
        );
      }
    }

    if (remove && remove.length > 0) {
      for (let date of remove) {
        await pool.query(`DELETE FROM blocked_dates WHERE provider_id = $1 AND date = $2`, [
          req.user.id,
          date
        ]);
      }
    }

    res.json({ message: "Даты обновлены" });
  } catch (error) {
    console.error("Ошибка обновления дат:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

module.exports = {
  registerProvider,
  loginProvider,
  getProviderProfile,
  updateProviderProfile,
  getProviderServices,
  addService,
  updateService,
  deleteService,
  updateBlockedDates
};
