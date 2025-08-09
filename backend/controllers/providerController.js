const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

/* =========================
 * Аутентификация
 * ========================= */

const registerProvider = async (req, res) => {
  try {
    const { name, email, password, type, location, phone, social, photo, address } = req.body;

    if (!name || !email || !password || !type || !location || !phone) {
      return res.status(400).json({ message: "Заполните все обязательные поля" });
    }

    const existing = await pool.query("SELECT 1 FROM providers WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: "Email уже используется" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const inserted = await pool.query(
      `INSERT INTO providers (name, email, password, type, location, phone, social, photo, address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [name, email, hashedPassword, type, location, phone, social || null, photo || null, address || null]
    );

    const token = jwt.sign({ id: inserted.rows[0].id }, process.env.JWT_SECRET);
    res.status(201).json({ token });
  } catch (error) {
    console.error("Ошибка регистрации:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

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

/* =========================
 * Профиль
 * ========================= */

const getProviderProfile = async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM providers WHERE id = $1", [req.user.id]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Ошибка загрузки профиля:", error);
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
  } catch (error) {
    console.error("Ошибка обновления профиля:", error);
    res.status(500).json({ message: "Ошибка обновления профиля" });
  }
};

const changeProviderPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const result = await pool.query("SELECT password FROM providers WHERE id = $1", [req.user.id]);

    if (result.rows.length === 0) return res.status(404).json({ message: "Провайдер не найден" });

    const valid = await bcrypt.compare(currentPassword, result.rows[0].password);
    if (!valid) {
      return res.status(400).json({ message: "Неверный текущий пароль" });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE providers SET password=$1 WHERE id=$2", [hashed, req.user.id]);

    res.json({ message: "Пароль обновлён" });
  } catch (error) {
    console.error("Ошибка смены пароля:", error);
    res.status(500).json({ message: "Ошибка при смене пароля" });
  }
};

/* =========================
 * Услуги
 * ========================= */

const addService = async (req, res) => {
  try {
    const { title, description, price, category, images, availability, details } = req.body;
    await pool.query(
      `INSERT INTO services
       (provider_id, title, description, price, category, images, availability, details)
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
  } catch (error) {
    console.error("Ошибка при добавлении услуги:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const getServices = async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM services WHERE provider_id = $1", [req.user.id]);
    res.json(result.rows);
  } catch (error) {
    console.error("Ошибка загрузки услуг:", error);
    res.status(500).json({ message: "Ошибка загрузки услуг" });
  }
};

const updateService = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, price, category, images, availability, details } = req.body;

    await pool.query(
      `UPDATE services
       SET title=$1, description=$2, price=$3, category=$4, images=$5, availability=$6, details=$7
       WHERE id=$8 AND provider_id=$9`,
      [
        title,
        description,
        price,
        category,
        JSON.stringify(images || []),
        JSON.stringify(availability || []),
        details ? JSON.stringify(details) : null,
        id,
        req.user.id,
      ]
    );
    res.json({ message: "Услуга обновлена" });
  } catch (error) {
    console.error("Ошибка при обновлении услуги:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const deleteService = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM services WHERE id=$1 AND provider_id=$2", [id, req.user.id]);
    res.json({ message: "Услуга удалена" });
  } catch (error) {
    console.error("Ошибка при удалении услуги:", error);
    res.status(500).json({ message: "Ошибка при удалении услуги" });
  }
};

/* =========================
 * Календарь: занятые и заблокированные
 * ========================= */

const getBookedDates = async (req, res) => {
  try {
    const providerId = req.user.id;
    const result = await pool.query(
      "SELECT date FROM bookings WHERE provider_id = $1",
      [providerId]
    );
    // Возвращаем массив строк 'YYYY-MM-DD'
    res.json(result.rows.map(r => r.date));
  } catch (error) {
    console.error("Ошибка получения занятых дат:", error);
    res.status(500).json({ message: "Ошибка загрузки" });
  }
};

const getBlockedDates = async (req, res) => {
  try {
    const providerId = req.user.id;
    const details = req.query.details === "1";

    const result = await pool.query(
      "SELECT date, reason FROM blocked_dates WHERE provider_id = $1 AND (service_id IS NULL OR service_id = 0) ORDER BY date",
      [providerId]
    );

    if (details) {
      // Подробный формат: [{ date: 'YYYY-MM-DD', reason: '...' }, ...]
      const data = result.rows.map(r => ({
        date: r.date instanceof Date ? r.date.toISOString().split("T")[0] : String(r.date),
        reason: r.reason || null,
      }));
      return res.json(data);
    }

    // Базовый формат (как раньше): ['YYYY-MM-DD', ...]
    res.json(result.rows.map(r => (r.date instanceof Date ? r.date.toISOString().split("T")[0] : String(r.date))));
  } catch (error) {
    console.error("Ошибка получения заблокированных дат:", error);
    res.status(500).json({ message: "calendar.load_error" });
  }
};

/**
 * saveBlockedDates
 * Принимает:
 *  - add:   массив дат ИЛИ объектов { date, reason }
 *  - remove: массив дат ИЛИ объектов { date, reason }
 * Оба варианта поддержаны, чтобы не ломать фронт.
 * Логируем каждое действие в blocked_dates_history.
 */
const saveBlockedDates = async (req, res) => {
  const providerId = req.user.id;
  let { add = [], remove = [] } = req.body;

  // Нормализация payload: к массиву объектов { date, reason }
  const normalize = (arr) =>
    (Array.isArray(arr) ? arr : []).map((x) =>
      typeof x === "string"
        ? { date: x, reason: null }
        : { date: x.date, reason: x.reason || null }
    );

  add = normalize(add);
  remove = normalize(remove);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Удаления
    if (remove.length > 0) {
      const removeDates = remove.map((x) => x.date);
      await client.query(
        "DELETE FROM blocked_dates WHERE provider_id = $1 AND date = ANY($2::date[])",
        [providerId, removeDates]
      );

      // История
      for (const item of remove) {
        await client.query(
          `INSERT INTO blocked_dates_history (provider_id, service_id, date, action, reason)
           VALUES ($1, $2, $3, 'remove', $4)`,
          [providerId, null, item.date, item.reason || null]
        );
      }
    }

    // Добавления
    for (const item of add) {
      // Вставка/обновление причины
      await client.query(
        `INSERT INTO blocked_dates (provider_id, service_id, date, reason)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (provider_id, date)
         DO UPDATE SET reason = COALESCE(EXCLUDED.reason, blocked_dates.reason)`,
        [providerId, null, item.date, item.reason || null]
      );

      // История
      await client.query(
        `INSERT INTO blocked_dates_history (provider_id, service_id, date, action, reason)
         VALUES ($1, $2, $3, 'add', $4)`,
        [providerId, null, item.date, item.reason || null]
      );
    }

    await client.query("COMMIT");
    res.status(200).json({ message: "Даты успешно обновлены." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Ошибка сохранения дат:", error);
    res.status(500).json({ message: "Ошибка при сохранении дат." });
  } finally {
    client.release();
  }
};

/**
 * История изменений блокировок
 * GET /api/providers/blocked-dates/history
 * Параметры (опц.): ?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
const getBlockedDatesHistory = async (req, res) => {
  try {
    const providerId = req.user.id;
    const { from, to } = req.query;

    // Базовый запрос
    let sql = `
      SELECT date, action, reason, changed_at
      FROM blocked_dates_history
      WHERE provider_id = $1
    `;
    const params = [providerId];

    // Фильтры периода
    if (from) {
      params.push(from);
      sql += ` AND date >= $${params.length}`;
    }
    if (to) {
      params.push(to);
      sql += ` AND date <= $${params.length}`;
    }

    sql += " ORDER BY changed_at DESC";

    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Ошибка получения истории дат:", error);
    res.status(500).json({ message: "Ошибка загрузки истории" });
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
};
