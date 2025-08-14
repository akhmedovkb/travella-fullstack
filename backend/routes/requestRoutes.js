// backend/routes/requestRoutes.js
const express = require("express");
const router = express.Router();

const db = require("../db");
const authenticateToken = require("../middleware/authenticateToken");

/* ===================== Helpers ===================== */

function collectProviderIdsFromUser(user) {
  // Соберём все возможные идентификаторы (на случай разных схем)
  const ids = [
    user?.id,
    user?.provider_id,
    user?.profile_id,
    user?.company_id,
    user?.agency_id,
    user?.owner_id,
  ]
    .filter((v) => v !== undefined && v !== null)
    .map((v) => Number(v))
    .filter(Number.isFinite);

  // уникальные
  return Array.from(new Set(ids));
}

async function getServiceById(serviceId) {
  const q = await db.query(
    `SELECT id, title, provider_id
       FROM services
      WHERE id = $1
      LIMIT 1`,
    [serviceId]
  );
  return q.rows[0] || null;
}

async function getClientById(clientId) {
  const q = await db.query(
    `SELECT id, name, phone, telegram
       FROM clients
      WHERE id = $1
      LIMIT 1`,
    [clientId]
  );
  return q.rows[0] || null;
}

/* ===================== Create Quick Request ===================== */
/**
 * POST /api/requests/quick
 * POST /api/requests                  (алиас)
 * body: { service_id: number, note?: string, provider_id?: number, service_title?: string }
 */
async function handleCreateQuick(req, res) {
  try {
    const clientId = req.user?.id;
    if (!clientId) return res.status(401).json({ error: "unauthorized" });

    const { service_id, note } = req.body || {};
    if (!service_id) return res.status(400).json({ error: "service_id required" });

    // найдём услугу и валидируем наличие провайдера
    const svc = await getServiceById(service_id);
    if (!svc || !svc.provider_id) {
      return res.status(404).json({ error: "service_not_found" });
    }

    // создаём запись запроса
    const ins = await db.query(
      `INSERT INTO requests (service_id, client_id, status, note, created_at)
       VALUES ($1, $2, 'new', $3, NOW())
       RETURNING id`,
      [service_id, clientId, note || null]
    );

    return res.json({ ok: true, id: ins.rows[0].id });
  } catch (e) {
    console.error("quick request error:", e);
    return res.status(500).json({ error: "request_create_failed" });
  }
}

/* ===================== Provider Inbox ===================== */
/**
 * GET /api/requests/provider
 * GET /api/requests/provider/inbox  (алиас)
 * Возвращает входящие «быстрые» запросы для провайдера.
 * Фильтрация — по services.provider_id (а НЕ requests.provider_id).
 */
async function providerInboxHandler(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });

    const ids = collectProviderIdsFromUser(req.user);
    if (!ids.length) return res.json({ items: [] });

    const q = await db.query(
      `
      SELECT
        r.id,
        r.created_at,
        COALESCE(r.status, 'new') AS status,
        r.note,
        json_build_object(
          'id', s.id,
          'title', COALESCE(s.title, '—')
        ) AS service,
        json_build_object(
          'id', c.id,
          'name', COALESCE(c.name, '—'),
          'phone', c.phone,
          'telegram', c.telegram
        ) AS client
      FROM requests r
      JOIN services s ON s.id = r.service_id
      JOIN clients  c ON c.id = r.client_id
      WHERE s.provider_id = ANY ($1::int[])
      ORDER BY r.created_at DESC
      `,
      [ids]
    );

    return res.json({ items: q.rows });
  } catch (e) {
    console.error("provider inbox error:", e);
    return res.status(500).json({ error: "inbox_load_failed" });
  }
}

/* ===================== Client's own requests ===================== */
/**
 * GET /api/requests/my
 * Список запросов клиента для вкладки «Мои запросы»
 */
async function listMyRequests(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });

    const q = await db.query(
      `
      SELECT
        r.id,
        r.created_at,
        COALESCE(r.status, 'new') AS status,
        r.note,
        r.proposal,                -- если храните предложение в JSON
        json_build_object(
          'id', s.id,
          'title', COALESCE(s.title, '—')
        ) AS service
      FROM requests r
      JOIN services s ON s.id = r.service_id
      WHERE r.client_id = $1
      ORDER BY r.created_at DESC
      `,
      [req.user.id]
    );

    res.json({ items: q.rows });
  } catch (e) {
    console.error("my requests error:", e);
    return res.status(500).json({ error: "my_load_failed" });
  }
}

/* ===================== Routes ===================== */

// создать «быстрый запрос»
router.post("/quick", authenticateToken, handleCreateQuick);
// алиас под старый фронт
router.post("/", authenticateToken, handleCreateQuick);

// инбокс провайдера
router.get("/provider", authenticateToken, providerInboxHandler);
router.get("/provider/inbox", authenticateToken, providerInboxHandler);

// запросы текущего клиента
router.get("/my", authenticateToken, listMyRequests);

module.exports = router;
