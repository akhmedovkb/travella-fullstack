const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const ics = require("ics");

// =======================
// Аутентификация
// =======================

const registerProvider = async (req, res) => {
  try {
    const { name, email, password, type, location, phone, social, photo, address } = req.body;

    if (!name || !email || !password || !type || !location || !phone) {
      return res.status(400).json({ message: "Заполните все обязательные поля" });
    }

    const existingProvider = await pool.query("SELECT * FROM providers WHERE email = $1", [email]);
    if (existingProvider.rows.length > 0) {
      return res.status(400).json({ message: "Email уже используется" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO providers (name, email, password, type, location, phone, social, photo, address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [name, email, hashedPassword, type, location, phone, social || "", photo || "", address || ""]
    );

    res.status(201).json({ message: "Регистрация успешна" });
  } catch (err) {
    console.error("Ошибка регистрации поставщика:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const loginProvider = async (req, res) => {
  try {
    const { email, password } = req.body;
    const result = await pool.query("SELECT * FROM providers WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Неверный email или пароль" });
    }

    const provider = result.rows[0];
    const isMatch = await bcrypt.compare(password, provider.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Неверный email или пароль" });
    }

    const token = jwt.sign({ id: provider.id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.json({ token });
  } catch (err) {
    console.error("Ошибка входа:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// =======================
// Профиль
// =======================

const getProviderProfile = async (req, res) => {
  try {
    const provider = await pool.query(
      "SELECT id, name, email, type, location, phone, social, photo, address FROM providers WHERE id = $1",
      [req.user.id]
    );
    res.json(provider.rows[0]);
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

// =======================
// Услуги
// =======================

const addService = async (req, res) => {
  try {
    const { title, description, price, category, images, availability, details, status } = req.body;
    await pool.query(
      `INSERT INTO services (provider_id, title, description, price, category, images, availability, details, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [req.user.id, title, description, price, category, images || [], availability || [], details || {}, status || "draft"]
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

// =======================
// Календарь: забронированные даты
// =======================

const getBookedDates = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT date FROM bookings WHERE provider_id = $1",
      [req.user.id]
    );
    res.json(result.rows.map(r => r.date));
  } catch (err) {
    console.error("Ошибка получения забронированных дат:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// =======================
// Календарь: заблокированные даты
// =======================

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

    if (Array.isArray(add)) {
      for (const d of add) {
        await pool.query(
          "INSERT INTO blocked_dates (provider_id, date, reason) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
          [req.user.id, d.date, d.reason || null]
        );
        await pool.query(
          "INSERT INTO blocked_dates_history (provider_id, date, action, reason) VALUES ($1, $2, 'block', $3)",
          [req.user.id, d.date, d.reason || null]
        );
      }
    }

    if (Array.isArray(remove)) {
      for (const d of remove) {
        await pool.query(
          "DELETE FROM blocked_dates WHERE provider_id=$1 AND date=$2",
          [req.user.id, d]
        );
        await pool.query(
          "INSERT INTO blocked_dates_history (provider_id, date, action) VALUES ($1, $2, 'unblock')",
          [req.user.id, d]
        );
      }
    }

    res.json({ message: "Изменения сохранены" });
  } catch (err) {
    console.error("Ошибка сохранения дат:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// =======================
// История
// =======================

const getBlockedDatesHistory = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT date, action, reason, created_at FROM blocked_dates_history WHERE provider_id = $1 ORDER BY created_at DESC",
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Ошибка получения истории:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// =======================
// Экспорт в .ics
// =======================

const exportBlockedDatesICS = async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT date, reason FROM blocked_dates WHERE provider_id = $1",
      [req.user.id]
    );

    const events = result.rows.map(r => ({
      start: r.date.toISOString().split("T")[0].split("-").map(n => parseInt(n, 10)),
      duration: { days: 1 },
      title: r.reason ? `Blocked: ${r.reason}` : "Blocked Date",
    }));

    ics.createEvents(events, (error, value) => {
      if (error) {
        console.error(error);
        return res.status(500).json({ message: "Ошибка генерации календаря" });
      }
      res.setHeader("Content-Type", "text/calendar");
      res.setHeader("Content-Disposition", 'attachment; filename="blocked_dates.ics"');
      res.send(value);
    });
  } catch (err) {
    console.error("Ошибка экспорта .ics:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

module.exports = {
  registerProvider,
  loginProvider,
  getProviderProfile,
  updateProviderProfile,
  addService,
  getServices,
  getBookedDates,
  getBlockedDates,
  saveBlockedDates,
  getBlockedDatesHistory,
  exportBlockedDatesICS
};
