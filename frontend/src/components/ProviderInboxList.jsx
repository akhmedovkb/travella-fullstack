// backend/routes/requestRoutes.js
const express = require("express");
const router = express.Router();
const authenticateToken = require("../middleware/authenticateToken");

/** ===== In-memory fallback для dev =====
 * Замените функции ниже на реальные вызовы БД (Mongo/Prisma/SQL) при наличии.
 */
const __mem = global.__travella_mem || {
  services: new Map(), // id -> { id, title, provider_id, ... }
  users: new Map(),    // id -> { id, name, phone, telegram, role }
  requests: [],        // { id, type, service_id, provider_id, client_id, note, status, created_at, service_title?, client_name? }
};
global.__travella_mem = __mem;

async function getServiceById(id) {
  // TODO: Service.findById(id)
  return __mem.services.get(String(id)) || null;
}
async function getUserById(id) {
  // TODO: User.findById(id)
  return __mem.users.get(String(id)) || null;
}
async function createQuickRequest(doc) {
  // TODO: Request.create(doc)
  const id = String(Date.now()) + Math.random().toString(36).slice(2, 7);
  const rec = { id, ...doc };
  __mem.requests.push(rec);
  return rec;
}

/** ===== Общий хендлер создания быстрого запроса ===== */
async function handleCreateQuick(req, res) {
  try {
    const clientId = req.user?.id;
    if (!clientId) return res.status(401).json({ error: "unauthorized" });

    const { service_id, provider_id: providerIdFromBody, note } = req.body || {};
    if (!service_id) return res.status(400).json({ error: "service_id required" });

    let svc = null;
    try { svc = await getServiceById(service_id); } catch (_) {}

    // 1) провайдер из услуги
    let provider_id =
      svc?.provider_id || svc?.providerId || svc?.owner_id || svc?.agency_id || svc?.user_id || null;

    // 2) фолбэк — если фронт передал
    if (!provider_id && providerIdFromBody) provider_id = providerIdFromBody;

    if (!provider_id) return res.status(404).json({ error: "service_not_found" });

    // ⬇️ НОВОЕ: денормализуем названия, чтобы инбокс мог показывать без join
    const service_title =
      svc?.title || svc?.name || null;
    const client_name =
      req.user?.name || req.user?.title || req.user?.login || req.user?.phone || "Клиент";

    const rec = await createQuickRequest({
      type: "quick",
      service_id,
      provider_id,
      client_id: clientId,
      note: note || null,       // комментарий клиента
      status: "new",
      created_at: new Date().toISOString(),
      service_title,            // ⬅️ добавили
      client_name,              // ⬅️ добавили
    });

    return res.json({ ok: true, id: rec.id });
  } catch (e) {
    console.error("quick request error:", e);
    return res.status(500).json({ error: "request_create_failed" });
  }
}

/** ===== Маршруты ===== */

// создать «быстрый запрос»
router.post("/quick", authenticateToken, handleCreateQuick);
// алиас старого пути
router.post("/", authenticateToken, handleCreateQuick);

// ===== helper: какие ID считать "моими" для провайдера
function collectProviderIdsFromUser(user) {
  const ids = [
    user?.id,
    user?.provider_id,
    user?.profile_id,
    user?.company_id,
    user?.agency_id,
    user?.owner_id,
  ].filter(Boolean).map(String);
  return Array.from(new Set(ids));
}

// находим все быстрые запросы по нескольким провайдер-ID
function findQuickRequestsByProviderMany(providerIds) {
  return __mem.requests
    .filter((r) => r.type === "quick" && providerIds.includes(String(r.provider_id)))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// единый хендлер инбокса
async function providerInboxHandler(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });

    const myIds = collectProviderIdsFromUser(req.user);
    const rows = findQuickRequestsByProviderMany(myIds);

    const items = await Promise.all(
      rows.map(async (r) => {
        const svc = await getServiceById(r.service_id);
        const cli = await getUserById(r.client_id);
        return {
          id: r.id,
          created_at: r.created_at,
          status: r.status || "new",
          note: r.note || null,
          // ⬇️ всегда есть заголовок услуги: либо из сервиса, либо из денорм. поля
          service: svc
            ? { id: svc.id, title: svc.title || svc.name || r.service_title || "Service" }
            : { id: r.service_id, title: r.service_title || "Service" },
          // ⬇️ всегда есть имя клиента: либо из пользователя, либо из денорм. поля
          client: cli
            ? {
                id: cli.id,
                name: cli.name || cli.title || r.client_name || "Клиент",
                phone: cli.phone || null,
                telegram: cli.telegram || cli.tg || null,
              }
            : { id: r.client_id, name: r.client_name || "Клиент" },
        };
      })
    );

    // можно вернуть {items}, но фронт уже умеет и чистый массив
    res.json({ items });
  } catch (e) {
    console.error("inbox error:", e);
    res.status(500).json({ error: "inbox_load_failed" });
  }
}

// основной путь
router.get("/provider/inbox", authenticateToken, providerInboxHandler);
// алиас под старый фронт
router.get("/provider", authenticateToken, providerInboxHandler);

module.exports = router;
