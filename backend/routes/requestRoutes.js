// backend/routes/requestRoutes.js
const express = require("express");
const router = express.Router();

const db = require("../db");
const authenticateToken = require("../middleware/authenticateToken");

/* =========================
   Helpers
   ========================= */
function safeJSON(x) {
  if (!x) return {};
  if (typeof x === "object") return x;
  try {
    return JSON.parse(x);
  } catch {
    return {};
  }
}
function parseTs(v) {
  if (!v) return null;
  const n = Date.parse(v);
  return Number.isNaN(n) ? null : n;
}

/**
 * Возвращает UNIX(ms) истечения услуги (expiryTs) по правилам:
 * 1) details.expiration / expires_at / expiration_at
 * 2) авиабилеты: returnDate | returnFlightDate | endDate | startDate (one-way)
 * 3) отели: endDate
 * 4) тур/событие: endDate либо startDate (если конца нет)
 * 5) fallback TTL = created_at + 30 дней
 */
function computeServiceExpiryMs(svc) {
  const now = Date.now();

  const category = (svc.category || "").toLowerCase();
  const details = safeJSON(svc.details);
  const createdTs =
    parseTs(svc.created_at) ??
    parseTs(svc.createdAt) ??
    parseTs(svc.created) ??
    now;

  // 1) явная дата истечения
  const explicit =
    parseTs(details.expiration) ??
    parseTs(details.expires_at) ??
    parseTs(details.expiration_at);
  if (explicit) return explicit;

  // 2-4) по категориям
  const candidates = [];
  if (category.includes("flight") || category.includes("avia")) {
    candidates.push(
      details.returnDate,
      details.returnFlightDate,
      details.endDate,
      details.startDate
    );
  } else if (category.includes("hotel")) {
    candidates.push(details.endDate);
  } else if (
    category.includes("tour") ||
    category.includes("event") ||
    category.includes("refused_tour") ||
    category.includes("author_tour")
  ) {
    candidates.push(details.endDate, details.startDate);
  } else {
    candidates.push(details.endDate, details.startDate);
  }

  for (const c of candidates) {
    const t = parseTs(c);
    if (t) return t;
  }

  // 5) TTL 30 дней
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  return createdTs + THIRTY_DAYS;
}

/* =========================
   Очистка просроченных заявок
   ========================= */

/**
 * Удаляет просроченные заявки.
 * Возвращает массив удалённых request.id (строкой).
 */
async function cleanupExpiredRequests() {
  const now = Date.now();

  const { rows } = await db.query(
    `
    SELECT r.id              AS request_id,
           r.service_id,
           r.created_at      AS request_created_at,
           s.category,
           s.details,
           s.created_at
      FROM requests r
      JOIN services s ON s.id = r.service_id
    `
  );

  const toDelete = [];
  for (const row of rows) {
    const expiry = computeServiceExpiryMs(row);
    if (expiry && now > expiry) {
      toDelete.push(String(row.request_id));
    }
  }

  if (toDelete.length === 0) return [];

  await db.query(`DELETE FROM requests WHERE id::text = ANY($1)`, [toDelete]);
  return toDelete;
}

async function purgeExpiredRequests() {
  return cleanupExpiredRequests();
}

/* =========================
   Создание заявки (быстрый запрос)
   ========================= */
/**
 * POST /api/requests
 * Тело (любые поля, минимум serviceId):
 * {
 *   serviceId: string|number,      // ОБЯЗАТЕЛЬНО
 *   name?: string,                 // Имя отправителя
 *   phone?: string,
 *   telegram?: string,             // @ник или ссылка
 *   comment?: string               // Комментарий
 * }
 *
 * Если пользователь авторизован — client_id возьмём из токена.
 * Роут без обязательной авторизации — можно слать и анонимные быстрые запросы.
 */
router.post("/", async (req, res) => {
  try {
    const {
      serviceId,
      name = null,
      phone = null,
      telegram = null,
      comment = null,
    } = req.body || {};

    if (!serviceId) {
      return res.status(400).json({ error: "serviceId is required" });
    }

    // Попытаемся вытащить client_id из токена, если он есть
    let clientId = null;
    try {
      // мягкая проверка — не падаем, если токена нет/он невалидный
      await new Promise((resolve) =>
        authenticateToken(req, res, resolve) // resolve без ответа => просто продолжим
      );
      clientId = req.user?.id || null;
    } catch {
      clientId = null;
    }

    // Проверим, что сервис существует
    const s = await db.query(`SELECT id, provider_id FROM services WHERE id::text = $1`, [
      String(serviceId),
    ]);
    if (!s.rows.length) {
      return res.status(404).json({ error: "Service not found" });
    }

    // Вставка. Предполагаем такие колонки в requests:
    // id (uuid default), service_id, client_id (nullable),
    // name, phone, telegram, comment, processed (bool default false),
    // created_at (default now()).
    const { rows } = await db.query(
      `
      INSERT INTO requests (service_id, client_id, name, phone, telegram, comment)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [String(serviceId), clientId, name, phone, telegram, comment]
    );

    res.status(201).json({ success: true, request: rows[0] });
  } catch (e) {
    console.error("POST /api/requests error:", e);
    // Подстрахуемся: если таблица без некоторых колонок — вернём понятную ошибку
    return res.status(500).json({
      error:
        "Failed to create request. Check that table 'requests' has columns: service_id, client_id (nullable), name, phone, telegram, comment, processed (default false), created_at (default now()).",
    });
  }
});

/* =========================
   Inbox провайдера
   ========================= */
router.get("/provider", authenticateToken, async (req, res) => {
  try {
    const providerId = req.user?.id;
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 20));

    if (!providerId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { rows } = await db.query(
      `
      SELECT r.*
        FROM requests r
        JOIN services s ON s.id = r.service_id
       WHERE s.provider_id::text = $1::text
       ORDER BY r.created_at DESC
       LIMIT $2
      `,
      [String(providerId), limit]
    );

    res.json(rows || []);
  } catch (e) {
    console.error("GET /api/requests/provider error:", e);
    res.status(500).json({ error: "Failed to fetch provider inbox" });
  }
});

/* =========================
   Метки и удаление
   ========================= */
router.post("/:id/process", authenticateToken, async (req, res) => {
  try {
    const id = String(req.params.id);
    await db.query(
      `
      UPDATE requests
         SET processed = TRUE,
             processed_at = NOW()
       WHERE id::text = $1
      `,
      [id]
    );
    res.json({ success: true });
  } catch (e) {
    console.error("POST /api/requests/:id/process error:", e);
    res.status(500).json({ error: "Failed to process request" });
  }
});

router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const id = String(req.params.id);
    await db.query(`DELETE FROM requests WHERE id::text = $1`, [id]);
    res.json({ success: true });
  } catch (e) {
    console.error("DELETE /api/requests/:id error:", e);
    res.status(500).json({ error: "Failed to delete request" });
  }
});

/* =========================
   Очистка (основные пути)
   ========================= */
router.post("/cleanup-expired", authenticateToken, async (_req, res) => {
  try {
    const removed = await cleanupExpiredRequests();
    res.json({ success: true, removed });
  } catch (e) {
    console.error("POST /api/requests/cleanup-expired error:", e);
    res.status(500).json({ error: "Failed to cleanup expired requests" });
  }
});

router.post("/purge-expired", authenticateToken, async (_req, res) => {
  try {
    const removed = await purgeExpiredRequests();
    res.json({ success: true, removed });
  } catch (e) {
    console.error("POST /api/requests/purge-expired error:", e);
    res.status(500).json({ error: "Failed to purge expired requests" });
  }
});

/* =========================
   Алиасы (back-compat)
   ========================= */
router.post("/cleanup", authenticateToken, async (_req, res) => {
  try {
    const removed = await cleanupExpiredRequests();
    res.json({ success: true, removed });
  } catch (e) {
    console.error("POST /api/requests/cleanup error:", e);
    res.status(500).json({ error: "Failed to cleanup (alias)" });
  }
});

router.post("/purgeExpired", authenticateToken, async (_req, res) => {
  try {
    const removed = await purgeExpiredRequests();
    res.json({ success: true, removed });
  } catch (e) {
    console.error("POST /api/requests/purgeExpired error:", e);
    res.status(500).json({ error: "Failed to purge (alias)" });
  }
});

module.exports = {
  router,
  cleanupExpiredRequests,
  purgeExpiredRequests,
};
