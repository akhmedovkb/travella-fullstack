// backend/routes/requestRoutes.js
const express = require("express");
const router = express.Router();
const authenticateToken = require("../middleware/authenticateToken");

/* ===================== DB handle (optional) ===================== */
let db = null;
try {
  db = require("../db"); // ожидается { query(sql, params) }
} catch (_) {
  db = null;
}
const HAS_DB = !!(db && typeof db.query === "function");

/* =================== In-memory fallback (dev) =================== */
const __mem = global.__travella_mem || {
  services: new Map(), // id -> { id, title, provider_id, ... }
  users: new Map(),    // id -> { id, name, phone, telegram }
  requests: [],        // { id, service_id, client_id, note, status, created_at }
};
global.__travella_mem = __mem;

/* =========================== Helpers ============================ */
async function getServiceById(id) {
  if (HAS_DB) {
    const { rows } = await db.query(
      "SELECT id, title, provider_id FROM services WHERE id = $1 LIMIT 1",
      [id]
    );
    return rows[0] || null;
  }
  return __mem.services.get(String(id)) || null;
}

async function getClientById(id) {
  if (HAS_DB) {
    const { rows } = await db.query(
      "SELECT id, name, phone FROM clients WHERE id = $1 LIMIT 1",
      [id]
    );
    if (!rows[0]) return null;
    return { ...rows[0], telegram: null };
  }
  return __mem.users.get(String(id)) || null;
}

async function createQuickRequest({ service_id, client_id, note }) {
  if (HAS_DB) {
    const { rows } = await db.query(
      `INSERT INTO requests (service_id, client_id, status, note, created_at)
       VALUES ($1, $2, 'new', $3, NOW())
       RETURNING id, created_at`,
      [service_id, client_id, note || null]
    );
    return {
      id: rows[0].id,
      created_at: rows[0].created_at,
      service_id,
      client_id,
      note: note || null,
      status: "new",
    };
  }

  const id = String(Date.now()) + Math.random().toString(36).slice(2, 7);
  const rec = {
    id,
    service_id,
    client_id,
    note: note || null,
    status: "new",
    created_at: new Date().toISOString(),
  };
  __mem.requests.push(rec);
  return rec;
}

/* =================== Create “quick” request ===================== */
async function handleCreateQuick(req, res) {
  try {
    const clientId = req.user?.id;
    if (!clientId) return res.status(401).json({ error: "unauthorized" });

    const { service_id, note } = req.body || {};
    if (!service_id) return res.status(400).json({ error: "service_id required" });

    const svc = await getServiceById(service_id);
    if (!svc) return res.status(404).json({ error: "service_not_found" });

    const rec = await createQuickRequest({
      service_id,
      client_id: clientId,
      note: note || null,
    });

    return res.json({ ok: true, id: rec.id });
  } catch (e) {
    console.error("quick request error:", e);
    return res.status(500).json({ error: "request_create_failed" });
  }
}

/* ==================== Provider inbox loader ===================== */
function collectProviderIdsFromUser(user) {
  const ids = [
    user?.id,
    user?.provider_id,
    user?.profile_id,
    user?.company_id,
    user?.agency_id,
    user?.owner_id,
  ]
    .filter(Boolean)
    .map(String);
  return Array.from(new Set(ids));
}

async function findRequestsForProviders(providerIds) {
  if (HAS_DB) {
    // provider_id берём из services, т.к. его нет в requests
    const ids = providerIds
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v));

    const { rows } = await db.query(
      `
      SELECT
        r.id,
        r.created_at,
        r.status,
        r.note,
        r.service_id,
        r.client_id,
        COALESCE(s.title, '—')     AS service_title,
        COALESCE(c.name, '—')      AS client_name,
        c.phone                    AS client_phone
      FROM requests r
      JOIN services s ON s.id = r.service_id
      LEFT JOIN clients  c ON c.id = r.client_id
      WHERE s.provider_id = ANY($1)
      ORDER BY r.created_at DESC
      `,
      [ids]
    );
    return rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      status: r.status || "new",
      note: r.note || null,
      service: { id: r.service_id, title: r.service_title || "—" },
      client:  { id: r.client_id,  name: r.client_name || "—", phone: r.client_phone || null, telegram: null },
    }));
  }

  // in-memory
  const out = [];
  for (const r of __mem.requests) {
    const svc = await getServiceById(r.service_id);
    if (!svc) continue;
    if (!providerIds.includes(String(svc.provider_id))) continue;
    const cli = await getClientById(r.client_id);
    out.push({
      id: r.id,
      created_at: r.created_at,
      status: r.status || "new",
      note: r.note || null,
      service: { id: r.service_id, title: svc?.title || "—" },
      client:  { id: cli?.id || r.client_id, name: cli?.name || "—", phone: cli?.phone || null, telegram: cli?.telegram || null },
    });
  }
  // новее — выше
  out.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return out;
}

async function providerInboxHandler(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });
    const myIds = collectProviderIdsFromUser(req.user);
    const items = await findRequestsForProviders(myIds);
    return res.json({ items });
  } catch (e) {
    console.error("inbox error:", e);
    return res.status(500).json({ error: "inbox_load_failed" });
  }
}

/* ========================== Routes ============================== */
// создать быстрый запрос (новый и совместимый пути)
router.post("/quick", authenticateToken, handleCreateQuick);
router.post("/",       authenticateToken, handleCreateQuick);

// входящие провайдера (новый и совместимый пути)
router.get("/provider/inbox", authenticateToken, providerInboxHandler);
router.get("/provider",       authenticateToken, providerInboxHandler);

module.exports = router;
