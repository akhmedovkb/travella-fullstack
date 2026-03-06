// backend/controllers/telegramWebAuthController.js
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const pool = require("../db");

const JWT_SECRET = process.env.JWT_SECRET || "changeme_in_env";
const LOGIN_MAX_AGE_SEC = Number(process.env.TELEGRAM_LOGIN_MAX_AGE_SEC || 86400);

function getTelegramBotToken() {
  return (
    process.env.TELEGRAM_LOGIN_BOT_TOKEN ||
    process.env.TELEGRAM_CLIENT_BOT_TOKEN ||
    process.env.TELEGRAM_BOT_TOKEN ||
    ""
  );
}

function safeEqHex(a, b) {
  try {
    const aa = Buffer.from(String(a || ""), "hex");
    const bb = Buffer.from(String(b || ""), "hex");
    if (!aa.length || !bb.length || aa.length !== bb.length) return false;
    return crypto.timingSafeEqual(aa, bb);
  } catch {
    return false;
  }
}

function verifyTelegramAuth(payload) {
  const hash = String(payload?.hash || "");
  const botToken = getTelegramBotToken();

  if (!hash || !botToken) {
    return { ok: false, error: "telegram_login_not_configured" };
  }

  const authDate = Number(payload?.auth_date || 0);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!authDate || Math.abs(nowSec - authDate) > LOGIN_MAX_AGE_SEC) {
    return { ok: false, error: "telegram_auth_expired" };
  }

  const dataCheckString = Object.keys(payload || {})
    .filter((k) => k !== "hash" && payload[k] !== undefined && payload[k] !== null && payload[k] !== "")
    .sort()
    .map((k) => `${k}=${payload[k]}`)
    .join("\n");

  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (!safeEqHex(computedHash, hash)) {
    return { ok: false, error: "telegram_bad_hash" };
  }

  return { ok: true };
}

async function getTableColumns(client, tableName, candidates) {
  const { rows } = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
        AND column_name = ANY($2::text[])
    `,
    [tableName, candidates]
  );
  const set = new Set(rows.map((r) => r.column_name));
  return candidates.reduce((acc, c) => {
    acc[c] = set.has(c);
    return acc;
  }, {});
}

function signProvider(providerRow) {
  const isAdmin = providerRow?.is_admin === true;
  return jwt.sign(
    {
      id: providerRow.id,
      role: "provider",
      roles: isAdmin ? ["admin"] : [],
      is_admin: isAdmin,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function signClient(clientRow) {
  return jwt.sign(
    {
      id: clientRow.id,
      role: "client",
    },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function withAt(username) {
  const u = String(username || "").trim();
  if (!u) return null;
  return u.startsWith("@") ? u : `@${u}`;
}

async function touchProviderTelegram(db, providerId, tgUser) {
  const cols = await getTableColumns(db, "providers", [
    "telegram_chat_id",
    "tg_chat_id",
    "telegram_web_chat_id",
    "social",
  ]);

  const sets = [];
  const vals = [];
  let i = 1;

  if (cols.telegram_chat_id) {
    sets.push(`telegram_chat_id = $${i++}`);
    vals.push(String(tgUser.id));
  }
  if (cols.tg_chat_id) {
    sets.push(`tg_chat_id = $${i++}`);
    vals.push(String(tgUser.id));
  }
  if (cols.telegram_web_chat_id) {
    sets.push(`telegram_web_chat_id = $${i++}`);
    vals.push(String(tgUser.id));
  }
  if (cols.social && tgUser.username) {
    sets.push(`social = COALESCE(NULLIF(social, ''), $${i++})`);
    vals.push(withAt(tgUser.username));
  }

  if (!sets.length) return;

  vals.push(providerId);
  await db.query(
    `UPDATE providers SET ${sets.join(", ")} WHERE id = $${i}`,
    vals
  );
}

async function touchClientTelegram(db, clientId, tgUser) {
  const cols = await getTableColumns(db, "clients", [
    "telegram_chat_id",
    "telegram",
  ]);

  const sets = [];
  const vals = [];
  let i = 1;

  if (cols.telegram_chat_id) {
    sets.push(`telegram_chat_id = $${i++}`);
    vals.push(String(tgUser.id));
  }
  if (cols.telegram && tgUser.username) {
    sets.push(`telegram = COALESCE(NULLIF(telegram, ''), $${i++})`);
    vals.push(withAt(tgUser.username));
  }

  if (!sets.length) return;

  vals.push(clientId);
  await db.query(
    `UPDATE clients SET ${sets.join(", ")} WHERE id = $${i}`,
    vals
  );
}

async function loginWithTelegram(req, res) {
  const tgUser = req.body || {};
  const requestedRole = String(tgUser.role || "").trim().toLowerCase();

  const verified = verifyTelegramAuth(tgUser);
  if (!verified.ok) {
    return res.status(401).json({ ok: false, error: verified.error });
  }

  const tgId = String(tgUser.id || "").trim();
  if (!tgId) {
    return res.status(400).json({ ok: false, error: "telegram_id_required" });
  }

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    if (!requestedRole || requestedRole === "provider") {
      const prov = await db.query(
        `
          SELECT *
          FROM providers
          WHERE telegram_chat_id::text = $1
             OR tg_chat_id::text = $1
             OR COALESCE(telegram_web_chat_id::text, '') = $1
             OR COALESCE(telegram_refused_chat_id::text, '') = $1
          ORDER BY id DESC
          LIMIT 1
        `,
        [tgId]
      );

      if (prov.rowCount) {
        const row = prov.rows[0];
        await touchProviderTelegram(db, row.id, tgUser);
        await db.query("COMMIT");

        const token = signProvider(row);

        return res.json({
          ok: true,
          role: "provider",
          token,
          provider: {
            id: row.id,
            name: row.name,
            email: row.email,
            type: row.type,
            phone: row.phone,
            social: row.social,
            telegram_chat_id: row.telegram_chat_id || null,
            tg_chat_id: row.tg_chat_id || row.telegram_chat_id || null,
          },
        });
      }
    }

    if (!requestedRole || requestedRole === "client") {
      const cli = await db.query(
        `
          SELECT *
          FROM clients
          WHERE telegram_chat_id::text = $1
          ORDER BY id DESC
          LIMIT 1
        `,
        [tgId]
      );

      if (cli.rowCount) {
        const row = cli.rows[0];
        await touchClientTelegram(db, row.id, tgUser);
        await db.query("COMMIT");

        const token = signClient(row);

        return res.json({
          ok: true,
          role: "client",
          token,
          client: {
            id: row.id,
            name: row.name,
            email: row.email,
            phone: row.phone,
            telegram: row.telegram || null,
            telegram_chat_id: row.telegram_chat_id || null,
          },
        });
      }
    }

    await db.query("ROLLBACK");
    return res.status(403).json({
      ok: false,
      error: "account_not_approved_or_not_linked",
      message:
        "Аккаунт не найден. Сначала пройди модерацию в лидах и привяжи Telegram.",
    });
  } catch (e) {
    try {
      await db.query("ROLLBACK");
    } catch {}
    console.error("loginWithTelegram error:", e);
    return res.status(500).json({ ok: false, error: "server_error" });
  } finally {
    db.release();
  }
}

module.exports = {
  loginWithTelegram,
};
