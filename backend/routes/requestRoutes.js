// backend/routes/requestRoutes.js
const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");

// Тянем контроллеры из ПРАВИЛЬНОГО пути
const ctrl = require("../controllers/requestController");

// Достаём нужные хэндлеры (что есть — тем и пользуемся)
const {
  createQuickRequest,
  getProviderRequests,
  getProviderStats,
  updateRequestStatus,
  deleteRequest,
  manualCleanupExpired,
  getMyRequests, 
  updateMyRequest,
  touchByProvider,
  // 👇 ДОБАВЛЕНО: исходящие заявки провайдера
  getProviderOutgoingRequests,
} = ctrl || {};

// ---------- Создать «быстрый запрос» (маркетплейс) ----------
if (typeof createQuickRequest !== "function") {
  throw new Error("requestController.createQuickRequest is not exported");
}
router.post("/", authenticateToken, createQuickRequest);
router.post("/quick", authenticateToken, createQuickRequest);

// ---------- Входящие провайдера + счётчики ----------
if (typeof getProviderRequests === "function") {
  router.get("/provider", authenticateToken, getProviderRequests);
  router.get("/provider/inbox", authenticateToken, getProviderRequests);
}
if (typeof getProviderStats === "function") {
  router.get("/provider/stats", authenticateToken, getProviderStats);
}

// ---------- Исходящие провайдера (НОВОЕ) ----------
if (typeof getProviderOutgoingRequests === "function") {
  router.get("/provider/outgoing", authenticateToken, getProviderOutgoingRequests);
  router.get("/provider/outbox", authenticateToken, getProviderOutgoingRequests); // алиас опционально
}

// ---------- Обновить статус /processed алиас ----------
if (typeof updateRequestStatus === "function") {
  router.put("/:id/status", authenticateToken, updateRequestStatus);

  // фикс опечатки в спреде
  router.put("/:id/processed", authenticateToken, (req, res, next) => {
    req.body = { ...(req.body || {}), status: "processed" };
    return updateRequestStatus(req, res, next);
  });
}

// ---------- Удалить и ручная очистка ----------
if (typeof deleteRequest === "function") {
  router.delete("/:id", authenticateToken, deleteRequest);
}
if (typeof manualCleanupExpired === "function") {
  router.post("/cleanup-expired", authenticateToken, manualCleanupExpired);
}

// ---------- Мои запросы клиента (для ClientDashboard) ----------
if (typeof getMyRequests === "function") {
  // если контроллер уже экспортирует — просто прокидываем
  router.get("/my", authenticateToken, getMyRequests);
} else {
  // компактный фолбэк на месте, без изменения контроллера
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
      console.error("my requests error:", e);
      res.status(500).json({ error: "my_load_failed" });
    }
  });
}

// Клиент обновляет заметку своей заявки
if (typeof updateMyRequest === "function") {
  router.put("/:id", authenticateToken, updateMyRequest);
}

// Провайдер «коснулся» заявки — если была new, станет processed
if (typeof touchByProvider === "function") {
  router.post("/:id/touch", authenticateToken, touchByProvider);
}

module.exports = router;
