// backend/controllers/requestController.js
const db = require("../db");

/* ===================== Helpers ===================== */



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
  const cat = String(serviceRow.category || "").toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  // 1) details.expiration / expires_at / expiration_at
  const details = serviceRow.details || {};
  const expiration =
    parseTs(details.expiration) ??
    parseTs(details.expires_at) ??
    parseTs(details.expiration_at);
  if (expiration) return expiration;

  // 2) flight dates
  if (cat.includes("flight") || cat.includes("авиа") || cat.includes("перелет") || cat.includes("перелёт")) {
    const r1 =
      parseTs(details.returnDate) ??
      parseTs(details.returnFlightDate) ??
      parseTs(details.endDate) ??
      parseTs(details.startDate);
    if (r1) return r1;
  }

  // 3) hotel
  if (cat.includes("hotel") || cat.includes("отель") || cat.includes("гостиница")) {
    const r2 = parseTs(details.endDate) ?? parseTs(details.checkout) ?? parseTs(details.checkOut);
    if (r2) return r2;
  }

  // 4) tour/event
  if (cat.includes("tour") || cat.includes("тур") || cat.includes("event") || cat.includes("мероприят")) {
    const r3 = parseTs(details.endDate) ?? parseTs(details.startDate);
    if (r3) return r3;
  }

  // 5) TTL 30 days from created
  const created = parseTs(serviceRow.created_at) ?? parseTs(requestCreatedAt);
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
  if (created) return created + THIRTY_DAYS;
  return null;
}

/** авто-очистка просроченных заявок для набора provider_id */
async function cleanupExpiredForProviders(providerIds) {
  if (!Array.isArray(providerIds) || !providerIds.length) return [];
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

// --- helper: если заявка принадлежит провайдеру и она new — помечаем processed
async function markProcessedIfNew(id, providerIds) {
  const q = await db.query(
    `
    UPDATE requests r
       SET status = 'processed'
     WHERE r.id::text = $1
       AND COALESCE(r.status, 'new') = 'new'
       AND EXISTS (SELECT 1 FROM services s WHERE s.id = r.service_id AND s.provider_id = ANY($2::int[]))
    RETURNING id
    `,
    [id, providerIds]
  );
  return q.rowCount;
}

// --- helper: пометить как "прочитано/обработано" (id может быть строкой)
exports.touchByProvider = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });
    const providerIds = collectProviderIdsFromUser(req.user);

    const id = String(req.params?.id || req.body?.id || "").trim();
    if (!id) return res.status(400).json({ error: "id_required" });

    const changed = await markProcessedIfNew(id, providerIds);

    // дополнительно проверим владение, чтобы не выдавать лишнего
    if (!changed) {
      const own = await db.query(
        `SELECT 1
           FROM requests r
           JOIN services s ON s.id = r.service_id
          WHERE r.id::text = $1 AND s.provider_id = ANY($2::int[])
          LIMIT 1`,
        [id, providerIds]
      );
      if (!own.rowCount) return res.status(404).json({ error: "not_found_or_forbidden" });
    }

    res.json({ success: true, processed: changed });
  } catch (e) {
    console.error("touchByProvider error:", e);
    res.status(500).json({ error: "touch_failed" });
  }
};


// обеспечить корректный client_id для текущего пользователя:
// - если это клиент: вернуть его id
// - если это провайдер: найти/создать «теневого клиента» по данным провайдера
async function ensureClientIdForUser(userId) {
  // уже клиент?
  const q1 = await db.query(`SELECT id FROM clients WHERE id = $1`, [userId]);
  if (q1.rowCount > 0) return q1.rows[0].id;

  // провайдер?
  const p = await db.query(
    `SELECT id, name, phone, email, social FROM providers WHERE id = $1`,
    [userId]
  );
  if (p.rowCount === 0) return null; // неизвестный пользователь
  const prov = p.rows[0];

  // попробовать сопоставить уже существующего клиента по email/phone
  const q2 = await db.query(
    `SELECT id FROM clients
       WHERE (email IS NOT DISTINCT FROM $1 AND $1 IS NOT NULL)
          OR (phone IS NOT DISTINCT FROM $2 AND $2 IS NOT NULL)
     LIMIT 1`,
    [prov.email || null, prov.phone || null]
  );
  if (q2.rowCount > 0) return q2.rows[0].id;

  // создать «теневого клиента»
  const ins = await db.query(
    `INSERT INTO clients (name, email, phone, telegram)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [prov.name || "Provider", prov.email || null, prov.phone || null, prov.social || null]
  );
  return ins.rows[0].id;
}


/* ===================== Controllers ===================== */

/** POST /api/requests (алиас: /api/requests/quick) */
exports.createQuickRequest = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthorized" });

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

    // запрет самозаявок: провайдер не может отправить запрос на свой же сервис
    if (Number(svc.rows[0].provider_id) === Number(userId)) {
      return res.status(400).json({ error: "self_request_forbidden" });
    }

    // получить корректный client_id (если провайдер — создадим "теневого клиента")
    const clientId = await ensureClientIdForUser(userId);
    if (!clientId) return res.status(403).json({ error: "forbidden" });

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
                json_build_object(
          'id', COALESCE(c.id, p.id),
          'name', COALESCE(c.name, p.name, '—'),
          'phone', COALESCE(c.phone, p.phone),
          'telegram', COALESCE(c.telegram, p.social),
          'type', COALESCE(p2.type, 'client'),
          'provider_id', p2.id
        ) AS client
      FROM requests r
      JOIN services s ON s.id = r.service_id
      LEFT JOIN clients   c ON c.id = r.client_id
      LEFT JOIN providers p ON p.id = r.client_id
      LEFT JOIN providers p2 ON (p2.email IS NOT DISTINCT FROM c.email
                             OR  p2.phone IS NOT DISTINCT FROM c.phone) -- если «клиент» на самом деле провайдер
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

/** DELETE /api/requests/:id (удаление своей заявки клиентом) */
exports.deleteRequest = async (req, res) => {
  try {
    const clientId = req.user?.id;
    if (!clientId) return res.status(401).json({ error: "unauthorized" });
    const id = String(req.params?.id || "").trim();
    if (!id) return res.status(400).json({ error: "id_required" });

    const q = await db.query(
      `DELETE FROM requests WHERE id::text = $1 AND client_id = $2`,
      [id, Number(clientId)]
    );
    if (!q.rowCount) return res.status(404).json({ error: "not_found_or_forbidden" });
    return res.json({ success: true, deleted: id });
  } catch (e) {
    console.error("deleteRequest (client) error:", e);
    return res.status(500).json({ error: "delete_failed" });
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

    const obj = Object.create(null);
    for (const row of q.rows) obj[row.status] = row.cnt;
    res.json({
      new: obj.new || 0,
      processed: obj.processed || 0,
      accepted: obj.accepted || 0,
      rejected: obj.rejected || 0,
    });
  } catch (err) {
    console.error("provider stats error:", err);
    res.status(500).json({ error: "stats_load_failed" });
  }
};

/** GET /api/requests/provider/:id (детали заявки; помечает как processed) */
exports.getProviderRequestById = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });
    const providerIds = collectProviderIdsFromUser(req.user);

    const id = String(req.params?.id || "").trim();
    if (!id) return res.status(400).json({ error: "id_required" });

    const changed = await markProcessedIfNew(id, providerIds).catch((e) => {
      console.error("markProcessedIfNew err:", e);
      return 0;
    });

    const q = await db.query(
      `
      SELECT
        r.id,
        r.created_at,
        COALESCE(r.status, 'new') AS status,
        r.note,
        json_build_object('id', s.id, 'title', COALESCE(s.title, '—')) AS service,
                json_build_object(
          'id', c.id,
          'name', COALESCE(c.name, '—'),
          'phone', c.phone,
          'telegram', c.telegram,
          'type', COALESCE(p2.type, 'client'),
          'provider_id', p2.id
        ) AS client
      FROM requests r
      JOIN services s ON s.id = r.service_id
      JOIN clients  c ON c.id = r.client_id
      LEFT JOIN providers p2 ON (p2.email IS NOT DISTINCT FROM c.email
                             OR  p2.phone IS NOT DISTINCT FROM c.phone)
     WHERE r.id::text = $1 AND s.provider_id = ANY ($2::int[])
      `,
      [id, providerIds]
    );

    if (!q.rowCount) return res.status(404).json({ error: "not_found_or_forbidden" });

    res.json({ ...q.rows[0], processed: changed > 0 });
  } catch (err) {
    console.error("provider request by id error:", err);
    res.status(500).json({ error: "request_load_failed" });
  }
};

/** PATCH /api/requests/provider/:id (обновить статус: processed/accepted/rejected) */
exports.updateStatusByProvider = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });
    const providerIds = collectProviderIdsFromUser(req.user);

    const id = String(req.params?.id || "").trim();
    if (!id) return res.status(400).json({ error: "id_required" });

    const allowed = new Set(["processed", "accepted", "rejected"]);
    const status = String(req.body?.status || "").trim();
    if (!allowed.has(status)) return res.status(400).json({ error: "bad_status" });

    const q = await db.query(
      `
      UPDATE requests r
         SET status = $1
       WHERE r.id::text = $2
         AND EXISTS (SELECT 1 FROM services s WHERE s.id = r.service_id AND s.provider_id = ANY($3::int[]))
       RETURNING id
      `,
      [status, id, providerIds]
    );

    if (!q.rowCount) return res.status(404).json({ error: "not_found_or_forbidden" });
    res.json({ success: true });
  } catch (e) {
    console.error("updateStatusByProvider error:", e);
    res.status(500).json({ error: "status_update_failed" });
  }
};

/** DELETE /api/requests/provider/:id (удалить заявку провайдером) */
exports.deleteByProvider = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "unauthorized" });
    const providerIds = collectProviderIdsFromUser(req.user);

    const id = String(req.params?.id || "").trim();
    if (!id) return res.status(400).json({ error: "id_required" });

    // убедимся, что заявка принадлежит провайдеру
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

    if (!own.rowCount) {
      return res.status(403).json({ error: "forbidden" });
    }

    // (опционально) запретить удаление уже "accepted"
    // if (row.status === "accepted") return res.status(400).json({ error: "cannot_delete_accepted" });

    await db.query(`DELETE FROM requests WHERE id::text = $1`, [id]);
    res.json({ success: true, deleted: id });
  } catch (e) {
    console.error("deleteRequest error:", e);
    res.status(500).json({ error: "delete_failed" });
  }
};
