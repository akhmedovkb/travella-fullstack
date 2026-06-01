// backend/routes/profileRoutes.js
const express = require("express");
const jwt = require("jsonwebtoken");
const router = express.Router();
const db = require("../db");
const { getContactUnlockSettings } = require("../utils/contactUnlockSettings");

const JWT_SECRET = process.env.JWT_SECRET || "changeme_in_env";

/** Нормализуем аватар в строку, пригодную для <img src> */
function normalizeAvatar(row) {
  const v = row?.avatar_url ?? row?.avatar ?? null;
  if (!v) return null;

  // Уже корректный URL / data URI
  if (typeof v === "string" && (/^https?:\/\//i.test(v) || /^data:/i.test(v))) return v;

  // Похоже на base64 без префикса — превращаем в data:
  if (typeof v === "string" && /^[A-Za-z0-9+/=\s]+$/.test(v) && v.length > 100) {
    return `data:image/jpeg;base64,${v.replace(/\s+/g, "")}`;
  }

  // bytea → Buffer (node-postgres обычно даёт Buffer)
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(v)) {
    return `data:image/jpeg;base64,${Buffer.from(v).toString("base64")}`;
  }

  // Иногда в avatar_url лежит JSON вида {"url":"..."}
  if (typeof v === "string") {
    try {
      const j = JSON.parse(v);
      const url = j?.url ?? j?.src ?? j?.href;
      if (url) return url;
    } catch {}
  }

  // Последняя попытка — отдать как есть (м.б. относительный путь)
  return String(v);
}

function getOptionalUserFromReq(req) {
  try {
    const auth = String(req.headers?.authorization || "");
    if (!auth.startsWith("Bearer ")) return null;
    const token = auth.slice(7).trim();
    if (!token) return null;
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

async function canViewerSeeProviderContacts({ viewer, providerId, serviceId }) {
  if (!viewer || !providerId) return false;

  const role = String(viewer.role || "").toLowerCase();
  const viewerId = Number(viewer.id);
  const pid = Number(providerId);
  const sid = Number(serviceId);

  if (!Number.isFinite(pid) || pid <= 0) return false;
  if (role === "admin") return true;
  if (role === "provider") return Number.isFinite(viewerId) && viewerId === pid;

  if (role === "client") {
    if (!Number.isFinite(viewerId) || viewerId <= 0) return false;

    const unlockSettings = await getContactUnlockSettings(db);
    if (!unlockSettings.is_paid) return true;

    if (Number.isFinite(sid) && sid > 0) {
      const q = await db.query(
        `
        SELECT 1
        FROM client_service_contact_unlocks u
        JOIN services s ON s.id = u.service_id
        WHERE u.client_id = $1
          AND u.service_id = $2
          AND s.provider_id = $3
        LIMIT 1
        `,
        [viewerId, sid, pid]
      );
      if (q.rowCount > 0) return true;
    }

    const qAny = await db.query(
      `
      SELECT 1
      FROM client_service_contact_unlocks u
      JOIN services s ON s.id = u.service_id
      WHERE u.client_id = $1
        AND s.provider_id = $2
      LIMIT 1
      `,
      [viewerId, pid]
    );
    return qAny.rowCount > 0;
  }

  return false;
}

/** Профиль клиента */
router.get("/client/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_id" });

    const q = await db.query(
      `SELECT id, name, phone, telegram, email, avatar_url, avatar
         FROM clients
        WHERE id = $1
        LIMIT 1`,
      [id]
    );
    if (!q.rowCount) return res.status(404).json({ error: "not_found" });

    const row = q.rows[0];
    const avatar_url = normalizeAvatar(row);

    // Отзывы позже подключим; сейчас — безопасные заглушки
    res.json({
      id: row.id,
      name: row.name,
      phone: row.phone,
      telegram: row.telegram,
      email: row.email,
      avatar_url,
      rating: { avg: 0, count: 0 },
      reviews: [],
    });
  } catch (e) {
    console.error("[profile client] error:", e?.stack || e);
    res.status(500).json({ error: "profile_load_failed" });
  }
});

/** Профиль провайдера: контакты скрыты до unlock / бесплатного режима / владельца / админа */
router.get("/provider/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "bad_id" });

    const serviceId = Number(req.query.serviceId || req.query.service_id || req.query.service || 0);
    const viewer = getOptionalUserFromReq(req);

    const q = await db.query(
      `SELECT id, name, phone, social AS telegram, email, avatar_url, avatar
         FROM providers
        WHERE id = $1
        LIMIT 1`,
      [id]
    );
    if (!q.rowCount) return res.status(404).json({ error: "not_found" });

    const row = q.rows[0];
    const avatar_url = normalizeAvatar(row);
    const contacts_unlocked = await canViewerSeeProviderContacts({
      viewer,
      providerId: row.id,
      serviceId,
    });

    res.json({
      id: row.id,
      name: row.name,
      phone: contacts_unlocked ? row.phone : null,
      telegram: contacts_unlocked ? row.telegram : null,
      email: contacts_unlocked ? row.email : null,
      avatar_url,
      contacts_unlocked,
      rating: { avg: 0, count: 0 },
      reviews: [],
    });
  } catch (e) {
    console.error("[profile provider] error:", e?.stack || e);
    res.status(500).json({ error: "profile_load_failed" });
  }
});

module.exports = router;
