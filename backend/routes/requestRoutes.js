// backend/routes/requestRoutes.js
const express = require("express");
const router = express.Router();
const authenticateToken = require("../middleware/authenticateToken");

/** ======================== DB (optional) ======================== */
let db = null;
try {
  // Ожидаем модуль ../db с экспортом { query(sql, params) }
  // Если его нет — просто работаем в памяти
  // eslint-disable-next-line import/no-unresolved, global-require
  db = require("../db");
} catch (_) {
  db = null;
}
const HAS_DB = !!(db && typeof db.query === "function");

/** ================= in-memory fallback (dev) ==================== */
const __mem = global.__travella_mem || {
  services: new Map(),   // id -> { id, title, provider_id, ... }
  users: new Map(),      // id -> { id, name, phone, telegram }
  requests: [],          // { id, type, service_id, provider_id, client_id, note, status, created_at, service_title?, client_name? }
};
global.__travella_mem = __mem;

/** ======================== helpers ============================== */
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
    // В таблице clients по скринам есть name/phone. telegram может и не быть — вернём null.
    const { rows } = await db.query(
      "SELECT id, name, phone FROM clients WHERE id = $1 LIMIT 1",
      [id]
    );
    if (!rows[0]) return null;
    return { ...rows[0], telegram: null };
  }
  return __mem.users.get(String(id)) || null;
}

async function createQuickRequest(doc) {
  if (HAS_DB) {
    const {
      service_id,
      provider_id,
      client_id,
      note,
      status = "new",
      service_title = null,
      client_name = null,
    } = doc;

    const { rows } = await db.query(
      `INSERT INTO requests
         (type, service_id, provider_id, client_id, note, status, created_at, service_title, client_name)
       VALUES
         ('quick', $1, $2, $3, $4, $5, NOW(), $6, $7)
       RETURNING id, created_at`,
      [service_id, provider_id, client_id, note || null, status, service_title, client_name]
    );

    return {
      id: rows[0].id,
      created_at: rows[0].created_at,
      type: "quick",
      service_id,
      provider_id,
      client_id,
      note: note || null,
      status,
      service_title,
      client_name,
    };
  }

  // memory
  const id = String(Date.now()) + Math.random().toString(36).slice(2, 7);
  const rec = { id, ...doc };
  __mem.requests.push(rec);
  return rec;
}

/** ================== создание «быстрого» запроса ================= */
async function handleCreateQuick(req, res) {
  try {
    const clientId = req.user?.id;
    if (!clientId) return res.status(401).json({ error: "unauthorized" });

    const { service_id, provider_id: providerIdFromBody, note, service_title } = req.body || {};
    if (!service_id) return res.status(400).json({ error: "service_id required" });

    // Пытаемся получить услугу и из неё провайдера
    let svc = null;
    try { svc = await getServiceById(service_id); } catch (_) {}

    let provider_id =
      svc?.provider_id ||
      svc?.providerId ||
      svc?.owner_id ||
      svc?.agency_id ||
      svc?.user_id ||
      null;

    // Фолбэк: берём из тела
    if (!provider_id && providerIdFromBody) provider_id = providerIdFromBody;
    if (!provider_id) return res.status(404).json({ error: "service_not_found" });

    // Снэпшоты (чтобы отображалось даже если потом данные изменят)
    const clientFromDb = await getClientById(clientId);
    const client_name = clientFromDb?.name || req.user?.name || null;
    const serviceTitleSnapshot = service_title || svc?.title || svc?.name || null;

    const rec = await createQuickRequest({
      type: "quick",
      service_id,
      provider_id,
      client_id: clientId,
      note: note || null,
      status: "new",
      created_at: new Date().toISOString(),
      service_title: serviceTitleSnapshot,
      client_name,
    });

    return res.json({ ok: true, id: rec.id });
  } catch (e) {
    console.error("quick request error:", e);
    return res.status(500).json({ error: "request_create_failed" });
  }
}

/** ================== провайдерский инбокс ======================= */

// Собираем все возможные ID провайдера (если в токене разные поля)
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

async function findQuickRequestsByProviderMany(providerIds) {
  if (HAS_DB) {
    // provider_id в БД, скорее всего, integer
    const ids = providerIds
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v));

    // Берём title услуги и ФИО клиента, если есть; иначе — снэпшоты из requests
    const { rows } = await db.query(
      `
      SELECT
        r.id,
        r.created_at,
        r.status,
        r.note,
        r.service_id,
        r.client_id,
        COALESCE(s.title, r.service_title, '—') AS service_title,
        COALESCE(c.name,  r.client_name,  '—') AS client_name,
        c.phone AS client_phone
      FROM requests r
      LEFT JOIN services s ON s.id = r.service_id
      LEFT JOIN clients  c ON c.id = r.client_id
      WHERE r.type = 'quick'
        AND r.provider_id = ANY($1)
      ORDER BY r.created_at DESC
      `,
      [ids]
    );
    return rows;
  }

  // memory
  return __mem.requests
    .filter((r) => r.type === "quick" && providerIds.includes(String(r.provider_id)))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function providerInboxHandler(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });

    const myIds = collectProviderIdsFromUser(req.user);
    const rows = await findQuickRequestsByProviderMany(myIds);

    if (HAS_DB) {
      // Уже пришли готовые строки с service_title / client_name
      const items = rows.map((r) => ({
        id: r.id,
        created_at: r.created_at,
        status: r.status || "new",
        note: r.note || null,
        service: {
          id: r.service_id,
          title: r.service_title || "—",
        },
        client: {
          id: r.client_id,
          name: r.client_name || "—",
          phone: r.client_phone || null,
          telegram: null, // колонки может не быть — отдаём null
        },
      }));
      return res.json({ items });
    }

    // memory-ветка
    const items = await Promise.all(
      rows.map(async (r) => {
        const svc = await getServiceById(r.service_id);
        const cli = await getClientById(r.client_id);
        return {
          id: r.id,
          created_at: r.created_at,
          status: r.status || "new",
          note: r.note || null,
          service: {
            id: r.service_id,
            title: svc?.title || svc?.name || r.service_title || "—",
          },
          client: {
            id: cli?.id || r.client_id,
            name: cli?.name || r.client_name || "—",
            phone: cli?.phone || null,
            telegram: cli?.telegram || null,
          },
        };
      })
    );

    return res.json({ items });
  } catch (e) {
    console.error("inbox error:", e);
    return res.status(500).json({ error: "inbox_load_failed" });
  }
}

/** ======================= routes ================================ */

// Создать «быстрый» запрос
router.post("/quick", authenticateToken, handleCreateQuick);
// Алиас для обратной совместимости
router.post("/", authenticateToken, handleCreateQuick);

// Входящие провайдера (новый и старый пути)
router.get("/provider/inbox", authenticateToken, providerInboxHandler);
router.get("/provider", authenticateToken, providerInboxHandler);

module.exports = router;
