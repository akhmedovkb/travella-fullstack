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

    // ⚠️ NEW: принимаем service_title из фронта как снэпшот, чтобы наверняка показывать название
    const { service_id, provider_id: providerIdFromBody, note, service_title } = req.body || {};
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
    if (!provider_id && providerIdFromBody) provider_id = providerIdFromBody;

    if (!provider_id) return res.status(404).json({ error: "service_not_found" });

    // Имя клиента — снэпшот
    const clientFromDb = await getUserById(clientId);
    const client_name =
      clientFromDb?.name ||
      req.user?.name || // если мидлварь кладёт name в токен
      null;

    // Название услуги — снэпшот
    const serviceTitleSnapshot =
      service_title || svc?.title || svc?.name || null;

    const rec = await createQuickRequest({
      type: "quick",
      service_id,
      provider_id,
      client_id: clientId,
      note: note || null,           // комментарий клиента
      status: "new",
      created_at: new Date().toISOString(),
      service_title: serviceTitleSnapshot, // ⚠️ сохраняем
      client_name,                           // ⚠️ сохраняем
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

/** ===== Входящие запросы провайдера ===== */

// Какие ID считать «моими» для провайдера (на случай разных схем)
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

// найти все «quick»-запросы по любому из моих ID
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
          // УСЛУГА: всегда возвращаем title (из базы или снэпшот)
          service: {
            id: r.service_id,
            title: (svc?.title || svc?.name || r.service_title || "—"),
          },
          // КЛИЕНТ: всегда возвращаем name (из базы или снэпшот)
          client: {
            id: cli?.id || r.client_id,
            name: (cli?.name || r.client_name || "—"),
            phone: cli?.phone || null,
            telegram: cli?.telegram || cli?.tg || null,
          },
        };
      })
    );

    res.json({ items });
  } catch (e) {
    console.error("inbox error:", e);
    res.status(500).json({ error: "inbox_load_failed" });
  }
}

// основной путь
router.get("/provider/inbox", authenticateToken, providerInboxHandler);

// алиас под текущий фронт (Dashboard бьёт сюда)
router.get("/provider", authenticateToken, providerInboxHandler);

module.exports = router;
