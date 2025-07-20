
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const registerClient = async (req, res) => {
  const { email, password, name } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO clients (email, password, name) VALUES ($1, $2, $3) RETURNING *",
      [email, hashedPassword, name]
    );
    res.json(result.rows[0]);
  } catch {
    res.status(500).send("Server error");
  }
};

const loginClient = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await pool.query("SELECT * FROM clients WHERE email = $1", [email]);
    if (!user.rows.length) return res.status(400).json({ message: "Not found" });

    const valid = await bcrypt.compare(password, user.rows[0].password);
    if (!valid) return res.status(400).json({ message: "Wrong password" });

    const token = jwt.sign({ id: user.rows[0].id }, process.env.JWT_SECRET, { expiresIn: "1h" });
    res.json({ token });
  } catch {
    res.status(500).send("Server error");
  }
};

const getClientProfile = async (req, res) => {
  try {
    const client = await pool.query("SELECT * FROM clients WHERE id = $1", [req.user.id]);
    res.json(client.rows[0]);
  } catch {
    res.status(500).send("Server error");
  }
};

module.exports = { registerClient, loginClient, getClientProfile };
