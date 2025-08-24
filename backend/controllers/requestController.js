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

/** GET /api/requests/provider/outgoing — заявки, отправленные этим провайдером другим провайдерам */
exports.getProviderOutgoingRequests = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    // у провайдера гарантированно получаем client_id (зеркальный клиент)
    const clientId = await ensureClientIdForUser(userId);
    if (!clientId) return res.status(403).json({ error: "forbidden" });

    const q = await db.query(
      `
      SELECT
        r.id,
        r.created_at,
        COALESCE(r.status, 'new') AS status,
        r.note,
        json_build_object('id', s.id, 'title', COALESCE(s.title, '—')) AS service,
        json_build_object(
          'id', s.provider_id,
          'name', COALESCE(p.name, '—'),
          'phone', p.phone,
          'telegram', p.social,
          'type', p.type
        ) AS provider
      FROM requests r
      JOIN services  s ON s.id = r.service_id
      LEFT JOIN providers p ON p.id = s.provider_id
      WHERE r.client_id = $1
      ORDER BY r.created_at DESC
      `,
      [clientId]
    );

    res.json({ items: q.rows });
  } catch (err) {
    console.error("provider outbox error:", err);
    res.status(500).json({ error: "outbox_load_failed" });
  }
};

// ============ helper: гарантированно получить client_id для текущего пользователя ============
// - Если это обычный клиент — возвращаем его id (он есть в clients).
// - Если это провайдер — берём из provider_client_map, иначе создаём "зеркального клиента",
//   записываем связку в map и возвращаем новый client_id.
// ✅ Гарантированно получить client_id для текущего пользователя.
// - Если это обычный клиент — вернём его id.
// - Если это провайдер — найдём/создадим "зеркального клиента" в clients,
//   УЧИТЫВАЯ NOT NULL на password_hash.
async function ensureClientIdForUser(userId) {
  // Уже клиент?
  const c = await db.query(`SELECT id FROM clients WHERE id = $1`, [userId]);
  if (c.rowCount > 0) return c.rows[0].id;

  // Провайдер?
  const p = await db.query(
    `SELECT id, name, email, phone, social FROM providers WHERE id = $1`,
    [userId]
  );
  if (p.rowCount === 0) return null; // неизвестный пользователь
  const prov = p.rows[0];

  const email = prov.email || null;
  const phone = prov.phone || null;

  // Попробовать сопоставить существующего клиента по email/phone
  const q2 = await db.query(
    `SELECT id FROM clients
       WHERE ($1::text IS NOT NULL AND email IS NOT DISTINCT FROM $1::text)
          OR ($2::text IS NOT NULL AND phone IS NOT DISTINCT FROM $2::text)
       ORDER BY id LIMIT 1`,
    [email, phone]
  );
  if (q2.rowCount > 0) return q2.rows[0].id;

  // Создать "зеркального клиента".
  // ВАЖНО: password_hash у вас NOT NULL → ставим фиктивное значение,
  // которое НЕ используется для логина (такие записи не предназначены для входа).
  // Если хотите ещё безопаснее — заведите default в БД, но этот вариант уже самодостаточен.
  const DUMMY_HASH = '__no_login__'; // не null, не пустая строка

  try {
    const ins = await db.query(
      `INSERT INTO clients (name, email, phone, telegram, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [prov.name || `Provider #${prov.id}`, email, phone, prov.social || null, DUMMY_HASH]
    );
    return ins.rows[0].id;
  } catch (e) {
    if (e && e.code === '23505') {
      // UNIQUE по email/phone: перечитать и вернуть того, кто уже есть
      const q3 = await db.query(
        `SELECT id FROM clients
           WHERE ($1::text IS NOT NULL AND email IS NOT DISTINCT FROM $1::text)
              OR ($2::text IS NOT NULL AND phone IS NOT DISTINCT FROM $2::text)
           ORDER BY id LIMIT 1`,
        [email, phone]
      );
      if (q3.rowCount > 0) return q3.rows[0].id;
    }
    throw e;
  }
}



/* ===================== Controllers ===================== */

/** POST /api/requests — быстрый запрос (клиент/провайдер) */
exports.createQuickRequest = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    const { service_id, note } = req.body || {};
    if (!service_id) return res.status(400).json({ error: "service_id_required" });

    // сервис существует?
    const svcQ = await db.query(`SELECT id, provider_id FROM services WHERE id = $1`, [service_id]);
    const svc = svcQ.rows[0];
    if (!svc) return res.status(404).json({ error: "service_not_found" });

    // запрет самозаявки (провайдер → свой же сервис)
    if (Number(svc.provider_id) === Number(userId)) {
      return res.status(400).json({ error: "self_request_forbidden" });
    }

    // получить валидный client_id (для FK)
    const clientId = await ensureClientIdForUser(userId);
    if (!clientId) return res.status(403).json({ error: "forbidden" });

    // дубль? вернём существующую запись
    const dup = await db.query(
      `SELECT id, service_id, client_id, status, note, created_at
         FROM requests
        WHERE service_id = $1 AND client_id = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [service_id, clientId]
    );
      if (dup.rowCount > 0) {
    // Уже отправляли запрос на эту услугу этим пользователем (клиент/провайдер)
    return res.status(409).json({ error: "request_already_sent", id: dup.rows[0].id });
  }

    // новая заявка
    const ins = await db.query(
      `INSERT INTO requests (service_id, client_id, status, note)
       VALUES ($1, $2, 'new', $3)
       RETURNING id, service_id, client_id, status, note, created_at`,
      [service_id, clientId, note || null]
    );
    return res.status(201).json(ins.rows[0]);
  } catch (err) {
    console.error("quick request error:", err);
    // без 500 — даём код, который фронт уже обрабатывает
    return res.status(400).json({ error: "request_create_failed" });
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

/** DELETE /api/requests/:id
 * Разрешаем удалять:
 *  - автору заявки (client_id = текущий user.id)
 *  - владельцу услуги (JOIN services.provider_id = текущий provider_id)
 *  - провайдеру-инициатору (requests.provider_id = provider_id)    [если колонка есть]
 *  - провайдеру-инициатору (requests.author_provider_id = provider_id) [если колонка есть]
 *  - провайдеру-инициатору (requests.created_by = provider_id)     [если колонка есть]
 *  - провайдеру-инициатору (requests.owner_id = provider_id)       [если колонка есть]
 */
exports.deleteRequest = async (req, res) => {
  try {
    const userId = req.user?.id;
    const providerId = req.user?.provider_id ?? null;
    if (!userId) return res.status(401).json({ error: "unauthorized" });

    const id = String(req.params?.id || "").trim();
    if (!id) return res.status(400).json({ error: "id_required" });

    const userIdStr = String(userId);
    const provIdStr = providerId != null ? String(providerId) : null;

    // помощник: попытаться выполнить DELETE и вернуть rowCount; если колонки нет — вернуть 0
    const tryDelete = async (sql, params) => {
      try {
        const q = await db.query(sql, params);
        return q.rowCount || 0;
      } catch (e) {
        // колонка может отсутствовать — игнорируем такие ошибки
        if (
          /column .* does not exist/i.test(String(e?.message)) ||
          /missing FROM-clause entry/i.test(String(e?.message))
        ) {
          return 0;
        }
        // прочие ошибки пробрасываем наверх
        throw e;
      }
    };

    let affected = 0;

    // 1) мы — автор заявки (клиент)
    affected += await tryDelete(
      `DELETE FROM requests
        WHERE id::text = $1
          AND client_id::text = $2`,
      [id, userIdStr]
    );

    // 2) мы — владелец услуги (входящие)
    if (!affected && provIdStr) {
      affected += await tryDelete(
        `DELETE FROM requests r
           USING services s
         WHERE r.id::text = $1
           AND s.id = r.service_id
           AND s.provider_id::text = $2`,
        [id, provIdStr]
      );
    }

    // 3+) мы — провайдер-инициатор (исходящие). Пробуем несколько возможных колонок, если они существуют.
    if (!affected && provIdStr) {
      const candidateCols = [
        "provider_id",
        "author_provider_id",
        "created_by",
        "owner_id",
      ];
      for (const col of candidateCols) {
        if (affected) break;
        affected += await tryDelete(
          `DELETE FROM requests
            WHERE id::text = $1
              AND ${col}::text = $2`,
          [id, provIdStr]
        );
      }
    }

    if (!affected) {
      return res.status(404).json({ error: "not_found_or_forbidden" });
    }
    return res.json({ success: true, deleted: id });
  } catch (e) {
    console.error("deleteRequest error:", e);
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
