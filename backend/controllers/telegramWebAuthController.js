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

  console.log("[tg-web-login] bot token prefix:", String(botToken || "").slice(0, 12));
  console.log("[tg-web-login] tg user id:", payload?.id, "username:", payload?.username);

  if (!hash || !botToken) {
    return { ok: false, error: "telegram_login_not_configured" };
  }

  const authDate = Number(payload?.auth_date || 0);
  const nowSec = Math.floor(Date.now() / 1000);
  if (!authDate || Math.abs(nowSec - authDate) > LOGIN_MAX_AGE_SEC) {
    return { ok: false, error: "telegram_auth_expired" };
  }

  const dataCheckString = Object.keys(payload || {})
    .filter(
      (k) =>
        k !== "hash" &&
        k !== "role" &&
        payload[k] !== undefined &&
        payload[k] !== null &&
        payload[k] !== ""
    )
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

function withAt(username) {
  const u = String(username || "").trim();
  if (!u) return null;
  return u.startsWith("@") ? u : `@${u}`;
}

function buildDisplayName(tgUser) {
  const first = String(tgUser?.first_name || "").trim();
  const last = String(tgUser?.last_name || "").trim();
  const full = `${first} ${last}`.trim();
  return full || tgUser?.username || `Telegram User ${tgUser?.id}`;
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

async function touchProviderTelegram(db, providerId, tgUser) {
  const cols = await getTableColumns(db, "providers", [
    "telegram_chat_id",
    "tg_chat_id",
    "telegram_web_chat_id",
    "social",
    "name",
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
  if (cols.name) {
    sets.push(`name = COALESCE(NULLIF(name, ''), $${i++})`);
    vals.push(buildDisplayName(tgUser));
  }

  if (!sets.length) return;

  vals.push(providerId);
  await db.query(`UPDATE providers SET ${sets.join(", ")} WHERE id = $${i}`, vals);
}

async function touchClientTelegram(db, clientId, tgUser) {
  const cols = await getTableColumns(db, "clients", [
    "telegram_chat_id",
    "telegram",
    "name",
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
  if (cols.name) {
    sets.push(`name = COALESCE(NULLIF(name, ''), $${i++})`);
    vals.push(buildDisplayName(tgUser));
  }

  if (!sets.length) return;

  vals.push(clientId);
  await db.query(`UPDATE clients SET ${sets.join(", ")} WHERE id = $${i}`, vals);
}

async function findProviderByTelegram(db, tgId) {
  return db.query(
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
}

async function findClientByTelegram(db, tgId) {
  return db.query(
    `
      SELECT *
      FROM clients
      WHERE telegram_chat_id::text = $1
      ORDER BY id DESC
      LIMIT 1
    `,
    [tgId]
  );
}

async function findApprovedLeadByTelegram(db, tgId, requestedRole) {
  const statuses =
    requestedRole === "provider"
      ? ["approved_provider"]
      : requestedRole === "client"
        ? ["approved_client"]
        : ["approved_provider", "approved_client"];

  const possibleChatCols = [
    "telegram_chat_id",
    "tg_chat_id",
    "chat_id",
    "telegram_id",
  ];

  const cols = await getTableColumns(db, "leads", [
    ...possibleChatCols,
    "status",
    "name",
    "phone",
    "email",
    "role",
    "type",
    "telegram",
    "telegram_username",
  ]);

  const existingChatCols = possibleChatCols.filter((c) => cols[c]);
  if (!existingChatCols.length || !cols.status) return null;

  const whereChat = existingChatCols
    .map((c) => `${c}::text = $1`)
    .join(" OR ");

  const q = await db.query(
    `
      SELECT *
      FROM leads
      WHERE (${whereChat})
        AND status = ANY($2::text[])
      ORDER BY id DESC
      LIMIT 1
    `,
    [tgId, statuses]
  );

  return q.rows[0] || null;
}

async function createClientFromLead(db, lead, tgUser) {
  const clientCols = await getTableColumns(db, "clients", [
    "name",
    "email",
    "phone",
    "telegram",
    "telegram_chat_id",
    "password",
    "contact_balance",
  ]);

  const fields = [];
  const values = [];
  let i = 1;

  const push = (field, value) => {
    fields.push(field);
    values.push(value);
    return `$${i++}`;
  };

  const placeholders = [];

  if (clientCols.name) {
    placeholders.push(push("name", lead.name || buildDisplayName(tgUser)));
  }
  if (clientCols.email) {
    placeholders.push(push("email", lead.email || null));
  }
  if (clientCols.phone) {
    placeholders.push(push("phone", lead.phone || null));
  }
  if (clientCols.telegram) {
    placeholders.push(push("telegram", withAt(tgUser.username)));
  }
  if (clientCols.telegram_chat_id) {
    placeholders.push(push("telegram_chat_id", String(tgUser.id)));
  }
  if (clientCols.password) {
    placeholders.push(push("password", null));
  }
  if (clientCols.contact_balance) {
    placeholders.push(push("contact_balance", 0));
  }

  const sql = `
    INSERT INTO clients (${fields.join(", ")})
    VALUES (${placeholders.join(", ")})
    RETURNING *
  `;
  const ins = await db.query(sql, values);
  return ins.rows[0];
}

async function createProviderFromLead(db, lead, tgUser) {
  const providerCols = await getTableColumns(db, "providers", [
    "name",
    "email",
    "phone",
    "social",
    "type",
    "telegram_chat_id",
    "tg_chat_id",
    "telegram_web_chat_id",
    "password",
  ]);

  const fields = [];
  const values = [];
  let i = 1;

  const push = (field, value) => {
    fields.push(field);
    values.push(value);
    return `$${i++}`;
  };

  const placeholders = [];

  if (providerCols.name) {
    placeholders.push(push("name", lead.name || buildDisplayName(tgUser)));
  }
  if (providerCols.email) {
    placeholders.push(push("email", lead.email || null));
  }
  if (providerCols.phone) {
    placeholders.push(push("phone", lead.phone || null));
  }
  if (providerCols.social) {
    placeholders.push(push("social", withAt(tgUser.username)));
  }
  if (providerCols.type) {
    placeholders.push(push("type", lead.type || "agent"));
  }
  if (providerCols.telegram_chat_id) {
    placeholders.push(push("telegram_chat_id", String(tgUser.id)));
  }
  if (providerCols.tg_chat_id) {
    placeholders.push(push("tg_chat_id", String(tgUser.id)));
  }
  if (providerCols.telegram_web_chat_id) {
    placeholders.push(push("telegram_web_chat_id", String(tgUser.id)));
  }
  if (providerCols.password) {
    placeholders.push(push("password", null));
  }

  const sql = `
    INSERT INTO providers (${fields.join(", ")})
    VALUES (${placeholders.join(", ")})
    RETURNING *
  `;
  const ins = await db.query(sql, values);
  return ins.rows[0];
}

async function upsertApprovedLeadAccount(db, lead, tgUser) {
  const status = String(lead?.status || "").trim().toLowerCase();

  if (status === "approved_client") {
    if (lead.phone) {
      const byPhone = await db.query(
        `SELECT * FROM clients WHERE phone = $1 ORDER BY id DESC LIMIT 1`,
        [lead.phone]
      );
      if (byPhone.rowCount) {
        await touchClientTelegram(db, byPhone.rows[0].id, tgUser);
        const refetch = await findClientByTelegram(db, String(tgUser.id));
        return { role: "client", row: refetch.rows[0] || byPhone.rows[0] };
      }
    }

    const created = await createClientFromLead(db, lead, tgUser);
    await touchClientTelegram(db, created.id, tgUser);
    const refetch = await findClientByTelegram(db, String(tgUser.id));
    return { role: "client", row: refetch.rows[0] || created };
  }

  if (status === "approved_provider") {
    if (lead.phone) {
      const byPhone = await db.query(
        `SELECT * FROM providers WHERE phone = $1 ORDER BY id DESC LIMIT 1`,
        [lead.phone]
      );
      if (byPhone.rowCount) {
        await touchProviderTelegram(db, byPhone.rows[0].id, tgUser);
        const refetch = await findProviderByTelegram(db, String(tgUser.id));
        return { role: "provider", row: refetch.rows[0] || byPhone.rows[0] };
      }
    }

    const created = await createProviderFromLead(db, lead, tgUser);
    await touchProviderTelegram(db, created.id, tgUser);
    const refetch = await findProviderByTelegram(db, String(tgUser.id));
    return { role: "provider", row: refetch.rows[0] || created };
  }

  return null;
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
      const prov = await findProviderByTelegram(db, tgId);
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
          },
        });
      }
    }

    if (!requestedRole || requestedRole === "client") {
      const cli = await findClientByTelegram(db, tgId);
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
          },
        });
      }
    }

    const approvedLead = await findApprovedLeadByTelegram(db, tgId, requestedRole);
    if (approvedLead) {
      const created = await upsertApprovedLeadAccount(db, approvedLead, tgUser);

      if (created?.role === "provider") {
        await db.query("COMMIT");
        return res.json({
          ok: true,
          autoCreated: true,
          role: "provider",
          token: signProvider(created.row),
          provider: {
            id: created.row.id,
            name: created.row.name,
            email: created.row.email,
            type: created.row.type,
            phone: created.row.phone,
            social: created.row.social,
          },
        });
      }

      if (created?.role === "client") {
        await db.query("COMMIT");
        return res.json({
          ok: true,
          autoCreated: true,
          role: "client",
          token: signClient(created.row),
          client: {
            id: created.row.id,
            name: created.row.name,
            email: created.row.email,
            phone: created.row.phone,
            telegram: created.row.telegram || null,
          },
        });
      }
    }

    await db.query("ROLLBACK");
    return res.status(403).json({
      ok: false,
      error: "account_not_approved_or_not_linked",
      message: "Аккаунт не найден. Сначала пройди модерацию в лидах.",
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
