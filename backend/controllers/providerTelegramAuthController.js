// backend/controllers/providerTelegramAuthController.js
// Telegram web-login for already approved/linked providers.
// Does NOT create a provider automatically. If Telegram is not linked yet,
// frontend should send the supplier to the bot so the existing moderation/link flow stays intact.

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const pool = require("../db");

function getBotToken() {
  // Provider web-login must be verified with the same bot that rendered
  // the Telegram Login Widget on the provider login page. Do not prefer
  // TELEGRAM_CLIENT_BOT_TOKEN here: it produces TELEGRAM_HASH_INVALID.
  return (
    process.env.TELEGRAM_PROVIDER_BOT_TOKEN ||
    process.env.TELEGRAM_BOT_TOKEN ||
    process.env.TG_BOT_TOKEN ||
    process.env.TELEGRAM_CLIENT_BOT_TOKEN ||
    ""
  );
}

function normalizeLanguagesISO(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    } catch (_) {}
    return value.split(",").map((x) => x.trim()).filter(Boolean);
  }
  return [];
}

async function tableColumns(tableName, columnNames) {
  const q = await pool.query(
    `
      SELECT column_name
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = $1
         AND column_name = ANY($2::text[])
    `,
    [tableName, columnNames]
  );
  const found = new Set(q.rows.map((r) => r.column_name));
  return Object.fromEntries(columnNames.map((c) => [c, found.has(c)]));
}

function verifyTelegramLogin(payload) {
  const botToken = getBotToken();
  if (!botToken) {
    const err = new Error("TELEGRAM_BOT_TOKEN_NOT_CONFIGURED");
    err.status = 500;
    throw err;
  }

  const data = { ...(payload || {}) };
  const hash = String(data.hash || "");
  delete data.hash;

  if (!hash || !data.id || !data.auth_date) {
    const err = new Error("BAD_TELEGRAM_PAYLOAD");
    err.status = 400;
    throw err;
  }

  const authDate = Number(data.auth_date);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(authDate) || nowSec - authDate > 86400) {
    const err = new Error("TELEGRAM_AUTH_EXPIRED");
    err.status = 401;
    throw err;
  }

  const checkString = Object.keys(data)
    .filter((key) => data[key] !== undefined && data[key] !== null && data[key] !== "")
    .sort()
    .map((key) => `${key}=${data[key]}`)
    .join("\n");

  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const expectedHash = crypto
    .createHmac("sha256", secretKey)
    .update(checkString)
    .digest("hex");

  const a = Buffer.from(expectedHash, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    const err = new Error("TELEGRAM_HASH_INVALID");
    err.status = 401;
    throw err;
  }

  return data;
}

async function findProviderByTelegramId(telegramId) {
  const cols = await tableColumns("providers", [
    "telegram_chat_id",
    "tg_chat_id",
    "telegram_web_chat_id",
    "telegram_refused_chat_id",
    "hotel_id",
    "is_admin",
    "city_slugs",
    "car_fleet",
    "languages",
    "certificate",
    "address",
    "photo",
    "social",
    "status",
    "moderation_status",
    "is_active",
    "is_approved",
  ]);

  const whereParts = [];
  for (const col of ["telegram_chat_id", "tg_chat_id", "telegram_web_chat_id", "telegram_refused_chat_id"]) {
    if (cols[col]) whereParts.push(`${col}::text = $1`);
  }

  if (!whereParts.length) return { provider: null, cols };

  const q = await pool.query(
    `
      SELECT *
        FROM providers
       WHERE ${whereParts.join(" OR ")}
       ORDER BY id DESC
       LIMIT 1
    `,
    [String(telegramId)]
  );

  return { provider: q.rows[0] || null, cols };
}

function providerLooksBlocked(row, cols) {
  if (!row) return true;

  // Keep this permissive to avoid locking out old approved providers.
  // Only block explicit negative statuses.
  const status = String(row.status || "").toLowerCase();
  const moderation = String(row.moderation_status || "").toLowerCase();

  if (cols.is_active && row.is_active === false) return true;
  if (["blocked", "banned", "deleted", "rejected"].includes(status)) return true;
  if (["blocked", "banned", "deleted", "rejected"].includes(moderation)) return true;

  return false;
}

function buildProviderResponse(row, cols) {
  const isAdmin = row.is_admin === true;
  return {
    id: row.id,
    hotel_id: cols.hotel_id ? row.hotel_id ?? null : null,
    name: row.name,
    email: row.email,
    type: row.type,
    location: row.location,
    phone: row.phone,
    social: row.social,
    photo: row.photo,
    address: row.address,
    certificate: row.certificate,
    telegram_chat_id: row.telegram_chat_id || row.tg_chat_id || row.telegram_web_chat_id || null,
    tg_chat_id: row.telegram_chat_id || row.tg_chat_id || row.telegram_web_chat_id || null,
    avatar_url: row.photo || null,
    languages: normalizeLanguagesISO(row.languages ?? []),
    role: "provider",
    is_admin: isAdmin,
    city_slugs: Array.isArray(row.city_slugs) ? row.city_slugs : [],
    car_fleet: Array.isArray(row.car_fleet) ? row.car_fleet : [],
  };
}

async function syncTelegramFields(providerId, tg, cols) {
  const updates = [];
  const values = [];
  const push = (column, value) => {
    if (!cols[column] || value === undefined || value === null || value === "") return;
    values.push(value);
    updates.push(`${column} = $${values.length}`);
  };

  // Prefer telegram_web_chat_id for web login, but do not require it.
  push("telegram_web_chat_id", String(tg.id));
  if (cols.telegram_chat_id) push("telegram_chat_id", String(tg.id));

  if (!updates.length) return;
  values.push(providerId);
  await pool.query(
    `UPDATE providers SET ${updates.join(", ")} WHERE id = $${values.length}`,
    values
  );
}

async function loginProviderWithTelegram(req, res) {
  try {
    const tg = verifyTelegramLogin(req.body || {});
    const { provider, cols } = await findProviderByTelegramId(tg.id);

    if (!provider) {
      return res.status(404).json({
        success: false,
        code: "PROVIDER_TELEGRAM_NOT_LINKED",
        needs_bot_link: true,
        message:
          "Telegram is not linked to an approved provider profile yet. Open the bot and share the phone number used for provider moderation.",
      });
    }

    if (providerLooksBlocked(provider, cols)) {
      return res.status(403).json({
        success: false,
        code: "PROVIDER_NOT_APPROVED",
        message: "Provider profile is not approved or is blocked.",
      });
    }

    await syncTelegramFields(provider.id, tg, cols);

    const isAdmin = provider.is_admin === true;
    const token = jwt.sign(
      {
        id: provider.id,
        role: "provider",
        roles: isAdmin ? ["admin"] : [],
        is_admin: isAdmin,
        telegram_id: String(tg.id),
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({
      success: true,
      message: "Вход через Telegram выполнен",
      token,
      provider: buildProviderResponse(provider, cols),
    });
  } catch (err) {
    console.error("[provider-telegram-login] error:", err);
    return res.status(err.status || 500).json({
      success: false,
      code: err.message || "SERVER_ERROR",
      message: "Telegram login failed",
    });
  }
}

module.exports = { loginProviderWithTelegram };
