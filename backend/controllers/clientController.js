// backend/controllers/clientController.js
const db = require("../db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

/* ================= Helpers ================= */
function signToken(payload) {
  const secret = process.env.JWT_SECRET || "secret";
  return jwt.sign(payload, secret, { expiresIn: "30d" });
}

// Нормализуем любые варианты ввода Telegram в вид "@username"
function normalizeTelegramUsername(input) {
  if (!input) return null;
  let s = String(input).trim();
  if (!s) return null;
  s = s.replace(/\s+/g, "");

  // tg://resolve?domain=USERNAME
  let m = s.match(/^tg:\/\/resolve\?domain=([A-Za-z0-9_]{3,})/i);
  if (m) return "@" + m[1];

  // https://t.me/USERNAME, telegram.me, telegram.dog
  m = s.match(/^(?:https?:\/\/)?(?:t\.me|telegram\.me|telegram\.dog)\/@?([A-Za-z0-9_]{3,})$/i);
  if (m) return "@" + m[1];

  // @username или username
  m = s.match(/^@?([A-Za-z0-9_]{3,})$/);
  if (m) return "@" + m[1];

  // если это приглашение/группа — оставим как есть
  return s;
}

/* =============== AUTH =============== */
// POST /api/clients/register
exports.register = async (req, res) => {
  try {
    const { name, email, phone, password, telegram } = req.body || {};
    const telegramNorm = normalizeTelegramUsername(telegram);

    if (!name || !password || (!email && !phone)) {
      return res
        .status(400)
        .json({ message: "Name, password и email или phone обязательны" });
    }

    if (email) {
      const q = await db.query("SELECT id FROM clients WHERE email = $1", [email]);
      if (q.rows.length > 0) return res.status(400).json({ message: "Email уже используется" });
    }
    if (phone) {
      const q = await db.query("SELECT id FROM clients WHERE phone = $1", [phone]);
      if (q.rows.length > 0) return res.status(400).json({ message: "Телефон уже используется" });
    }

    const password_hash = await bcrypt.hash(password, 10);
    const telegramNorm = normalizeTelegramUsername(telegram);
    const ins = await db.query(
      `INSERT INTO clients (name, email, phone, telegram, password_hash, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5, NOW(), NOW())
       RETURNING id, name, email, phone, telegram, avatar_url`,
      [name, email || null, phone || null, telegramNorm || null, password_hash]
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
    if (q.rows.length === 0) return res.status(400).json({ message: "Клиент не найден" });

    const client = q.rows[0];
    const ok =
      client.password_hash && (await bcrypt.compare(password, client.password_hash));
    if (!ok) return res.status(400).json({ message: "Неверный пароль" });

    const token = signToken({ id: client.id, role: "client" });

    res.json({
      token,
      client: {
        id: client.id,
        name: client.name,
        email: client.email,
        phone: client.phone,
        telegram: client.telegram,          // ← здесь
        avatar_url: client.avatar_url,
        telegram_chat_id: client.telegram_chat_id || null,
        tg_chat_id: client.telegram_chat_id || null,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to login" });
  }
};

/* ============ PROFILE (me / profile) ============ */
// GET /api/clients/me
exports.getMe = async (req, res) => {
  try {
    if (req.user?.role !== "client") {
      return res.status(403).json({ message: "Only client" });
    }
    const q = await db.query(
      `SELECT id, name, email, phone, telegram, avatar_url, telegram_chat_id
         FROM clients
        WHERE id = $1`,
      [req.user.id]
    );

    const row = q.rows[0] || null;
    if (!row) return res.json(null);

    // отдаём chat_id и алиас, чтобы фронту было удобно
    res.json({
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      telegram: row.telegram,
      avatar_url: row.avatar_url,
      telegram_chat_id: row.telegram_chat_id || null,
      tg_chat_id: row.telegram_chat_id || null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to load profile" });
  }
};

// PUT /api/clients/me
// PUT /api/clients/me
exports.updateMe = async (req, res) => {
  try {
    if (req.user?.role !== "client") {
      return res.status(403).json({ message: "Only client" });
    }

    const { name, phone, telegram, avatar_base64, remove_avatar } = req.body || {};

    // Текущее состояние
    const curQ = await db.query(
      "SELECT telegram, avatar_url, telegram_chat_id FROM clients WHERE id=$1",
      [req.user.id]
    );
    const current = curQ.rows[0] || {};

    // Прислали ли поле telegram вообще
    const hasTelegramInPayload = Object.prototype.hasOwnProperty.call(req.body || {}, "telegram");

    // Нормализуем вход
    const newTelegramNorm = hasTelegramInPayload ? normalizeTelegramUsername(telegram) : null;

    // Сравниваем «по-честному»
    const canon = (v) => (normalizeTelegramUsername(v) || "").replace(/^@/, "").toLowerCase();
    const tgChanged = hasTelegramInPayload && canon(newTelegramNorm) !== canon(current.telegram);

    // Готовим аватар
    let avatar_url = null;
    if (avatar_base64) {
      avatar_url = `data:image/jpeg;base64,${avatar_base64}`;
    } else if (!remove_avatar) {
      avatar_url = current.avatar_url || null;
    }

    // Обновление
    await db.query(
      `UPDATE clients
         SET name  = COALESCE($1, name),
             phone = COALESCE($2, phone),
             telegram = COALESCE($3, telegram),
             avatar_url = $4,
             telegram_chat_id = CASE WHEN $6::bool THEN NULL ELSE telegram_chat_id END,
             updated_at = NOW()
       WHERE id = $5`,
      [
        name ?? null,
        phone ?? null,
        newTelegramNorm ?? null,
        remove_avatar ? null : avatar_url,
        req.user.id,
        tgChanged
      ]
    );

    // Возвращаем обновлённое
    const q = await db.query(
      `SELECT id, name, email, phone, telegram, avatar_url, telegram_chat_id
         FROM clients
        WHERE id=$1`,
      [req.user.id]
    );
    const row = q.rows[0] || null;
    if (!row) return res.json(null);

    res.json({
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      telegram: row.telegram,
      avatar_url: row.avatar_url,
      telegram_chat_id: row.telegram_chat_id || null,
      tg_chat_id: row.telegram_chat_id || null,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to update profile" });
  }
};


/* ============== STATISTICS ============== */
// GET /api/clients/stats
exports.getStats = async (req, res) => {
  try {
    if (req.user?.role !== "client") {
      return res.status(403).json({ message: "Only client" });
    }
    const clientId = req.user.id;

    // Эти таблицы подгоняй под свою схему при необходимости
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

    const rating =
      b1.rows[0].c > 0
        ? Math.max(3, Math.min(5, 3 + (b2.rows[0].c - b3.rows[0].c) / Math.max(1, b1.rows[0].c)))
        : 3;

    const points = b2.rows[0].c * 50;
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

/* ============ CHANGE PASSWORD ============ */
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
      "UPDATE clients SET password_hash = $1, updated_at = NOW() WHERE id = $2",
      [hash, req.user.id]
    );
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to change password" });
  }
};

/* Алиасы под старые имена, если где-то используются */
exports.getProfile = exports.getMe;
exports.updateProfile = exports.updateMe;
