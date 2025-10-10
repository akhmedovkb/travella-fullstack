// backend/middleware/authenticateToken.js
const jwt = require("jsonwebtoken");
const pool = require("../db");
const JWT_SECRET = process.env.JWT_SECRET || "changeme_in_env";

// мини-кэш на процесс (опционально)
const cache = new Map(); // key: provider:<id> -> {is_admin,is_moderator,permissions,ts}

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

  const val = p ? {
    is_admin: !!(p.is_admin || p.admin === true),
    is_moderator: !!(p.is_moderator || p.moderator === true),
    permissions: Array.isArray(p.permissions) ? p.permissions : [],
    ts: now
  } : null;

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

    // Унифицируем id
    const rawId =
      payload.id ?? payload.userId ?? payload.uid ??
      payload.clientId ?? payload.providerId ?? payload.sub ?? null;
    const idNum = Number(rawId);
    const id = Number.isFinite(idNum) ? idNum : rawId; // если PK строковый — оставим строкой

    // Кандидат роли из токена
    let role = payload.role ?? payload.type ?? null;

    // Флаги по БД (только если id есть и это, вероятно, провайдер)
    let pFlags = null;
    if (id != null) {
      try {
        pFlags = await readProviderFlags(id); // null, если провайдер не найден
      } catch (dbErr) {
        console.error("auth role/flags infer error:", dbErr);
      }
    }

    // Если в БД нашли провайдера — это точно провайдер
    if (pFlags && !role) role = "provider";

    // Если провайдера не нашли — мягко проверим клиента (без апгрейда роли)
    if (!pFlags && !role && id != null) {
      try {
        const c = await pool.query("SELECT 1 FROM clients WHERE id=$1 LIMIT 1", [id]);
        if (c.rowCount > 0) role = "client";
      } catch {/* игнор */}
    }

    const roleLc = String(role || "").toLowerCase();

    // Флаги из токена (как минимум поддержим старые токены)
    const tokenAdmin =
      payload.is_admin === true ||
      payload.moderator === true ||
      roleLc === "admin" ||
      roleLc === "moderator";

    const is_admin = !!((pFlags && pFlags.is_admin) || tokenAdmin);
    const is_moderator = !!((pFlags && pFlags.is_moderator) || roleLc === "moderator");

    req.user = {
      ...payload,
      id,
      role,
      is_admin,
      is_moderator,
      permissions: (pFlags && pFlags.permissions) || payload.permissions || [],
    };

    return next();
  } catch (e) {
    console.error("auth middleware error:", e);
    return res.status(401).json({ message: "Unauthorized" });
  }
};
