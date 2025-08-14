// backend/routes/requestRoutes.js
const express = require("express");
const router = express.Router();

const db = require("../db");
const authenticateToken = require("../middleware/authenticateToken");

/* ===================== Helpers ===================== */

function collectProviderIdsFromUser(user) {
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

/* ===================== Create Quick Request ===================== */
/**
 * POST /api/requests/quick
 * POST /api/requests                  (алиас)
 * body: { service_id: number, note?: string }
 */
async function handleCreateQuick(req, res) {
  try {
    const clientId = req.user?.id;
    if (!clientId) return res.status(401).json({ error: "unauthorized" });

    const { service_id, note } = req.body || {};
    if (!service_id) return res.status(400).json({ error: "service_id required" });

    const svc = await getServiceById(service_id);
    if (!svc || !svc.provider_id) {
      return res.status(404).json({ error: "service_not_found" });
    }

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

/* ===================== Provider Stats (счётчики) ===================== */
/**
 * GET /api/requests/provider/stats
 * Возвращает: { total, new, processed }
 */
async function providerStatsHandler(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });

    const ids = collectProviderIdsFromUser(req.user);
    if (!ids.length) return res.json({ total: 0, new: 0, processed: 0 });

    const q = await db.query(
      `SELECT COALESCE(r.status, 'new') AS status, COUNT(*)::int AS cnt
         FROM requests r
         JOIN services s ON s.id = r.service_id
        WHERE s.provider_id = ANY($1::int[])
        GROUP BY COALESCE(r.status, 'new')`,
      [ids]
    );

    let total = 0;
    let fresh = 0;
    let processed = 0;
    q.rows.forEach((row) => {
      total += row.cnt;
      if (row.status === "new") fresh += row.cnt;
      if (row.status === "processed") processed += row.cnt;
    });

    res.json({ total, new: fresh, processed });
  } catch (e) {
    console.error("provider stats error:", e);
    res.status(500).json({ error: "stats_failed" });
  }
}

/* ===================== Client's own requests ===================== */
/**
 * GET /api/requests/my
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
        r.proposal,
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
router.post("/", authenticateToken, handleCreateQuick); // алиас

// инбокс провайдера
router.get("/provider", authenticateToken, providerInboxHandler);
router.get("/provider/inbox", authenticateToken, providerInboxHandler); // алиас

// счётчики провайдера
router.get("/provider/stats", authenticateToken, providerStatsHandler);

// запросы текущего клиента
router.get("/my", authenticateToken, listMyRequests);

module.exports = router;
