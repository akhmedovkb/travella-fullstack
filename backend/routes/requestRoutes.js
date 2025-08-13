// backend/routes/requestRoutes.js
const express = require("express");
const router = express.Router();
const authenticateToken = require("../middleware/authenticateToken");

/** ===== In-memory fallback для dev =====
 * Поменяешь на реальные запросы к БД, когда будет модель.
 */
const __mem = global.__travella_mem || {
  services: new Map(), // id -> { id, title, provider_id, ... }
  users: new Map(),    // id -> { id, name, phone, telegram, role }
  requests: [],        // { id, type, service_id, provider_id, client_id, note, status, created_at, service_title? }
};
global.__travella_mem = __mem;

async function getServiceById(id) {
  return __mem.services.get(String(id)) || null;
}
async function getUserById(id) {
  return __mem.users.get(String(id)) || null;
}
async function createQuickRequest(doc) {
  const id = String(Date.now()) + Math.random().toString(36).slice(2, 7);
  const rec = { id, ...doc };
  __mem.requests.push(rec);
  return rec;
}

/** ===== Создание быстрого запроса ===== */
async function handleCreateQuick(req, res) {
  try {
    const clientId = req.user?.id || req.user?._id;
    if (!clientId) return res.status(401).json({ error: "unauthorized" });

    const { service_id, provider_id: providerIdFromBody, note } = req.body || {};
    if (!service_id) return res.status(400).json({ error: "service_id required" });

    let svc = null;
    try { svc = await getServiceById(service_id); } catch {}

    // Берём provider_id из услуги, иначе — из тела запроса
    let provider_id =
      svc?.provider_id ||
      svc?.providerId ||
      svc?.owner_id ||
      svc?.agency_id ||
      svc?.user_id ||
      null;

    if (!provider_id && providerIdFromBody) provider_id = providerIdFromBody;
    if (!provider_id) return res.status(404).json({ error: "service_not_found" });

    const rec = await createQuickRequest({
      type: "quick",
      service_id,
      provider_id,
      client_id: clientId,
      note: note || null,
      status: "new",
      created_at: new Date().toISOString(),
      service_title: svc?.title || svc?.name || null,
    });

    res.json({ ok: true, id: rec.id });
  } catch (e) {
    console.error("quick request error:", e);
    res.status(500).json({ error: "request_create_failed" });
  }
}

// POST /api/requests/quick (новый) + алиас /
router.post("/quick", authenticateToken, handleCreateQuick);
router.post("/", authenticateToken, handleCreateQuick);

/** ===== Inbox провайдера ===== */

// Собираем возможные идентификаторы провайдера из токена
function collectProviderIdsFromUser(user) {
  const ids = [
    user?.id,
    user?._id,              // <— частый случай
    user?.provider_id,
    user?.profile_id,
    user?.company_id,
    user?.agency_id,
    user?.owner_id,
  ].filter(Boolean).map(String);
  return Array.from(new Set(ids));
}

// Фильтрация по нескольким ID
async function findQuickRequestsByProviderMany(providerIds) {
  return __mem.requests
    .filter(r => r.type === "quick" && providerIds.includes(String(r.provider_id)))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function buildInboxItems(req) {
  const myIds = collectProviderIdsFromUser(req.user);
  const rows = await findQuickRequestsByProviderMany(myIds);

  const items = await Promise.all(
    rows.map(async (r) => {
      const svc = await getServiceById(r.service_id);
      const cli = await getUserById(r.client_id);
      return {
        id: r.id,
        created_at: r.created_at,
        status: r.status || "new",
        note: r.note || null,
        service: svc
          ? { id: svc.id, title: svc.title || svc.name || "Service" }
          : { id: r.service_id, title: r.service_title || "Service" },
        client: cli
          ? {
              id: cli.id,
              name: cli.name || cli.title || "Client",
              phone: cli.phone || null,
              telegram: cli.telegram || cli.tg || null,
            }
          : null,
      };
    })
  );

  return items;
}

// Новый формат (для новых страниц): { items: [...] }
router.get("/provider/inbox", authenticateToken, async (req, res) => {
  try {
    const items = await buildInboxItems(req);
    res.json({ items });
  } catch (e) {
    console.error("inbox error:", e);
    res.status(500).json({ error: "inbox_load_failed" });
  }
});

// Алиас под старый Dashboard: [] (массив напрямую)
router.get("/provider", authenticateToken, async (req, res) => {
  try {
    const items = await buildInboxItems(req);
    res.json(items); // <— массив
  } catch (e) {
    console.error("inbox error:", e);
    res.status(500).json({ error: "inbox_load_failed" });
  }
});

module.exports = router;
