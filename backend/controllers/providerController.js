const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const registerProvider = async (req, res) => {
  try {
    // 👉 Лог тела запроса для отладки
    console.log("📦 Получено тело запроса:", req.body);

    const {
      name,
      email,
      password,
      type,
      location,
      phone,
      social,
      photo
    } = req.body;

    // Проверка на обязательные поля
    if (!name || !email || !password || !type || !location || !phone) {
      return res.status(400).json({ message: "Заполните все обязательные поля" });
    }

    // Проверка на формат фото
    if (photo && typeof photo !== "string") {
      return res.status(400).json({ message: "Некорректный формат изображения" });
    }

    const existingProvider = await pool.query(
      "SELECT * FROM providers WHERE email = $1",
      [email]
    );

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

    const token = jwt.sign(
      { id: newProvider.rows[0].id },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

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

module.exports = { registerProvider };
