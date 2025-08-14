// backend/controllers/requestController.js
const db = require("../db");

/* ===================== Helpers ===================== */

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
  if (v == null) return null;
  if (typeof v === "number") return v > 1e12 ? v : v * 1000; // сек → мс
  const n = Date.parse(String(v));
  return Number.isNaN(n) ? null : n;
}

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

/**
 * Определяет момент истечения услуги (ms) по правилам:
 * 1) details.expiration / expires_at / expiration_at
 * 2) авиабилеты: returnDate | returnFlightDate | endDate | startDate (one-way)
 * 3) отель: endDate
 * 4) тур/событие: endDate либо startDate (если конца нет)
 * 5) fallback TTL = 30 дней (service.created_at, если нет — request.created_at)
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

  // 1) явная дата истечения
  const explicit =
    parseTs(details.expiration) ??
    parseTs(details.expires_at) ??
    parseTs(details.expiration_at);
  if (explicit) return explicit;

  // 2–4) по категориям
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
 * Удаляет просроченные заявки для набора provider_id (через services.provider_id).
 * Возвращает массив удалённых id (строкой).
 */
async function cleanupExpiredForProviders(providerIds) {
  if (!providerIds?.length) return [];

  const { rows } = await db.query(
    `
    SELECT
      r.id AS request_id,
      r.created_at AS request_created_at,
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
  console.log("[auto-cleanup] removing expired requests:", toDelete);

  // Безопасно: поддержка uuid/int (сравнение как текст)
  await db.query(`DELETE FROM requests WHERE id::text = ANY($1)`, [toDelete]);
  return toDelete;
}

/* ===================== Controllers ===================== */

/**
 * GET /api/requests/provider
 * Загружает входящие заявки для провайдера. Перед этим делает авто-очистку.
 */
exports.getProviderRequests = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });
    const providerIds = collectProviderIdsFromUser(req.user);

    await cleanupExpiredForProviders(providerIds).catch((e) =>
      console.error("cleanupExpiredForProviders error:", e)
    );

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
  } catch (err) {
    console.error("provider inbox error:", err);
    res.status(500).json({ error: "inbox_load_failed" });
  }
};

/**
 * GET /api/requests/provider/stats
 * Возвращает { total, new, processed }. Перед подсчётом — авто-очистка.
 */
exports.getProviderStats = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });
    const providerIds = collectProviderIdsFromUser(req.user);

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
  } catch (err) {
    console.error("provider stats error:", err);
    res.status(500).json({ error: "stats_failed" });
  }
};

/**
 * PUT /api/requests/:id/status
 * Обновляет статус заявки (например, processed).
 * Доступно только для владельца услуги (через services.provider_id).
 */
exports.updateRequestStatus = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });
    const providerIds = collectProviderIdsFromUser(req.user);
    const id = String(req.params.id);
    const { status } = req.body || {};

    const allowed = new Set(["new", "processed", "rejected", "active"]);
    const next = typeof status === "string" ? status.trim().toLowerCase() : "";
    if (!allowed.has(next)) return res.status(400).json({ error: "invalid_status" });

    // Проверка владения заявкой
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
      `UPDATE requests
         SET status = $1,
             processed_at = CASE WHEN $1='processed' THEN NOW() ELSE processed_at END
       WHERE id::text = $2`,
      [next, id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("update status error:", err);
    res.status(500).json({ error: "status_failed" });
  }
};

/**
 * DELETE /api/requests/:id
 * Ручное удаление заявки. Доступно только владельцу услуги.
 */
exports.deleteRequest = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });
    const providerIds = collectProviderIdsFromUser(req.user);
    const id = String(req.params.id);

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
  } catch (err) {
    console.error("delete request error:", err);
    res.status(500).json({ error: "delete_failed" });
  }
};

/**
 * POST /api/requests/cleanup-expired
 * Ручной запуск авто-очистки (по желанию).
 */
exports.manualCleanupExpired = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });
    const providerIds = collectProviderIdsFromUser(req.user);
    const removed = await cleanupExpiredForProviders(providerIds);
    res.json({ success: true, removed });
  } catch (err) {
    console.error("cleanup-expired error:", err);
    res.status(500).json({ error: "cleanup_failed" });
  }
};
