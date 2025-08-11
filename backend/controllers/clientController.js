// backend/controllers/clientController.js
const pool = require("../db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

function int(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
async function safeCount(sql, params = []) {
  try {
    const r = await pool.query(sql, params);
    const v = r?.rows?.[0];
    const n = v ? Number(v.count ?? v.n ?? Object.values(v)[0]) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** ========== AUTH ========== */
exports.register = async (req, res) => {
  try {
    const { name, email, phone, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ message: "email & password required" });

    const exists = await pool.query("SELECT id FROM clients WHERE email=$1 LIMIT 1", [email]);
    if (exists.rows.length) return res.status(409).json({ message: "Email already registered" });

    const hash = await bcrypt.hash(password, 10);
    const ins = await pool.query(
      `INSERT INTO clients (name, email, phone, password_hash, created_at)
       VALUES ($1,$2,$3,$4, NOW()) RETURNING id`,
      [name || "", email, phone || "", hash]
    );

    return res.json({ id: ins.rows[0].id });
  } catch (e) {
    console.error("register error:", e);
    return res.status(500).json({ message: "Register failed" });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ message: "email & password required" });

    const r = await pool.query("SELECT id, password_hash FROM clients WHERE email=$1 LIMIT 1", [email]);
    if (!r.rows.length) return res.status(401).json({ message: "Invalid credentials" });

    const row = r.rows[0];
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(401).json({ message: "Invalid credentials" });

    const token = jwt.sign({ id: row.id, role: "client" }, process.env.JWT_SECRET, { expiresIn: "30d" });
    return res.json({ token });
  } catch (e) {
    console.error("login error:", e);
    return res.status(500).json({ message: "Login failed" });
  }
};

/** ========== PROFILE ========== */
exports.getProfile = async (req, res) => {
  try {
    const id = req.user?.id;
    if (!id) return res.status(401).json({ message: "Unauthorized" });

    const r = await pool.query(
      "SELECT id, name, email, phone, avatar_url, created_at FROM clients WHERE id=$1 LIMIT 1",
      [id]
    );
    if (!r.rows.length) return res.status(404).json({ message: "Client not found" });

    return res.json(r.rows[0]);
  } catch (e) {
    console.error("getProfile error:", e);
    return res.status(500).json({ message: "Failed to load profile" });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const id = req.user?.id;
    if (!id) return res.status(401).json({ message: "Unauthorized" });

    const { name, phone, avatar_base64, remove_avatar } = req.body || {};

    let avatarUrlSet = null;
    if (remove_avatar === true) {
      avatarUrlSet = null;
    } else if (avatar_base64) {
      avatarUrlSet = `data:image/jpeg;base64,${avatar_base64}`;
    }

    const fields = [];
    const params = [];
    let idx = 1;

    if (typeof name === "string") {
      fields.push(`name=$${idx++}`);
      params.push(name);
    }
    if (typeof phone === "string") {
      fields.push(`phone=$${idx++}`);
      params.push(phone);
    }
    if (remove_avatar === true) {
      fields.push(`avatar_url=NULL`);
    } else if (avatarUrlSet) {
      fields.push(`avatar_url=$${idx++}`);
      params.push(avatarUrlSet);
    }

    if (!fields.length) return res.json({ ok: true });

    params.push(id);
    const sql = `UPDATE clients SET ${fields.join(", ")}, updated_at=NOW() WHERE id=$${idx} RETURNING id`;
    await pool.query(sql, params);

    return res.json({ ok: true });
  } catch (e) {
    console.error("updateProfile error:", e);
    return res.status(500).json({ message: "Failed to update profile" });
  }
};

/** ========== STATS / PROGRESS ========== */
exports.getStats = async (req, res) => {
  try {
    const clientId = req.user?.id;
    if (!clientId) return res.status(401).json({ message: "Unauthorized" });

    const requests_total = await safeCount(
      "SELECT COUNT(*) FROM change_requests WHERE client_id=$1",
      [clientId]
    );

    const requests_active = await safeCount(
      "SELECT COUNT(*) FROM change_requests WHERE client_id=$1 AND status IN ('open','accepted','proposed','proposal_sent','proposal_viewed')",
      [clientId]
    );

    const bookings_total = await safeCount(
      "SELECT COUNT(*) FROM bookings WHERE client_id=$1",
      [clientId]
    );

    const bookings_confirmed = await safeCount(
      "SELECT COUNT(*) FROM bookings WHERE client_id=$1 AND status='confirmed'",
      [clientId]
    );
    const bookings_completed = await safeCount(
      "SELECT COUNT(*) FROM bookings WHERE client_id=$1 AND status='completed'",
      [clientId]
    );
    const bookings_cancelled = await safeCount(
      "SELECT COUNT(*) FROM bookings WHERE client_id=$1 AND status IN ('cancelled','canceled')",
      [clientId]
    );

    let rating = 3 + 0.5 * bookings_completed - 1 * bookings_cancelled;
    rating = Math.max(0, Math.min(5, rating));
    rating = Math.round(rating * 10) / 10;

    const points = bookings_completed * 5;

    const tiers = [
      { name: "Bronze", at: 0 },
      { name: "Silver", at: 500 },
      { name: "Gold", at: 1000 },
      { name: "Platinum", at: 2000 },
    ];
    let current = tiers[0];
    for (const t of tiers) if (points >= t.at) current = t;
    const nextIndex = Math.min(tiers.length - 1, tiers.indexOf(current) + 1);
    const next = tiers[nextIndex];
    const next_tier_at = next.at;

    return res.json({
      requests_total: int(requests_total),
      requests_active: int(requests_active),
      bookings_total: int(bookings_total),
      bookings_confirmed: int(bookings_confirmed),
      bookings_completed: int(bookings_completed),
      bookings_cancelled: int(bookings_cancelled),
      rating,
      points,
      tier: current.name,
      next_tier_at,
    });
  } catch (e) {
    console.error("getStats error:", e);
    return res.status(500).json({ message: "Failed to load client stats" });
  }
};

/** ========== PASSWORD CHANGE ========== */
exports.changePassword = async (req, res) => {
  try {
    const id = req.user?.id;
    if (!id) return res.status(401).json({ message: "Unauthorized" });

    const { password } = req.body || {};
    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({ message: "Password too short (min 6)" });
    }

    const hash = await bcrypt.hash(password, 10);
    await pool.query(
      "UPDATE clients SET password_hash=$1, updated_at=NOW() WHERE id=$2",
      [hash, id]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error("changePassword error:", e);
    return res.status(500).json({ message: "Failed to change password" });
  }
};
