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
  if (typeof v === "number") return v > 1e12 ? v : v * 1000;
  const n = Date.parse(String(v));
  return Number.isNaN(n) ? null : n;
}

/**
 * Правила истечения услуги:
 * 1) details.expiration / expires_at / expiration_at
 * 2) авиабилеты: returnDate | returnFlightDate | endDate | startDate (one-way)
 * 3) отель: endDate
 * 4) тур/событие: endDate либо startDate (если конца нет)
 * 5) fallback TTL = created_at + 30 дней (service.created_at, если нет — request.created_at)
 */
function computeServiceExpiryMs(serviceRow, requestCreatedAt) {
  const cat = String(serviceRow.category || "").toLowerCase();
  const details = safeJSON(serviceRow.details);
  const createdService =
    parseTs(serviceRow.created_at) ??
    parseTs(serviceRow.createdAt) ??
    parseTs(serviceRow.created) ??
    null;
  const createdRequest = parseTs(requestCreatedAt) ?? Date.now();

  // 1) явные поля expiration*
  const explicit =
    parseTs(details.expiration) ??
    parseTs(details.expires_at) ??
    parseTs(details.expiration_at);
  if (explicit) return explicit;

  // 2-4) по категориям
  const candidates = [];
  const isFlight = cat.includes("flight") || cat.includes("avia");
  const isHotel = cat.includes("hotel");
  const isTourOrEvent =
    cat.includes("tour") ||
    cat.includes("event") ||
    cat.includes("refused_tour") ||
    cat.includes("author_tour") ||
    cat.includes("refused_event_ticket");

  if (isFlight) {
    candidates.push(
      details.returnDate,
      details.returnFlightDate,
      details.endDate,
      details.startDate
    );
  } else if (isHotel) {
    candidates.push(details.endDate);
  } else if (isTourOrEvent) {
    candidates.push(details.endDate, details.startDate);
  } else {
    // универсальные поля
    candidates.push(details.endDate, details.startDate);
  }

  for (const c of candidates) {
    const t = parseTs(c);
    if (t) return t;
  }

  // 5) TTL 30 дней
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const base = createdService ?? createdRequest;
  return base + THIRTY_DAYS;
}

/**
 * Авто-очистка истёкших заявок для услуг заданных провайдеров.
 * Возвращает массив удалённых request.id
 */
async function cleanupExpiredForProviders(providerIds) {
  if (!providerIds?.length) return [];

  const { rows } = await db.query(
    `
    SELECT
      r.id AS request_id,
      r.created_at AS request_created_at,
      s.id AS service_id,
      s.category,
      s.details,
      s.created_at
    FROM requests r
    JOIN services s ON s.id = r.service_id
    WHERE s.provider_id = ANY($1::int[])
    `,
    [providerIds]
  );

  const now = Date.now();
  const toDelete = [];
  for (const row of rows) {
    const expiry = computeServiceExpiryMs(row, row.request_created_at);
    if (expiry && now > expiry) {
      toDelete.push(String(row.request_id));
    }
  }
  if (!toDelete.length) return [];

  // Удаляем пачкой безопасно по текстовому сравнению id
  await db.query(`DELETE FROM requests WHERE id::text = ANY($1)`, [toDelete]);
  return toDelete;
}

/* ===================== Creation (Quick Request) ===================== */
/**
 * POST /api/requests/quick
 * POST /api/requests        (алиас)
 * body: { service_id: number, note?: string }
 * Требуется авторизованный клиент (Bearer).
 */
async function handleCreateQuick(req, res) {
  try {
    const clientId = req.user?.id;
    const role = req.user?.role;
    if (!clientId || role !== "client") {
      return res.status(403).json({ error: "Only client can create requests" });
    }

    const { service_id, note } = req.body || {};
    if (!service_id) return res.status(400).json({ error: "service_id required" });

    const svc = await db.query(
      `SELECT id, title, provider_id FROM services WHERE id = $1`,
      [service_id]
    );
    if (!svc.rowCount || !svc.rows[0].provider_id) {
      return res.status(404).json({ error: "service_not_found" });
    }

    const ins = await db.query(
      `INSERT INTO requests (service_id, client_id, status, note)
       VALUES ($1, $2, 'new', $3)
       RETURNING id, service_id, client_id, status, note, created_at`,
      [service_id, clientId, note || null]
    );

    res.status(201).json(ins.rows[0]);
  } catch (e) {
    console.error("quick request error:", e);
    res.status(500).json({ error: "request_create_failed" });
  }
}

/* ===================== Provider Inbox (with auto-cleanup) ===================== */
/**
 * GET /api/requests/provider
 * GET /api/requests/provider/inbox  (алиас)
 * При каждом вызове сначала выполняется авто-очистка.
 */
async function providerInboxHandler(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });

    const providerIds = collectProviderIdsFromUser(req.user);

    // 1) авто-очистка
    await cleanupExpiredForProviders(providerIds).catch((e) =>
      console.error("cleanupExpiredForProviders error:", e)
    );

    // 2) инбокс
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
      [providerIds]
    );

    res.json({ items: q.rows });
  } catch (e) {
    console.error("provider inbox error:", e);
    res.status(500).json({ error: "inbox_load_failed" });
  }
}

/* ===================== Provider Stats (counters) ===================== */
/**
 * GET /api/requests/provider/stats
 * Возвращает: { total, new, processed }
 */
async function providerStatsHandler(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });

    const providerIds = collectProviderIdsFromUser(req.user);

    // авто-очистка перед подсчётом, чтобы цифры были актуальны
    await cleanupExpiredForProviders(providerIds).catch((e) =>
      console.error("cleanup before stats error:", e)
    );

    const q = await db.query(
      `SELECT COALESCE(r.status, 'new') AS status, COUNT(*)::int AS cnt
         FROM requests r
         JOIN services s ON s.id = r.service_id
        WHERE s.provider_id = ANY($1::int[])
        GROUP BY COALESCE(r.status, 'new')`,
      [providerIds]
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

/* ===================== Mark as processed ===================== */
/**
 * PUT /api/requests/:id/processed
 * Помечает запрос как обработанный. Доступно провайдеру-владельцу услуги.
 */
async function markProcessedHandler(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });
    const providerIds = collectProviderIdsFromUser(req.user);
    const id = String(req.params.id);

    // Проверим, что заявка относится к услугам текущего провайдера
    const own = await db.query(
      `
      SELECT 1
      FROM requests r
      JOIN services s ON s.id = r.service_id
      WHERE r.id::text = $1 AND s.provider_id = ANY($2::int[])
      LIMIT 1
      `,
      [id, providerIds]
    );
    if (!own.rowCount) return res.status(404).json({ error: "not_found_or_forbidden" });

    await db.query(
      `UPDATE requests SET status='processed', processed_at = NOW() WHERE id::text = $1`,
      [id]
    );

    res.json({ success: true });
  } catch (e) {
    console.error("mark processed error:", e);
    res.status(500).json({ error: "mark_failed" });
  }
}

/* ===================== Manual delete ===================== */
/**
 * DELETE /api/requests/:id
 * Удаляет запрос вручную. Доступно провайдеру-владельцу услуги.
 */
async function deleteRequestHandler(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });
    const providerIds = collectProviderIdsFromUser(req.user);
    const id = String(req.params.id);

    // Проверим, что заявка относится к услугам текущего провайдера
    const own = await db.query(
      `
      SELECT 1
      FROM requests r
      JOIN services s ON s.id = r.service_id
      WHERE r.id::text = $1 AND s.provider_id = ANY($2::int[])
      LIMIT 1
      `,
      [id, providerIds]
    );
    if (!own.rowCount) return res.status(404).json({ error: "not_found_or_forbidden" });

    await db.query(`DELETE FROM requests WHERE id::text = $1`, [id]);
    res.json({ success: true });
  } catch (e) {
    console.error("delete request error:", e);
    res.status(500).json({ error: "delete_failed" });
  }
}

/* ===================== Optional: explicit cleanup endpoints ===================== */
/**
 * POST /api/requests/cleanup-expired
 * Явный ручной запуск авто-очистки (можно дергать по «Обновить»).
 */
async function cleanupExpiredHandler(req, res) {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });
    const providerIds = collectProviderIdsFromUser(req.user);
    const removed = await cleanupExpiredForProviders(providerIds);
    res.json({ success: true, removed });
  } catch (e) {
    console.error("cleanup-expired error:", e);
    res.status(500).json({ error: "cleanup_failed" });
  }
}

/* ===================== Client's own requests (optional) ===================== */
/**
 * GET /api/requests/my
 * Список запросов клиента
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
    res.status(500).json({ error: "my_load_failed" });
  }
}

/* ===================== Routes ===================== */

// создание «быстрого запроса»
router.post("/quick", authenticateToken, handleCreateQuick);
router.post("/", authenticateToken, handleCreateQuick); // алиас

// инбокс провайдера (+ авто-очистка)
router.get("/provider", authenticateToken, providerInboxHandler);
router.get("/provider/inbox", authenticateToken, providerInboxHandler); // алиас

// счётчики провайдера (+ авто-очистка перед подсчётом)
router.get("/provider/stats", authenticateToken, providerStatsHandler);

// отметить как обработано
router.put("/:id/processed", authenticateToken, markProcessedHandler);

// удаление вручную
router.delete("/:id", authenticateToken, deleteRequestHandler);

// явный ручной запуск очистки
router.post("/cleanup-expired", authenticateToken, cleanupExpiredHandler);

// запросы текущего клиента
router.get("/my", authenticateToken, listMyRequests);

module.exports = router;
