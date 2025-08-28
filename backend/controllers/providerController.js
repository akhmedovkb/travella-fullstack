// backend/controllers/providerController.js

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

// ---------- Helpers ----------
const EXT_CATS = new Set([
  "refused_tour",
  "author_tour",
  "refused_hotel",
  "refused_flight",
  "refused_event_ticket",
  "visa_support",
]);
const isExtendedCategory = (cat) => EXT_CATS.has(String(cat || ""));

function toArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === "string") {
    try {
      const arr = JSON.parse(val);
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  }
  return [];
}
const sanitizeImages = (images) =>
  toArray(images)
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, 20);

function normalizeServicePayload(body) {
  const { title, description, price, category, images, availability, details } = body || {};

  const imagesArr = sanitizeImages(images);
  const availabilityArr = Array.isArray(availability) ? availability : toArray(availability);

  // details разрешаем для всех категорий, т.к. тут теперь живёт grossPrice
  let detailsObj = null;
  if (details) {
    if (typeof details === "string") {
      try {
        detailsObj = JSON.parse(details);
      } catch {
        detailsObj = { value: String(details) };
      }
    } else if (typeof details === "object") {
      detailsObj = details;
    }
  }

  const titleStr = title != null ? String(title).trim() : null;
  const descStr = description != null ? String(description).trim() : null;
  const catStr = category != null ? String(category).trim() : null;
  const priceNum = price != null && price !== "" ? Number(price) : null;

  return {
    title: titleStr,
    descriptionStr: descStr,
    priceNum: Number.isFinite(priceNum) ? priceNum : null,
    category: catStr,
    imagesArr,
    availabilityArr,
    detailsObj,
  };
}

// Нормализация дат к "YYYY-MM-DD"
const normalizeDateArray = (arr) => {
  const unique = new Set(
    toArray(arr)
      .map(String)
      .map((s) => s.split("T")[0])
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return Array.from(unique);
};

// ---------- Auth ----------
const registerProvider = async (req, res) => {
  try {
    const { name, email, password, type, location, phone, social, photo, address } = req.body || {};

    if (!name || !email || !password || !type || !location || !phone) {
      return res.status(400).json({ message: "Заполните все обязательные поля" });
    }
    if (photo && typeof photo !== "string") {
      return res.status(400).json({ message: "Некорректный формат изображения" });
    }

    const existing = await pool.query("SELECT 1 FROM providers WHERE email = $1", [email]);
    if (existing.rows.length) {
      return res.status(400).json({ message: "Email уже используется" });
    }

    const hashed = await bcrypt.hash(password, 10);
    await pool.query(
      `INSERT INTO providers (name, email, password, type, location, phone, social, photo, address)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [name, email, hashed, type, location, phone, social ?? null, photo ?? null, address ?? null]
    );
    res.status(201).json({ message: "Регистрация успешна" });
  } catch (err) {
    console.error("❌ Ошибка регистрации:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const loginProvider = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const q = await pool.query("SELECT * FROM providers WHERE email = $1", [email]);
    if (!q.rows.length) {
      return res.status(400).json({ message: "Неверный email или пароль" });
    }
    const row = q.rows[0];
    const ok = await bcrypt.compare(String(password || ""), row.password);
    if (!ok) {
      return res.status(400).json({ message: "Неверный email или пароль" });
    }
    const token = jwt.sign({ id: row.id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.json({ message: "Вход успешен", provider: { id: row.id, name: row.name, email: row.email }, token });
  } catch (err) {
    console.error("❌ Ошибка входа:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// ---------- Profile ----------
const getProviderProfile = async (req, res) => {
  try {
    const id = req.user.id;
    const r = await pool.query(
      `SELECT id, name, email, type, location, phone, social, photo, certificate, address
       FROM providers WHERE id = $1`,
      [id]
    );
    res.json(r.rows[0] || null);
  } catch (err) {
    console.error("❌ Ошибка получения профиля:", err);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const updateProviderProfile = async (req, res) => {
  try {
    const id = req.user.id;
    const oldQ = await pool.query(
      `SELECT name, location, phone, social, photo, certificate, address
       FROM providers WHERE id = $1`,
      [id]
