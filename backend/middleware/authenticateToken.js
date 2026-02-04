// backend/middleware/authenticateToken.js
const jwt = require("jsonwebtoken");
const pool = require("../db");

const JWT_SECRET = process.env.JWT_SECRET || "changeme_in_env";

// мини-кэш на процесс (опционально)
// key: provider:<id> -> {is_admin,is_moderator,permissions,email,name,ts}
const cache = new Map();

function pickEmail(obj) {
  if (!obj) return null;
  return obj.email || obj.mail || obj.login || null;
}

function pickName(obj) {
  if (!obj) return null;
  return obj.name || obj.full_name || obj.fullname || obj.company_name || null;
}

async function readProviderFlags(id) {
  const key = `provider:${id}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.ts < 60_000) return hit;

  const { rows } = await pool.query(
    "SELECT to_jsonb(p) AS p FROM providers p WHERE id = $1 LIMIT 1",
    [id]
  );

  const p = rows[0]?.p || null;

  const val = p
    ? {
        is_admin: !!(p.is_admin || p.admin === true),
        is_moderator: !!(p.is_moderator || p.moderator === true),
        permissions: Array.isArray(p.permissions) ? p.permissions : [],
        email: pickEmail(p),
        name: pickName(p),
        ts: now,
      }
    : null;

  cache.set(key, val ? val : { ts: now });
  return val;
}

async function readClientIdentity(id) {
  // используем отдельный ключ, чтобы не конфликтовать с provider:<id>
  const key = `client:${id}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.ts < 60_000) return hit;

  // Подстрой под свои реальные поля в clients (часто: email/full_name/name/phone)
  const { rows } = await pool.query(
    `
    SELECT
      id,
      email,
      full_name,
      name
    FROM clients
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );

  const c = rows[0] || null;
  const val = c
    ? {
        email: pickEmail(c),
        name: pickName(c),
        ts: now,
      }
    : null;

  cache.set(key, val ? val : { ts: now });
  return val;
}

module.exports = async function authenticateToken(req, res, next) {
  try {
    const hdr = req.headers["authorization"];
    if (!hdr) return res.status(401).json({ message: "Missing Authorization" });

    const m = /^Bearer\s+(.+)$/i.exec(hdr);
    const token = m ? m[1] : hdr;

    let payload;
    try {
      payload = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ message: "Invalid token" });
    }

    // унифицируем id
    const rawId =
      payload.id ??
      payload.userId ??
      payload.uid ??
      payload.clientId ??
      payload.providerId ??
      payload.sub ??
      null;

    const idNum = Number(rawId);
    const id = Number.isFinite(idNum) ? idNum : rawId;

    // роль из токена (если есть)
    let role = payload.role ?? payload.type ?? null;

    // roles[] из токена
    const roles = []
      .concat(payload.roles || [])
      .flatMap((r) => String(r).split(","))
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    // пробуем понять провайдера по БД (и флаги + email/name)
    let pFlags = null;
    if (id != null) {
      try {
        pFlags = await readProviderFlags(id);
      } catch (dbErr) {
        console.error("auth role/flags infer error:", dbErr);
      }
    }

    // если в БД нашли провайдера — это провайдер
    if (pFlags && !role) role = "provider";

    // если провайдера не нашли — мягко проверим клиента
    let cIdentity = null;
    if (!pFlags && !role && id != null) {
      try {
        const c = await pool.query("SELECT 1 FROM clients WHERE id=$1 LIMIT 1", [id]);
        if (c.rowCount > 0) {
          role = "client";
          // и сразу подтянем identity (email/name) чтобы аудит не был null
          try {
            cIdentity = await readClientIdentity(id);
          } catch (e) {
            console.error("auth client identity error:", e);
          }
        }
      } catch {
        // ignore
      }
    }

    const roleLc = String(role || "").toLowerCase();

    // админ/модератор из токена (поддерживаем разные форматы)
    const tokenSaysAdmin =
      payload.is_admin === true ||
      payload.isAdmin === true ||
      roleLc === "admin" ||
      roles.includes("admin");

    const tokenSaysModerator =
      payload.is_moderator === true ||
      payload.isModerator === true ||
      payload.moderator === true ||
      roleLc === "moderator" ||
      roles.includes("moderator");

    const is_admin = !!((pFlags && pFlags.is_admin) || tokenSaysAdmin);
    const is_moderator = !!((pFlags && pFlags.is_moderator) || tokenSaysModerator);

    // ======= ВАЖНО ДЛЯ АУДИТА: email/name =======
    // Приоритет:
    // 1) то что уже есть в токене (payload.email/mail/full_name)
    // 2) из providers (pFlags.email/name)
    // 3) из clients (cIdentity.email/name)
    const email =
      pickEmail(payload) ||
      (pFlags && pFlags.email) ||
      (cIdentity && cIdentity.email) ||
      null;

    const name =
      pickName(payload) ||
      (pFlags && pFlags.name) ||
      (cIdentity && cIdentity.name) ||
      null;

    req.user = {
      ...payload,
      id,
      role,
      roles,
      is_admin,
      is_moderator,
      permissions: (pFlags && pFlags.permissions) || payload.permissions || [],

      // нормализованные поля (их используй в audit)
      email,
      name,

      // для совместимости (если где-то в коде ждут эти ключи)
      mail: payload.mail || email || null,
      full_name: payload.full_name || payload.fullname || name || null,
    };

    return next();
  } catch (e) {
    console.error("auth middleware error:", e);
    return res.status(401).json({ message: "Unauthorized" });
  }
};
