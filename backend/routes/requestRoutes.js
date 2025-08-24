// backend/routes/requestRoutes.js
const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const ctrl = require("../controllers/requestController") || {};

const {
  createQuickRequest,
  getProviderRequests,
  getProviderOutgoingRequests,
  getProviderStats,
  updateRequestStatus,
  updateStatusByProvider,
  deleteRequest,
  deleteByProvider,
  manualCleanupExpired,
  getMyRequests,
  updateMyRequest,
  touchByProvider,
} = ctrl;

const has = (fn) => typeof fn === "function";

/* ---------- Создать быстрый запрос ---------- */
if (!has(createQuickRequest)) {
  throw new Error("requestController.createQuickRequest is not exported");
}
router.post("/", authenticateToken, createQuickRequest);
router.post("/quick", authenticateToken, createQuickRequest);

/* ---------- Входящие/исходящие провайдера ---------- */
if (has(getProviderRequests)) {
  router.get("/provider", authenticateToken, getProviderRequests);
  router.get("/provider/inbox", authenticateToken, getProviderRequests);
}
if (has(getProviderOutgoingRequests)) {
  router.get("/provider/outgoing", authenticateToken, getProviderOutgoingRequests);
} else if (has(getProviderRequests)) {
  // фолбэк — если outbox отдаётся тем же хэндлером
  router.get("/provider/outgoing", authenticateToken, getProviderRequests);
}

/* ---------- Счётчики ---------- */
if (has(getProviderStats)) {
  router.get("/provider/stats", authenticateToken, getProviderStats);
}

/* ---------- Обновить статус ---------- */
if (has(updateRequestStatus)) {
  router.put("/:id/status", authenticateToken, updateRequestStatus);
  // алиас "processed"
  router.put("/:id/processed", authenticateToken, (req, res, next) => {
    req.body = { ...(req.body || {}), status: "processed" };
    return updateRequestStatus(req, res, next);
  });
}
if (has(updateStatusByProvider)) {
  router.patch("/provider/:id", authenticateToken, updateStatusByProvider);
}

/* ---------- Удалить заявку ---------- */
// автор / инициатор (клиент или «зеркальный клиент» провайдера)
if (has(deleteRequest)) {
  router.delete("/:id", authenticateToken, deleteRequest);
}
// владелец услуги — удаление входящих
if (has(deleteByProvider)) {
  router.delete("/provider/:id", authenticateToken, deleteByProvider);
}

/* ---------- Мои заявки клиента ---------- */
if (has(getMyRequests)) {
  router.get("/my", authenticateToken, getMyRequests);
} else {
  // надёжный фолбэк: простая выборка "мои заявки" с провайдером и услугой
  const db = require("../db");
  router.get("/my", authenticateToken, async (req, res) => {
    try {
      const clientId = req.user?.id;
      if (!clientId) return res.status(401).json({ error: "unauthorized" });

      const q = await db.query(
        `
        SELECT
          r.id,
          r.created_at,
          COALESCE(r.status, 'new') AS status,
          r.note,
          r.proposal,
          json_build_object('id', s.id, 'title', COALESCE(s.title, '—')) AS service,
          json_build_object(
            'id', pr.id,
            'name', COALESCE(pr.name, '—'),
            'type', pr.type,
            'phone', pr.phone,
            'telegram', pr.social
          ) AS provider
        FROM requests r
        JOIN services  s  ON s.id = r.service_id
        JOIN providers pr ON pr.id = s.provider_id
        WHERE r.client_id = $1
        ORDER BY r.created_at DESC
        `,
        [clientId]
      );

      res.json({ items: q.rows });
    } catch (e) {
      console.error("my requests fallback error:", e);
      res.status(500).json({ error: "my_load_failed" });
    }
  });
}

/* ---------- Клиент обновляет свою заявку ---------- */
if (has(updateMyRequest)) {
  router.put("/:id", authenticateToken, updateMyRequest);
}

/* ---------- Провайдер «коснулся» заявки ---------- */
if (has(touchByProvider)) {
  router.post("/:id/touch", authenticateToken, touchByProvider);
}

/* ---------- Ручная очистка просроченных ---------- */
if (has(manualCleanupExpired)) {
  router.post("/cleanup-expired", authenticateToken, manualCleanupExpired);
}

module.exports = router;
