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
function pickFirst(...vals) {
  for (const v of vals) {
    if (v === 0) return 0;
    if (v !== undefined && v !== null && String(v).trim?.() !== "") return v;
  }
  return null;
}
function parseTs(v) {
  if (!v) return null;
  const n = Date.parse(v);
  return Number.isNaN(n) ? null : n;
}

/**
 * Возвращает UNIX(ms) истечения услуги (expiryTs) по rules:
 * 1) details.expiration / expires_at / expiration_at
 * 2) авиабилеты: returnDate | returnFlightDate | endDate | startDate (one-way)
 * 3) отели: endDate
 * 4) тур/событие: endDate либо startDate (если конца нет)
 * 5) fallback TTL = created_at + 30 дней
 */
function computeServiceExpiryMs(svc) {
  const now = Date.now();

  const cat = (svc.category || "").toLowerCase();
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

  // 2) по категориям
  const byCatCandidates = [];

  if (cat.includes("flight") || cat.includes("avia") || cat.includes("ticket")) {
    byCatCandidates.push(
      details.returnDate,
      details.returnFlightDate,
      details.endDate,
      details.startDate
    );
  } else if (cat.includes("hotel")) {
    byCatCandidates.push(details.endDate);
  } else if (
    cat.includes("tour") ||
    cat.includes("event") ||
    cat.includes("refused_tour") ||
    cat.includes("author_tour")
  ) {
    byCatCandidates.push(details.endDate, details.startDate);
  } else {
    // универсальные поля
    byCatCandidates.push(details.endDate, details.startDate);
  }

  let catTs = null;
  for (const c of byCatCandidates) {
    const t = parseTs(c);
    if (t) {
      catTs = t;
      break;
    }
  }
  if (catTs) return catTs;

  // 5) TTL 30d
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  return createdTs + THIRTY_DAYS;
}

/**
 * Удаляет просроченные заявки.
 * Возвращает массив удалённых request.id
 */
async function cleanupExpiredRequests() {
  const now = Date.now();

  // тянем заявки вместе с нужными данными услуги
  const { rows } = await db.query(
    `
    SELECT r.id AS request_id,
           r.service_id,
           r.created_at AS request_created_at,
           s.category,
           s.details,
           s.created_at
    FROM requests r
    JOIN services s ON s.id = r.service_id
    `
  );

  const toDelete = [];
  for (const row of rows) {
    const exp = computeServiceExpiryMs(row);
    if (exp && now > exp) {
      toDelete.push(row.request_id);
    }
  }

  if (toDelete.length === 0) return [];

  // Удаляем пачкой
  await db.query(
    `DELETE FROM requests WHERE id = ANY($1::uuid[]) OR id = ANY($1::int[])`,
    [toDelete]
  );

  return toDelete;
}

/** Полная "очистка мусора" (пока = то же, что cleanup) */
async function purgeExpiredRequests() {
  return cleanupExpiredRequests();
}

/* =========================
   Маршруты API заявок
   ========================= */

// Inbox провайдера
router.get("/provider", authenticateToken, async (req, res) => {
  try {
    const providerId = req.user?.id;
    const limit = Number(req.query.limit) || 20;

    if (!providerId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { rows } = await db.query(
      `
      SELECT r.*
      FROM requests r
      JOIN services s ON s.id = r.service_id
      WHERE s.provider_id = $1
      ORDER BY r.created_at DESC
      LIMIT $2
      `,
      [providerId, limit]
    );

    res.json(rows || []);
  } catch (e) {
    console.error("GET /api/requests/provider error:", e);
    res.status(500).json({ error: "Failed to fetch provider inbox" });
  }
});

// Отметить как обработано (бейдж NEW -> пропадает)
router.post("/:id/process", authenticateToken, async (req, res) => {
  try {
    const id = req.params.id;
    await db.query(
      `
      UPDATE requests
         SET processed = TRUE,
             processed_at = NOW()
       WHERE id = $1
      `,
      [id]
    );
    res.json({ success: true });
  } catch (e) {
    console.error("POST /api/requests/:id/process error:", e);
    res.status(500).json({ error: "Failed to process request" });
  }
});

// Удалить заявку вручную
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const id = req.params.id;
    await db.query(`DELETE FROM requests WHERE id = $1`, [id]);
    res.json({ success: true });
  } catch (e) {
    console.error("DELETE /api/requests/:id error:", e);
    res.status(500).json({ error: "Failed to delete request" });
  }
});

/* =========================
   Очистка (современные пути)
   ========================= */
router.post("/cleanup-expired", authenticateToken, async (req, res) => {
  try {
    const removed = await cleanupExpiredRequests();
    res.json({ success: true, removed });
  } catch (e) {
    console.error("POST /api/requests/cleanup-expired error:", e);
    res.status(500).json({ error: "Failed to cleanup expired requests" });
  }
});

router.post("/purge-expired", authenticateToken, async (req, res) => {
  try {
    const removed = await purgeExpiredRequests();
    res.json({ success: true, removed });
  } catch (e) {
    console.error("POST /api/requests/purge-expired error:", e);
    res.status(500).json({ error: "Failed to purge expired requests" });
  }
});

/* =========================
   Back-compat алиасы
   (чтобы фронт с любыми старыми путями не ломался)
   ========================= */
router.post("/cleanup", authenticateToken, async (req, res) => {
  try {
    const removed = await cleanupExpiredRequests();
    res.json({ success: true, removed });
  } catch (e) {
    console.error("POST /api/requests/cleanup error:", e);
    res.status(500).json({ error: "Failed to cleanup (alias)" });
  }
});

router.post("/purgeExpired", authenticateToken, async (req, res) => {
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
