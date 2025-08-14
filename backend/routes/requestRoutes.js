// backend/routes/requestRoutes.js
const express = require("express");
const router = express.Router();

const db = require("../db");
const authenticateToken = require("../middleware/authenticateToken");

/* ----------------------- helpers ----------------------- */

function collectProviderIdsFromUser(user) {
  // на всякий: если токен выдаётся иным объектом
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
    .filter((v) => Number.isFinite(v));
  return Array.from(new Set(ids));
}

/* ------------------ create quick request ------------------ */
/**
 * POST /api/requests
 * POST /api/requests/quick
 * body: { service_id:number, note?:string, provider_id?:number, service_title?:string }
 */
async function handleCreateQuick(req, res) {
  try {
    if (!req.user?.id || req.user?.role !== "client") {
      return res.status(401).json({ error: "unauthorized" });
    }

    const { service_id, note, provider_id: fromBody } = req.body || {};
    if (!service_id) {
      return res.status(400).json({ error: "service_id required" });
    }

    // попробуем достать provider_id из services, если он не передан
    let providerId = fromBody ?? null;
    if (!providerId) {
      const s = await db.query(
        "SELECT provider_id FROM services WHERE id = $1 LIMIT 1",
        [service_id]
      );
      providerId = s.rows[0]?.provider_id ?? null;
    }
    if (!providerId) {
      return res.status(404).json({ error: "service_or_provider_not_found" });
    }

    const ins = await db.query(
      `INSERT INTO requests (service_id, client_id, provider_id, status, note, created_at)
       VALUES ($1, $2, $3, 'new', $4, NOW())
       RETURNING id`,
      [service_id, req.user.id, providerId, note || null]
    );

    return res.json({ ok: true, id: ins.rows[0].id });
  } catch (e) {
    console.error("quick request error:", e);
    return res.status(500).json({ error: "request_create_failed" });
  }
}

router.post("/", authenticateToken, handleCreateQuick);
router.post("/quick", authenticateToken, handleCreateQuick);

/* ------------------ client: my requests ------------------ */
/**
 * GET /api/requests/my
 * Список запросов текущего клиента
 */
router.get("/my", authenticateToken, async (req, res) => {
  try {
    if (req.user?.role !== "client") {
      return res.status(403).json({ error: "only_client" });
    }

    const q = await db.query(
      `SELECT
         r.id,
         r.created_at,
         r.status,
         r.note,
         r.proposal,
         s.id  AS service_id,
         COALESCE(s.title, NULL) AS service_title
       FROM requests r
       LEFT JOIN services s ON s.id = r.service_id
       WHERE r.client_id = $1
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );

    const items = q.rows.map((r) => ({
      id: r.id,
      created_at: r.created_at,
      status: r.status || "new",
      note: r.note,
      proposal: r.proposal && typeof r.proposal === "string"
        ? (() => { try { return JSON.parse(r.proposal); } catch { return null; } })()
        : r.proposal || null,
      service: {
        id: r.service_id,
        title: r.service_title || "—",
      },
    }));

    res.json({ items });
  } catch (e) {
    console.error("my requests error:", e);
    res.status(500).json({ error: "my_requests_load_failed" });
  }
});

/* ---------------- provider: inbox ---------------- */
/**
 * GET /api/requests/provider
 * GET /api/requests/provider/inbox
 * Входящие запросы для текущего провайдера
 */
async function providerInboxHandler(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });

    const myIds = collectProviderIdsFromUser(req.user);
    if (myIds.length === 0) {
      return res.json({ items: [] });
    }

    const q = await db.query(
      `SELECT
         r.id,
         r.created_at,
         r.status,
         r.note,
         s.id  AS service_id,
         COALESCE(s.title, NULL) AS service_title,
         c.id  AS client_id,
         COALESCE(c.name,  '—')   AS client_name,
         c.phone  AS client_phone,
         c.telegram AS client_telegram
       FROM requests r
       LEFT JOIN services s ON s.id = r.service_id
       LEFT JOIN clients  c ON c.id = r.client_id
       WHERE r.provider_id = ANY($1::int[])
       ORDER BY r.created_at DESC`,
      [myIds]
    );

    const items = q.rows.map((row) => ({
      id: row.id,
      created_at: row.created_at,
      status: row.status || "new",
      note: row.note || null,
      service: {
        id: row.service_id,
        title: row.service_title || "—",
      },
      client: {
        id: row.client_id,
        name: row.client_name || "—",
        phone: row.client_phone || null,
        telegram: row.client_telegram || null, // ← вот он, Telegram
      },
    }));

    res.json({ items });
  } catch (e) {
    console.error("provider inbox error:", e);
    res.status(500).json({ error: "inbox_load_failed" });
  }
}

router.get("/provider", authenticateToken, providerInboxHandler);
router.get("/provider/inbox", authenticateToken, providerInboxHandler);

/* ---------------- accept / reject ---------------- */
/**
 * POST /api/requests/:id/accept
 * POST /api/requests/:id/reject
 * Простое обновление статуса со стороны клиента
 */
router.post("/:id/accept", authenticateToken, async (req, res) => {
  try {
    if (req.user?.role !== "client") {
      return res.status(403).json({ error: "only_client" });
    }
    const id = Number(req.params.id);
    const upd = await db.query(
      `UPDATE requests
         SET status = 'accepted'
       WHERE id = $1 AND client_id = $2
       RETURNING id`,
      [id, req.user.id]
    );
    if (upd.rowCount === 0) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  } catch (e) {
    console.error("accept error:", e);
    res.status(500).json({ error: "accept_failed" });
  }
});

router.post("/:id/reject", authenticateToken, async (req, res) => {
  try {
    if (req.user?.role !== "client") {
      return res.status(403).json({ error: "only_client" });
    }
    const id = Number(req.params.id);
    const upd = await db.query(
      `UPDATE requests
         SET status = 'rejected'
       WHERE id = $1 AND client_id = $2
       RETURNING id`,
      [id, req.user.id]
    );
    if (upd.rowCount === 0) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  } catch (e) {
    console.error("reject error:", e);
    res.status(500).json({ error: "reject_failed" });
  }
});

module.exports = router;
