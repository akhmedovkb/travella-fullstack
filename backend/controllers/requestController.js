// backend/controllers/requestController.js
const db = require("../db");

/* ===================== Helpers ===================== */

function safeJSON(x) {
  if (!x) return {};
  if (typeof x === "object") return x;
  try { return JSON.parse(x); } catch { return {}; }
}

function parseTs(v) {
  if (v == null) return null;
  if (typeof v === "number") return v > 1e12 ? v : v * 1000; // sec -> ms
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
    .map(Number)
    .filter(Number.isFinite);
  return Array.from(new Set(ids));
}

/**
 * 1) details.expiration / expires_at / expiration_at
 * 2) flight: returnDate | returnFlightDate | endDate | startDate
 * 3) hotel: endDate
 * 4) tour/event: endDate | startDate
 * 5) TTL 30 days from created
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

  const explicit =
    parseTs(details.expiration) ??
    parseTs(details.expires_at) ??
    parseTs(details.expiration_at);
  if (explicit) return explicit;

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
    candidates.push(details.returnDate, details.returnFlightDate, details.endDate, details.startDate);
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

  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  const base = createdService ?? createdRequest;
  return base + THIRTY_DAYS;
}

/** авто-очистка просроченных заявок для набора provider_id */
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
    if (expiry && now > expiry) toDelete.push(String(row.request_id));
  }
  if (!toDelete.length) return [];
  await db.query(`DELETE FROM requests WHERE id::text = ANY($1)`, [toDelete]);
  return toDelete;
}

/* ===================== Controllers ===================== */

/** POST /api/requests (алиас: /api/requests/quick) */
exports.createQuickRequest = async (req, res) => {
  try {
    const clientId = req.user?.id;
    if (!clientId) return res.status(401).json({ error: "unauthorized" });

    const { service_id, note } = req.body || {};
    if (!service_id) return res.status(400).json({ error: "service_id_required" });

    // убедимся, что сервис существует и привязан к провайдеру
    const svc = await db.query(
      `SELECT id, title, provider_id FROM services WHERE id = $1`,
      [service_id]
    );
    if (!svc.rowCount || !svc.rows[0]?.provider_id) {
      return res.status(404).json({ error: "service_not_found" });
    }

    const ins = await db.query(
      `INSERT INTO requests (service_id, client_id, status, note)
       VALUES ($1, $2, 'new', $3)
       RETURNING id, service_id, client_id, status, note, created_at`,
      [service_id, clientId, note || null]
    );

    res.status(201).json(ins.rows[0]);
  } catch (err) {
    console.error("quick request error:", err);
    res.status(500).json({ error: "request_create_failed" });
  }
};

/** GET /api/requests/provider */
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
        json_build_object('id', s.id, 'title', COALESCE(s.title, '—')) AS service,
        json_build_object('id', c.id, 'name', COALESCE(c.name, '—'), 'phone', c.phone, 'telegram', c.telegram) AS client
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

/** GET /api/requests/provider/stats */
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

    let total = 0, fresh = 0, processed = 0;
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

/** PUT /api/requests/:id/status */
exports.updateRequestStatus = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });
    const providerIds = collectProviderIdsFromUser(req.user);
    const id = String(req.params.id);
    const { status } = req.body || {};

    const allowed = new Set(["new", "processed", "rejected", "active"]);
    const next = typeof status === "string" ? status.trim().toLowerCase() : "";
    if (!allowed.has(next)) return res.status(400).json({ error: "invalid_status" });

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

/** DELETE /api/requests/:id */
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

/** POST /api/requests/cleanup-expired */
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

// ===== Клиент: список моих заявок с авто-очисткой просроченных =====

// безопасный парсер JSON
function safeJson(x) {
  if (!x) return null;
  if (typeof x === "object") return x;
  try { return JSON.parse(x); } catch { return null; }
}
function computeExpiresAt(row) {
  // если когда-то появится поле expires_at в SELECT — используем его мягко
  if (Object.prototype.hasOwnProperty.call(row, "expires_at") && row.expires_at) {
    const ts = Number(row.expires_at) || Date.parse(row.expires_at);
    if (Number.isFinite(ts)) return ts;
  }
  // иначе: TTL из details услуги + created_at заявки
  const details = safeJson(row.service_details);
  const ttl = details?.ttl_hours ?? details?.ttlHours ?? null;
  if (ttl && row.created_at) {
    const createdTs = Date.parse(row.created_at);
    if (!Number.isNaN(createdTs)) {
      return createdTs + Number(ttl) * 3600 * 1000;
    }
  }
  return null;
}

exports.getMyRequests = async (req, res) => {
  try {
    const clientId = req.user?.id;
    if (!clientId || (req.user?.role && req.user.role !== "client")) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // ВАЖНО: никаких r.expires_at в SQL
    const q = await pool.query(
      `
      SELECT
        r.id,
        r.service_id,
        r.client_id,
        r.status,
        r.note,
        r.proposal,
        r.created_at,
        s.title  AS service_title,
        s.details AS service_details
      FROM requests r
      LEFT JOIN services s ON s.id = r.service_id
      WHERE r.client_id = $1
      ORDER BY r.created_at DESC
      `,
      [clientId]
    );

    const rows = q.rows.map(row => ({
      id: row.id,
      service_id: row.service_id,
      client_id: row.client_id,
      status: row.status || "new",
      note: row.note || null,
      proposal: row.proposal || null,
      created_at: row.created_at,
      service: { id: row.service_id, title: row.service_title || "Запрос" },
      // добавляем вычисленное поле — фронт уже умеет его показывать
      expires_at: computeExpiresAt(row)
    }));

    return res.json(rows);
  } catch (e) {
    console.error("getMyRequests error:", e);
    return res.status(500).json({ message: "getMyRequests error" });
  }
};


// ===== Универсальное удаление: клиент — свои, провайдер — свои =====
exports.deleteRequest = async (req, res) => {
  try {
    const id = req.params.id;
    const me = req.user || {};
    if (!id) return res.status(400).json({ error: "bad_id" });

    const q = await pool.query(
      `SELECT id, client_id, provider_id, status FROM requests WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (q.rowCount === 0) return res.status(404).json({ error: "not_found" });
    const row = q.rows[0];

    const isClientOwner = me.role === "client" && String(row.client_id) === String(me.id);
    const isProviderOwner = me.role === "provider" && row.provider_id && String(row.provider_id) === String(me.id);
    const isAdmin = me.role === "admin" || me.isAdmin === true;

    if (!isClientOwner && !isProviderOwner && !isAdmin) {
      return res.status(403).json({ error: "forbidden" });
    }

    await pool.query(`DELETE FROM requests WHERE id = $1`, [id]);
    res.json({ ok: true, deleted: id });
  } catch (e) {
    console.error("deleteRequest error:", e);
    res.status(500).json({ error: "delete_failed" });
  }
};

