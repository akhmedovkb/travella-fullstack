
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const registerProvider = async (req, res) => {
  const { type, name, location, photo, phone, social, email, password } = req.body;

  try {
    const existing = await pool.query("SELECT * FROM providers WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ message: "Поставщик с таким email уже существует" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO providers (type, name, location, photo, phone, social, email, password) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *",
      [type, name, location, photo, phone, social, email, hashedPassword]
    );

    const token = jwt.sign({ id: result.rows[0].id }, process.env.JWT_SECRET, { expiresIn: "7d" });
    res.status(201).json({ token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Ошибка при регистрации" });
  }
};

module.exports = { registerProvider };
