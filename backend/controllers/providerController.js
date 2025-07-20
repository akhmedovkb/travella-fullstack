// backend/controllers/providerController.js

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const registerProvider = async (req, res) => {
  try {
    const {
      name,
      type,
      location,
      phone,
      email,
      password,
      social_profile,
      photo
    } = req.body;

    const existing = await pool.query("SELECT * FROM providers WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: "Поставщик с таким email уже зарегистрирован" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO providers (name, type, location, phone, email, password, social_profile, photo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, email`,
      [name, type, location, phone, email, hashedPassword, social_profile, photo]
    );

    const provider = result.rows[0];
    const token = jwt.sign({ id: provider.id }, process.env.JWT_SECRET, { expiresIn: "7d" });

    res.status(201).json({ provider, token });
  } catch (err) {
    console.error("Ошибка при регистрации поставщика:", err);
    res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
};

module.exports = {
  registerProvider
};
