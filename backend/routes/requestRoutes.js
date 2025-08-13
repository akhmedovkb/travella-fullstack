// backend/routes/requestRoutes.js
const express = require("express");
const router = express.Router();
const authenticateToken = require("../middleware/authenticateToken");

/**
 * ⚠️ Доступ к данным
 * Ниже используются простые обёртки getServiceById/getUserById/createQuickRequest/findQuickRequestsByProvider.
 * Подставь внутрь их реализацию под свою БД (Mongo/SQL/Prisma и т.д.).
 * Сейчас есть безопасный in-memory fallback для dev.
 */

// ===== In-memory fallback (на случай отсутствия БД в dev) =====
const __mem = global.__travella_mem || {
  services: new Map(), // id -> { id, title, provider_id }
  users: new Map(),    // id -> { id, name, phone, telegram, role }
  requests: [],        // { id, type:'quick', service_id, provider_id, client_id, note, status, created_at }
};
global.__travella_mem = __mem;

// ——— Заглушки данных (замени на реальные вызовы БД) ———
async function getServiceById(id) {
  // TODO: заменить на Service.findById(id)
  return __mem.services.get(String(id)) || null;
}
async function getUserById(id) {
  // TODO: заменить на User.findById(id)
  return __mem.users.get(String(id)) || null;
}
async function createQuickRequest(doc) {
  // TODO: заменить на Request.create(...)
  const id = String(Date.now()) + Math.random().toString(36).slice(2, 7);
  const rec = { id, ...doc };
  __mem.requests.push(rec);
  return rec;
}
async function findQuickRequestsByProvider(provider_id) {
  // TODO: заменить на Request.find({ provider_id, type:'quick' }).sort({created_at:-1})
  return __mem.requests
    .filter((r) => String(r.provider_id) === String(provider_id) && r.type === "quick")
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// ===============================================================
// POST /api/requests/quick — создать «быстрый запрос»
router.post("/quick", authenticateToken, async (req, res) => {
  try {
    const clientId = req.user?.id;
    if (!clientId) return res.status(401).json({ error: "unauthorized" });

    const { service_id, note } = req.body || {};
    if (!service_id) return res.status(400).json({ error: "service_id required" });

    const svc = await getServiceById(service_id);
    if (!svc) return res.status(404).json({ error: "service_not_found" });

    // предполагаемые поля владельца услуги
    const provider_id =
      svc.provider_id || svc.providerId || svc.owner_id || svc.agency_id || svc.user_id;

    const rec = await createQuickRequest({
      type: "quick",
      service_id,
      provider_id,
      client_id: clientId,
      note: note || null,           // комментарий клиента (нужен по сценарию)
      status: "new",
      created_at: new Date().toISOString(),
    });

    return res.json({ ok: true, id: rec.id });
  } catch (e) {
    console.error("quick request error:", e);
    return res.status(500).json({ error: "request_create_failed" });
  }
});

// GET /api/requests/provider/inbox — входящие провайдера (минимальный набор)
router.get("/provider/inbox", authenticateToken, async (req, res) => {
  try {
    const providerId = req.user?.id;
    if (!providerId) return res.status(401).json({ error: "unauthorized" });

    const rows = await findQuickRequestsByProvider(providerId);

    const items = await Promise.all(
      rows.map(async (r) => {
        const svc = await getServiceById(r.service_id);
        const cli = await getUserById(r.client_id);
        return {
          id: r.id,
          created_at: r.created_at,
          status: r.status || "new",
          note: r.note || null, // 👈 показываем комментарий
          service: svc
            ? { id: svc.id, title: svc.title || svc.name || "Service" }
            : null,
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

    return res.json({ items });
  } catch (e) {
    console.error("inbox error:", e);
    return res.status(500).json({ error: "inbox_load_failed" });
  }
});

module.exports = router;
