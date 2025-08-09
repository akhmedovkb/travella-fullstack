const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const ics = require("ics"); // 📅 Для интеграции с внешним календарём

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
    await pool.query(
      `INSERT INTO providers (name, email, password, type, location, phone, social, photo, address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [name, email, hashedPassword, type, location, phone, social, photo, address]
    );

    res.status(201).json({ message: "Поставщик зарегистрирован" });
  } catch (err) {
    console.error("Ошибка регистрации поставщика:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// 📌 Логин поставщика
const loginProvider = async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query("SELECT * FROM providers WHERE email = $1", [email]);

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Неверный email или пароль" });
    }

    const provider = result.rows[0];
    const validPassword = await bcrypt.compare(password, provider.password);
    if (!validPassword) {
      return res.status(400).json({ message: "Неверный email или пароль" });
    }

    const token = jwt.sign({ id: provider.id, role: "provider" }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.json({ token });
  } catch (err) {
    console.error("Ошибка входа:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// 📌 Профиль
const getProviderProfile = async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM providers WHERE id = $1", [req.user.id]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Ошибка получения профиля:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const updateProviderProfile = async (req, res) => {
  try {
    const { name, location, phone, social, photo, address } = req.body;
    await pool.query(
      `UPDATE providers SET name=$1, location=$2, phone=$3, social=$4, photo=$5, address=$6 WHERE id=$7`,
      [name, location, phone, social, photo, address, req.user.id]
    );
    res.json({ message: "Профиль обновлён" });
  } catch (err) {
    console.error("Ошибка обновления профиля:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// 📌 Изменение пароля
const changeProviderPassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const result = await pool.query("SELECT * FROM providers WHERE id = $1", [req.user.id]);
    const provider = result.rows[0];

    const isMatch = await bcrypt.compare(oldPassword, provider.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Старый пароль неверный" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE providers SET password = $1 WHERE id = $2", [hashedPassword, req.user.id]);
    res.json({ message: "Пароль изменён" });
  } catch (err) {
    console.error("Ошибка изменения пароля:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// 📌 CRUD услуг
const addService = async (req, res) => {
  try {
    const { title, description, price, category, images, availability, details } = req.body;
    await pool.query(
      `INSERT INTO services (provider_id, title, description, price, category, images, availability, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [req.user.id, title, description, price, category, images, availability, details]
    );
    res.status(201).json({ message: "Услуга добавлена" });
  } catch (err) {
    console.error("Ошибка добавления услуги:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const getServices = async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM services WHERE provider_id = $1", [req.user.id]);
    res.json(result.rows);
  } catch (err) {
    console.error("Ошибка получения услуг:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const updateService = async (req, res) => {
  try {
    const { title, description, price, category, images, availability, details } = req.body;
    await pool.query(
      `UPDATE services SET title=$1, description=$2, price=$3, category=$4, images=$5, availability=$6, details=$7 WHERE id=$8 AND provider_id=$9`,
      [title, description, price, category, images, availability, details, req.params.id, req.user.id]
    );
    res.json({ message: "Услуга обновлена" });
  } catch (err) {
    console.error("Ошибка обновления услуги:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const deleteService = async (req, res) => {
  try {
    await pool.query("DELETE FROM services WHERE id = $1 AND provider_id = $2", [req.params.id, req.user.id]);
    res.json({ message: "Услуга удалена" });
  } catch (err) {
    console.error("Ошибка удаления услуги:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// 📌 Занятые даты
const getBookedDates = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT date FROM bookings WHERE provider_id = $1",
      [req.user.id]
    );
    res.json(result.rows.map((row) => row.date));
  } catch (err) {
    console.error("Ошибка получения занятых дат:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// 📌 Заблокированные даты
const getBlockedDates = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT date, reason FROM blocked_dates WHERE provider_id = $1",
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Ошибка получения заблокированных дат:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const saveBlockedDates = async (req, res) => {
  try {
    const { add, remove } = req.body;

    if (Array.isArray(add) && add.length > 0) {
      for (const dateObj of add) {
        await pool.query(
          "INSERT INTO blocked_dates (provider_id, date, reason) VALUES ($1, $2, $3)",
          [req.user.id, dateObj.date, dateObj.reason || null]
        );
      }
    }

    if (Array.isArray(remove) && remove.length > 0) {
      for (const date of remove) {
        await pool.query(
          "DELETE FROM blocked_dates WHERE provider_id = $1 AND date = $2",
          [req.user.id, date]
        );
      }
    }

    res.json({ message: "Изменения сохранены" });
  } catch (err) {
    console.error("Ошибка сохранения дат:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// 📅 Экспорт заблокированных дат в .ics
const exportBlockedDatesICS = async (req, res) => {
  try {
    const providerId = req.user.id;

    const result = await pool.query(
      "SELECT date, reason FROM blocked_dates WHERE provider_id = $1 ORDER BY date ASC",
      [providerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Нет заблокированных дат" });
    }

    const events = result.rows.map((row) => {
      const [year, month, day] = row.date.split("-").map(Number);
      return {
        start: [year, month, day],
        title: "День заблокирован",
        description: row.reason || "Недоступно для бронирования",
      };
    });

    ics.createEvents(events, (error, value) => {
      if (error) {
        console.error("Ошибка создания ICS:", error);
        return res.status(500).json({ message: "Ошибка генерации календаря" });
      }
      res.setHeader("Content-Type", "text/calendar");
      res.setHeader("Content-Disposition", "attachment; filename=blocked-dates.ics");
      res.send(value);
    });
  } catch (err) {
    console.error("Ошибка экспорта ICS:", err);
    res.status(500).json({ message: "Ошибка сервера" });
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
  exportBlockedDatesICS
};
