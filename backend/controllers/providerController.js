const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

/** Helpers */
const signToken = (provider) =>
  jwt.sign(
    { id: provider.id, email: provider.email, type: provider.type },
    process.env.JWT_SECRET || "dev_secret",
    { expiresIn: "30d" }
  );

const pickProvider = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  type: row.type,
  location: row.location,
  phone: row.phone,
  social: row.social,
  photo: row.photo,
  address: row.address,
  rating: row.rating || null,
});

/** Auth */
exports.registerProvider = async (req, res) => {
  try {
    const {
      name, email, password, type, location, phone,
      social = null, photo = null, address = null,
    } = req.body;

    if (!name || !email || !password || !type || !location || !phone) {
      return res.status(400).json({ message: "Заполните все обязательные поля" });
    }

    const exists = await pool.query("SELECT id FROM providers WHERE email=$1", [email]);
    if (exists.rows.length) {
      return res.status(400).json({ message: "Email уже используется" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const insert = await pool.query(
      `INSERT INTO providers (name, email, password, type, location, phone, social, photo, address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, name, email, type, location, phone, social, photo, address`,
      [name, email, hashed, type, location, phone, social, photo, address]
    );

    const provider = insert.rows[0];
    const token = signToken(provider);
    res.status(201).json({ token, provider: pickProvider(provider) });
  } catch (err) {
    console.error("registerProvider error:", err);
    res.status(500).json({ message: "Ошибка регистрации" });
  }
};

exports.loginProvider = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Введите email и пароль" });
    }

    const q = await pool.query("SELECT * FROM providers WHERE email=$1", [email]);
    if (!q.rows.length) return res.status(401).json({ message: "Неверные данные" });

    const provider = q.rows[0];
    const ok = await bcrypt.compare(password, provider.password);
    if (!ok) return res.status(401).json({ message: "Неверные данные" });

    const token = signToken(provider);
    res.json({ token, provider: pickProvider(provider) });
  } catch (err) {
    console.error("loginProvider error:", err);
    res.status(500).json({ message: "Ошибка входа" });
  }
};

/** Profile */
exports.getProviderProfile = async (req, res) => {
  try {
    const q = await pool.query("SELECT * FROM providers WHERE id=$1", [req.user.id]);
    if (!q.rows.length) return res.status(404).json({ message: "Провайдер не найден" });
    res.json(pickProvider(q.rows[0]));
  } catch (err) {
    console.error("getProviderProfile error:", err);
    res.status(500).json({ message: "Ошибка загрузки профиля" });
  }
};

exports.updateProviderProfile = async (req, res) => {
  try {
    const { name, location, phone, social, photo, address } = req.body;

    const q = await pool.query(
      `UPDATE providers
       SET name=COALESCE($1,name),
           location=COALESCE($2,location),
           phone=COALESCE($3,phone),
           social=COALESCE($4,social),
           photo=COALESCE($5,photo),
           address=COALESCE($6,address)
       WHERE id=$7
       RETURNING *`,
      [name, location, phone, social, photo, address, req.user.id]
    );
    res.json(pickProvider(q.rows[0]));
  } catch (err) {
    console.error("updateProviderProfile error:", err);
    res.status(500).json({ message: "Ошибка обновления профиля" });
  }
};

/** Services (images: text[], details: JSONB) */
exports.createService = async (req, res) => {
  try {
    const {
      title, description, category,
      price = null, images = [], status = "draft",
      details = null,
    } = req.body;

    if (!title || !category) {
      return res.status(400).json({ message: "Заполните обязательные поля услуги" });
    }

    // Важно: для text[] передаем чистый массив строк (без stringify)
    const imgPayload = Array.isArray(images) ? images : [];

    const q = await pool.query(
      `INSERT INTO services
       (provider_id, title, description, category, price, images, status, details)
       VALUES ($1,$2,$3,$4,$5,$6::text[],$7,$8)
       RETURNING *`,
      [
        req.user.id,
        title,
        description || null,
        category,
        price !== null ? Number(price) : null,
        imgPayload,
        status,
        details,
      ]
    );
    res.status(201).json(q.rows[0]);
  } catch (err) {
    console.error("createService error:", err);
    res.status(500).json({ message: "Ошибка создания услуги" });
  }
};

exports.getMyServices = async (req, res) => {
  try {
    const q = await pool.query(
      `SELECT * FROM services WHERE provider_id=$1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(q.rows);
  } catch (err) {
    console.error("getMyServices error:", err);
    res.status(500).json({ message: "Ошибка загрузки услуг" });
  }
};

exports.updateService = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, category, price, images, status, details } = req.body;

    const own = await pool.query(
      `SELECT id FROM services WHERE id=$1 AND provider_id=$2`,
      [id, req.user.id]
    );
    if (!own.rows.length) return res.status(404).json({ message: "Услуга не найдена" });

    const imgParam =
      images !== undefined ? (Array.isArray(images) ? images : []) : null;

    const q = await pool.query(
      `UPDATE services
       SET title=COALESCE($1,title),
           description=COALESCE($2,description),
           category=COALESCE($3,category),
           price=COALESCE($4,price),
           images=COALESCE($5::text[], images),
           status=COALESCE($6,status),
           details=COALESCE($7,details),
           updated_at=NOW()
       WHERE id=$8
       RETURNING *`,
      [
        title || null,
        description || null,
        category || null,
        price !== undefined ? Number(price) : null,
        imgParam,
        status || null,
        details !== undefined ? details : null,
        id,
      ]
    );
    res.json(q.rows[0]);
  } catch (err) {
    console.error("updateService error:", err);
    res.status(500).json({ message: "Ошибка обновления услуги" });
  }
};

exports.deleteService = async (req, res) => {
  try {
    const { id } = req.params;
    const del = await pool.query(
      `DELETE FROM services WHERE id=$1 AND provider_id=$2 RETURNING id`,
      [id, req.user.id]
    );
    if (!del.rows.length) return res.status(404).json({ message: "Услуга не найдена" });
    res.json({ success: true });
  } catch (err) {
    console.error("deleteService error:", err);
    res.status(500).json({ message: "Ошибка удаления услуги" });
  }
};

/** Calendar */
exports.getBlockedAndBookedDates = async (req, res) => {
  try {
    const providerId = req.user.id;

    const blockedQ = await pool.query(
      `SELECT date::date AS date FROM provider_blocked_dates WHERE provider_id=$1 ORDER BY date`,
      [providerId]
    );

    let booked = [];
    try {
      const bookedQ = await pool.query(
        `SELECT DISTINCT b.date::date AS date
         FROM bookings b
         WHERE b.provider_id=$1 AND b.status IN ('paid','confirmed')`,
        [providerId]
      );
      booked = bookedQ.rows.map((r) => r.date);
    } catch {
      booked = [];
    }

    res.json({
      blocked: blockedQ.rows.map((r) => r.date),
      booked,
    });
  } catch (err) {
    console.error("getBlockedAndBookedDates error:", err);
    res.status(500).json({ message: "Ошибка загрузки календаря" });
  }
};

exports.updateBlockedDates = async (req, res) => {
  try {
    const providerId = req.user.id;
    const { add = [], remove = [] } = req.body || {};

    await pool.query("BEGIN");

    if (add.length) {
      const values = add.map((_, i) => `($1,$${i + 2}::date)`).join(",");
      await pool.query(
        `INSERT INTO provider_blocked_dates (provider_id, date) VALUES ${values}
         ON CONFLICT (provider_id, date) DO NOTHING`,
        [providerId, ...add]
      );
    }

    if (remove.length) {
      await pool.query(
        `DELETE FROM provider_blocked_dates
         WHERE provider_id=$1 AND date = ANY($2::date[])`,
        [providerId, remove]
      );
    }

    await pool.query("COMMIT");
    res.json({ success: true });
  } catch (err) {
    await pool.query("ROLLBACK").catch(() => {});
    console.error("updateBlockedDates error:", err);
    res.status(500).json({ message: "Ошибка сохранения дат" });
  }
};
