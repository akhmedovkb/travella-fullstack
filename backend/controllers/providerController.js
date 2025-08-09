const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const ics = require("ics");

/* ========== Аутентификация ========== */
const registerProvider = async (req, res) => {
  try {
    const { name, email, password, type, location, phone, social, photo, address } = req.body;
    if (!name || !email || !password || !type || !location || !phone) {
      return res.status(400).json({ message: "Заполните все обязательные поля" });
    }
    const exists = await pool.query("SELECT 1 FROM providers WHERE email=$1", [email]);
    if (exists.rows.length) return res.status(400).json({ message: "Email уже используется" });

    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO providers (name,email,password,type,location,phone,social,photo,address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [name, email, hash, type, location, phone, social || null, photo || null, address || null]
    );
    res.status(201).json({ message: "Поставщик зарегистрирован" });
  } catch (e) {
    console.error("registerProvider:", e);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const loginProvider = async (req, res) => {
  try {
    const { email, password } = req.body;
    const r = await pool.query("SELECT * FROM providers WHERE email=$1", [email]);
    if (!r.rows.length) return res.status(400).json({ message: "Неверный email или пароль" });
    const user = r.rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ message: "Неверный email или пароль" });
    const token = jwt.sign({ id: user.id, role: "provider" }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.json({ token });
  } catch (e) {
    console.error("loginProvider:", e);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

/* ========== Профиль ========== */
const getProviderProfile = async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM providers WHERE id=$1", [req.user.id]);
    res.json(r.rows[0]);
  } catch (e) {
    console.error("getProviderProfile:", e);
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
  } catch (e) {
    console.error("updateProviderProfile:", e);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const changeProviderPassword = async (req, res) => {
  try {
    // фронт шлёт: { password: newPassword }
    const { password } = req.body;
    if (!password) return res.status(400).json({ message: "Пароль обязателен" });
    const hash = await bcrypt.hash(password, 10);
    await pool.query("UPDATE providers SET password=$1 WHERE id=$2", [hash, req.user.id]);
    res.json({ message: "Пароль изменён" });
  } catch (e) {
    console.error("changeProviderPassword:", e);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

/* ========== Услуги ========== */
const addService = async (req, res) => {
  try {
    const { title, description, price, category, images, availability, details } = req.body;
    await pool.query(
      `INSERT INTO services (provider_id,title,description,price,category,images,availability,details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        req.user.id,
        title,
        description,
        price,
        category,
        JSON.stringify(images || []),
        JSON.stringify(availability || []),
        details ? JSON.stringify(details) : null,
      ]
    );
    res.status(201).json({ message: "Услуга добавлена" });
  } catch (e) {
    console.error("addService:", e);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const getServices = async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM services WHERE provider_id=$1", [req.user.id]);
    res.json(r.rows);
  } catch (e) {
    console.error("getServices:", e);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const updateService = async (req, res) => {
  try {
    const { title, description, price, category, images, availability, details } = req.body;
    await pool.query(
      `UPDATE services SET title=$1,description=$2,price=$3,category=$4,images=$5,availability=$6,details=$7
       WHERE id=$8 AND provider_id=$9`,
      [
        title,
        description,
        price,
        category,
        JSON.stringify(images || []),
        JSON.stringify(availability || []),
        details ? JSON.stringify(details) : null,
        req.params.id,
        req.user.id,
      ]
    );
    res.json({ message: "Услуга обновлена" });
  } catch (e) {
    console.error("updateService:", e);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const deleteService = async (req, res) => {
  try {
    await pool.query("DELETE FROM services WHERE id=$1 AND provider_id=$2", [req.params.id, req.user.id]);
    res.json({ message: "Услуга удалена" });
  } catch (e) {
    console.error("deleteService:", e);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

/* ========== Календарь ========== */
const getBookedDates = async (req, res) => {
  try {
    const r = await pool.query("SELECT date FROM bookings WHERE provider_id=$1", [req.user.id]);
    // Вернём строки YYYY-MM-DD, фронт сам делает new Date(item)
    const out = r.rows.map((row) =>
      row.date instanceof Date ? row.date.toISOString().split("T")[0] : String(row.date)
    );
    res.json(out);
  } catch (e) {
    console.error("getBookedDates:", e);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const getBlockedDates = async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT date, reason FROM blocked_dates WHERE provider_id=$1 ORDER BY date ASC",
      [req.user.id]
    );
    // Для совместимости с фронтом: возвращаем ТОЛЬКО строки дат
    const out = r.rows.map((row) =>
      row.date instanceof Date ? row.date.toISOString().split("T")[0] : String(row.date)
    );
    res.json(out);
  } catch (e) {
    console.error("getBlockedDates:", e);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const saveBlockedDates = async (req, res) => {
  const client = await pool.connect();
  try {
    const { add = [], remove = [] } = req.body; // add: [{date,reason}], remove: ["YYYY-MM-DD",...]

    await client.query("BEGIN");

    // Удаления
    if (Array.isArray(remove) && remove.length) {
      for (const d of remove) {
        await client.query(
          "DELETE FROM blocked_dates WHERE provider_id=$1 AND date=$2",
          [req.user.id, d]
        );
        await client.query(
          `INSERT INTO blocked_dates_history (provider_id, date, action, reason)
           VALUES ($1, $2, 'unblock', NULL)`,
          [req.user.id, d]
        );
      }
    }

    // Добавления
    if (Array.isArray(add) && add.length) {
      for (const it of add) {
        await client.query(
          `INSERT INTO blocked_dates (provider_id, date, reason)
           VALUES ($1,$2,$3)
           ON CONFLICT (provider_id, date)
           DO UPDATE SET reason = EXCLUDED.reason`,
          [req.user.id, it.date, it.reason || null]
        );
        await client.query(
          `INSERT INTO blocked_dates_history (provider_id, date, action, reason)
           VALUES ($1, $2, 'block', $3)`,
          [req.user.id, it.date, it.reason || null]
        );
      }
    }

    await client.query("COMMIT");
    res.json({ message: "Изменения сохранены" });
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("saveBlockedDates:", e);
    res.status(500).json({ message: "Ошибка сервера" });
  } finally {
    client.release();
  }
};

const getBlockedDatesHistory = async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT date, action, reason, created_at
       FROM blocked_dates_history
       WHERE provider_id=$1
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (e) {
    console.error("getBlockedDatesHistory:", e);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

/* ========== Экспорт .ics ========== */
const exportBlockedDatesICS = async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT date, reason FROM blocked_dates WHERE provider_id=$1 ORDER BY date ASC",
      [req.user.id]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Нет заблокированных дат" });

    const events = r.rows.map((row) => {
      // row.date может быть Date или строка
      let y, m, d;
      if (row.date instanceof Date) {
        const iso = row.date.toISOString().split("T")[0];
        [y, m, d] = iso.split("-").map(Number);
      } else {
        [y, m, d] = String(row.date).split("-").map(Number);
      }
      return {
        start: [y, m, d],
        duration: { days: 1 },
        title: "Заблокировано",
        description: row.reason || "Недоступно для бронирования",
      };
    });

    ics.createEvents(events, (error, value) => {
      if (error) {
        console.error("ICS error:", error);
        return res.status(500).json({ message: "Ошибка генерации календаря" });
      }
      res.setHeader("Content-Type", "text/calendar");
      res.setHeader("Content-Disposition", "attachment; filename=blocked-dates.ics");
      res.send(value);
    });
  } catch (e) {
    console.error("exportBlockedDatesICS:", e);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

module.exports = {
  // auth
  registerProvider,
  loginProvider,
  // profile
  getProviderProfile,
  updateProviderProfile,
  changeProviderPassword,
  // services
  addService,
  getServices,
  updateService,
  deleteService,
  // calendar
  getBookedDates,
  getBlockedDates,
  saveBlockedDates,
  getBlockedDatesHistory,
  exportBlockedDatesICS,
};
