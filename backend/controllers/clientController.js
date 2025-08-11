// backend/controllers/clientController.js
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const JWT_SECRET = process.env.JWT_SECRET || "changeme_in_env";
const JWT_EXPIRES_IN = "7d";

// Helper: map DB row → client payload
function mapClient(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    avatar: row.avatar || null,
    languages: row.languages || [],
    location: row.location || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// POST /api/clients/register
exports.register = async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "name, email, password required" });
    }

    const existing = await pool.query("SELECT id FROM clients WHERE email=$1", [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ message: "Email already registered" });
    }

    const password_hash = await bcrypt.hash(password, 10);

    const insert = await pool.query(
      `INSERT INTO clients (name, email, phone, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, phone, avatar, languages, location, created_at, updated_at`,
      [name, email, phone || null, password_hash]
    );

    const client = mapClient(insert.rows[0]);
    const token = jwt.sign({ id: client.id, role: "client" }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    return res.status(201).json({ token, client });
  } catch (err) {
    console.error("Client register error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// POST /api/clients/login
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: "email and password required" });

    const q = await pool.query(
      `SELECT id, name, email, phone, password_hash, avatar, languages, location, created_at, updated_at
       FROM clients WHERE email=$1`,
      [email]
    );
    if (q.rows.length === 0) return res.status(401).json({ message: "Invalid credentials" });

    const row = q.rows[0];
    const isMatch = await bcrypt.compare(password, row.password_hash);
    if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

    const client = mapClient(row);
    const token = jwt.sign({ id: client.id, role: "client" }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    return res.json({ token, client });
  } catch (err) {
    console.error("Client login error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// GET /api/clients/profile
exports.getProfile = async (req, res) => {
  try {
    const clientId = req.user?.id;
    if (!clientId) return res.status(401).json({ message: "Unauthorized" });

    const q = await pool.query(
      `SELECT id, name, email, phone, avatar, languages, location, created_at, updated_at
       FROM clients WHERE id=$1`,
      [clientId]
    );
    if (q.rows.length === 0) return res.status(404).json({ message: "Client not found" });

    return res.json(mapClient(q.rows[0]));
  } catch (err) {
    console.error("Get client profile error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

// PUT /api/clients/profile
exports.updateProfile = async (req, res) => {
  try {
    const clientId = req.user?.id;
    if (!clientId) return res.status(401).json({ message: "Unauthorized" });

    const { name, phone, avatar, languages, location, password } = req.body;

    // Build dynamic update
    const fields = [];
    const values = [];
    let idx = 1;

    if (name !== undefined) { fields.push(`name=$${idx++}`); values.push(name); }
    if (phone !== undefined) { fields.push(`phone=$${idx++}`); values.push(phone); }
    if (avatar !== undefined) { fields.push(`avatar=$${idx++}`); values.push(avatar); }
    if (languages !== undefined) { fields.push(`languages=$${idx++}`); values.push(languages); }
    if (location !== undefined) { fields.push(`location=$${idx++}`); values.push(location); }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      fields.push(`password_hash=$${idx++}`);
      values.push(hash);
    }
    fields.push(`updated_at=NOW()`);

    values.push(clientId);

    const q = await pool.query(
      `UPDATE clients SET ${fields.join(", ")} WHERE id=$${idx} 
       RETURNING id, name, email, phone, avatar, languages, location, created_at, updated_at`,
      values
    );

    return res.json(mapClient(q.rows[0]));
  } catch (err) {
    console.error("Update client profile error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
