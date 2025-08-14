// backend/controllers/clientController.js
const db = require("../db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

/* ===== Helpers ===== */
function signToken(payload) {
  const secret = process.env.JWT_SECRET || "secret";
  return jwt.sign(payload, secret, { expiresIn: "30d" });
}

// Нормализация Telegram username: убираем @, посторонние символы, пустое -> null
function normalizeTelegram(username) {
  if (username === undefined || username === null) return null;
  let u = String(username).trim();
  if (!u) return null;
  if (u.startsWith("@")) u = u.slice(1);
  u = u.replace(/[^a-zA-Z0-9_]/g, "");
  return u || null;
}

/* ======================
   AUTH: register & login
   ====================== */

// POST /api/clients/register
exports.register = async (req, res) => {
  try {
    const { name, email, phone, password } = req.body || {};

    if (!name || !password || (!email && !phone)) {
      return res
        .status(400)
        .json({ message: "Name, password и email или phone обязательны" });
    }

    if (email) {
      const q = await db.query("SELECT id FROM clients WHERE email = $1", [email]);
      if (q.rows.length > 0) {
        return res.status(400).json({ message: "Email уже используется" });
      }
    }
    if (phone) {
      const q = await db.query("SELECT id FROM clients WHERE phone = $1", [phone]);
      if (q.rows.length > 0) {
        return res.status(400).json({ message: "Телефон уже используется" });
      }
    }

    const password_hash = await bcrypt.hash(password, 10);

    const ins = await db.query(
      `INSERT INTO clients (name, email, phone, password_hash, created_at)
       VALUES ($1,$2,$3,$4, NOW())
       RETURNING id, name, email, phone, avatar_url, telegram`,
      [name, email || null, phone || null, password_hash]
    );

    const client = ins.rows[0];
    const token = signToken({ id: client.id, role: "client" });

    res.json({ token, client });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to register" });
  }
};

// POST /api/clients/login
exports.login = async (req, res) => {
  try {
    const { email, phone, login, password } = req.body || {};
    const identifier = email || phone || login;

    if (!identifier || !password) {
      return res.status(400).json({ message: "Неверные учетные данные" });
    }

    const q = await db.query(
      "SELECT * FROM clients WHERE (email = $1 OR phone = $1) LIMIT 1",
      [identifier]
    );
    if (q.rows.length === 0) {
      return res.status(400).json({ message: "Клиент не найден" });
    }

    const client = q.rows[0];
    const ok =
      client.password_hash && (await bcrypt.compare(password, client.password_hash));

    if (!ok) {
      return res.status(400).json({ message: "Неверный пароль" });
    }

    const token = signToken({ id: client.id, role: "client" });

    res.json({
      token,
      client: {
        id: client.id,
        name: client.name,
        email: client.email,
        phone: client.phone,
        avatar_url: client.avatar_url,
        telegram: client.telegram || null,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to login" });
  }
};

/* ======================
   PROFILE: me / profile
   ====================== */

// GET /api/clients/me
exports.getMe = async (req, res) => {
  try {
    if (req.user?.role !== "client") {
      return res.status(403).json({ message: "Only client" });
    }
    const q = await db.query(
      "SELECT id, name, email, phone, avatar_url, telegram FROM clients WHERE id = $1",
      [req.user.id]
    );
    res.json(q.rows[0] || null);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to load profile" });
  }
};

// PUT /api/clients/me
exports.updateMe = async (req, res) => {
  try {
    if (req.user?.role !== "client") {
      return res.status(403).json({ message: "Only client" });
    }
    const { name, phone, avatar_base64, remove_avatar, telegram } = req.body || {};

    let avatar_url = null;
    if (avatar_base64) {
      // храним в текстовом поле data URL
      avatar_url = `data:image/jpeg;base64,${avatar_base64}`;
    } else if (!remove_avatar) {
      // оставляем как было
      const cur = await db.query(
        "SELECT avatar_url FROM clients WHERE id=$1",
        [req.user.id]
      );
      avatar_url = cur.rows[0]?.avatar_url || null;
    }

    // нормализуем телеграм; undefined -> null (COALESCE сохранит старое)
    const tgNorm = normalizeTelegram(telegram);

    await db.query(
      `UPDATE clients
         SET name = COALESCE($1, name),
             phone = COALESCE($2, phone),
             avatar_url = $3,
             telegram = COALESCE($4, telegram)
       WHERE id = $5`,
      [name ?? null, phone ?? null, remove_avatar ? null : avatar_url, tgNorm, req.user.id]
    );

    const q = await db.query(
      "SELECT id, name, email, phone, avatar_url, telegram FROM clients WHERE id=$1",
      [req.user.id]
    );
    res.json(q.rows[0] || null);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to update profile" });
  }
};

/* ==========
   STATISTICS
   ========== */

// GET /api/clients/stats
exports.getStats = async (req, res) => {
  try {
    if (req.user?.role !== "client") {
      return res.status(403).json({ message: "Only client" });
    }
    const clientId = req.user.id;

    // Примитивные подсчёты — подгоните под вашу схему
    const r1 = await db.query(
      "SELECT COUNT(*)::int AS c FROM change_requests WHERE client_id = $1",
      [clientId]
    );
    const r2 = await db.query(
      "SELECT COUNT(*)::int AS c FROM change_requests WHERE client_id = $1 AND status IN ('new','in_progress','accepted')",
      [clientId]
    );
    const b1 = await db.query(
      "SELECT COUNT(*)::int AS c FROM bookings WHERE client_id = $1",
      [clientId]
    );
    const b2 = await db.query(
      "SELECT COUNT(*)::int AS c FROM bookings WHERE client_id = $1 AND status = 'completed'",
      [clientId]
    );
    const b3 = await db.query(
      "SELECT COUNT(*)::int AS c FROM bookings WHERE client_id = $1 AND status = 'cancelled'",
      [clientId]
    );

    // Простейшая метрика рейтинга (можете заменить на реальную)
    const rating =
      b1.rows[0].c > 0
        ? Math.max(3, Math.min(5, 3 + (b2.rows[0].c - b3.rows[0].c) / Math.max(1, b1.rows[0].c)))
        : 3;

    const points = b2.rows[0].c * 50; // 50 pts за выполненное
    const tier =
      points >= 2000 ? "Platinum" :
      points >= 1000 ? "Gold" :
      points >= 500  ? "Silver" : "Bronze";
    const next_tier_at =
      tier === "Platinum" ? points :
      tier === "Gold"     ? 2000 :
      tier === "Silver"   ? 1000 : 500;

    res.json({
      rating,
      points,
      tier,
      next_tier_at,
      requests_total: r1.rows[0].c,
      requests_active: r2.rows[0].c,
      bookings_total: b1.rows[0].c,
      bookings_completed: b2.rows[0].c,
      bookings_cancelled: b3.rows[0].c,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to load stats" });
  }
};

/* ==============
   CHANGE PASSWORD
   ============== */

// POST /api/clients/change-password
exports.changePassword = async (req, res) => {
  try {
    if (req.user?.role !== "client") {
      return res.status(403).json({ message: "Only client" });
    }
    const { password } = req.body || {};
    if (!password || password.length < 6) {
      return res.status(400).json({ message: "Пароль слишком короткий" });
    }
    const hash = await bcrypt.hash(password, 10);
    await db.query(
      "UPDATE clients SET password_hash = $1 WHERE id = $2",
      [hash, req.user.id]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to change password" });
  }
};

/* Алиасы под старые имена, если они используются в routes */
exports.getProfile = exports.getMe;
exports.updateProfile = exports.updateMe;
