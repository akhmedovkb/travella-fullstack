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
  requests: [],        // { id, type, service_id, provider_id, client_id, note, status, created_at, service_title? }
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
async function findQuickRequestsByProvider(provider_id) {
  // TODO: Request.find({ provider_id, type:'quick' }).sort({created_at:-1})
  return __mem.requests
    .filter(r => String(r.provider_id) === String(provider_id) && r.type === "quick")
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
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

    // 1) Пытаемся взять провайдера из записи услуги
    let provider_id =
      svc?.provider_id ||
      svc?.providerId ||
      svc?.owner_id ||
      svc?.agency_id ||
      svc?.user_id ||
      null;

    // 2) Фолбэк: берём из тела запроса (фронт теперь его передаёт)
    if (!provider_id && providerIdFromBody) {
      provider_id = providerIdFromBody;
    }

    if (!provider_id) {
      return res.status(404).json({ error: "service_not_found" });
    }

    const rec = await createQuickRequest({
      type: "quick",
      service_id,
      provider_id,
      client_id: clientId,
      note: note || null, // комментарий клиента
      status: "new",
      created_at: new Date().toISOString(),
      service_title: svc?.title || svc?.name || null, // пригодится в инбоксе, если svc не загрузится
    });

    return res.json({ ok: true, id: rec.id });
  } catch (e) {
    console.error("quick request error:", e);
    return res.status(500).json({ error: "request_create_failed" });
  }
}

/** ===== Маршруты ===== */

// Создать «быстрый запрос» (новый путь)
router.post("/quick", authenticateToken, handleCreateQuick);

// Алиас для обратной совместимости (POST /api/requests)
router.post("/", authenticateToken, handleCreateQuick);

// Входящие запросы провайдера (минимальный набор полей + комментарий)
// ===== helper: какие ID считать "моими" для провайдера =====
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
    .map((v) => String(v));
  return Array.from(new Set(ids));
}

// находим все быстрые запросы для одного из ID
async function findQuickRequestsByProviderMany(providerIds) {
  return __mem.requests
    .filter((r) => r.type === "quick" && providerIds.includes(String(r.provider_id)))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// единый хендлер инбокса
async function providerInboxHandler(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });

    const myIds = collectProviderIdsFromUser(req.user);
    console.log("INBOX ids=", myIds, "requests=", __mem.requests.map(r => ({id:r.id, provider_id:r.provider_id})));
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

    res.json({ items });
  } catch (e) {
    console.error("inbox error:", e);
    res.status(500).json({ error: "inbox_load_failed" });
  }
}

// ✅ основной путь (как раньше в наших примерах)
router.get("/provider/inbox", authenticateToken, providerInboxHandler);

// ✅ алиас под старый фронт (Dashboard бьёт сюда)
router.get("/provider", authenticateToken, providerInboxHandler);


module.exports = router;
