// backend/controllers/reviewController.js
const db = require("../db");

/* ===== helpers ===== */
const toInt = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const parsePager = (req) => {
  const limit = Math.min(100, Math.max(1, toInt(req.query?.limit) ?? 10));
  const offset = Math.max(0, toInt(req.query?.offset) ?? 0);
  return { limit, offset };
};

/* ========= CREATE: клиент -> отзыв об услуге (и провайдере) =========
   Пишем 2 строки: target_type='service' и target_type='provider'  */
exports.addServiceReview = async (req, res) => {
  try {
    const authorId = req.user?.id;
    if (!authorId) return res.status(401).json({ error: "unauthorized" });

    const serviceId = toInt(req.params?.serviceId);
    const rating = toInt(req.body?.rating);
    const text = (req.body?.text || "").toString().trim() || null;
    const requestId = toInt(req.body?.request_id);

    if (!serviceId) return res.status(400).json({ error: "bad_service_id" });
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "bad_rating" });
    }

    // вытаскиваем провайдера услуги
    const svc = await db.query(
      `SELECT id, provider_id FROM services WHERE id = $1`,
      [serviceId]
    );
    if (!svc.rowCount) return res.status(404).json({ error: "service_not_found" });
    const providerId = toInt(svc.rows[0].provider_id);
    if (!providerId) return res.status(500).json({ error: "service_provider_missing" });

    // в одной транзакции добавляем 2 записи
    await db.query("BEGIN");

    const meta = { service_id: serviceId, request_id: requestId || undefined };

    await db.query(
      `INSERT INTO reviews (target_type, target_id, author_role, author_id, rating, text, meta)
       VALUES ('service',  $1, 'client', $2, $3, $4, $5::jsonb)`,
      [serviceId, authorId, rating, text, JSON.stringify(meta)]
    );

    await db.query(
      `INSERT INTO reviews (target_type, target_id, author_role, author_id, rating, text, meta)
       VALUES ('provider', $1, 'client', $2, $3, $4, $5::jsonb)`,
      [providerId, authorId, rating, text, JSON.stringify(meta)]
    );

    await db.query("COMMIT");
    return res.json({ success: true });
  } catch (e) {
    console.error("addServiceReview error:", e);
    try { await db.query("ROLLBACK"); } catch {}
    return res.status(500).json({ error: "review_create_failed" });
  }
};

/* ========= CREATE: провайдер -> отзыв о клиенте ========= */
exports.addClientReview = async (req, res) => {
  try {
    const authorId = req.user?.id;
    if (!authorId) return res.status(401).json({ error: "unauthorized" });

    const clientId = toInt(req.params?.clientId);
    const rating = toInt(req.body?.rating);
    const text = (req.body?.text || "").toString().trim() || null;
    const serviceId = toInt(req.body?.service_id);
    const requestId = toInt(req.body?.request_id);

    if (!clientId) return res.status(400).json({ error: "bad_client_id" });
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "bad_rating" });
    }

    const meta = { service_id: serviceId || undefined, request_id: requestId || undefined };

    await db.query(
      `INSERT INTO reviews (target_type, target_id, author_role, author_id, rating, text, meta)
       VALUES ('client', $1, 'provider', $2, $3, $4, $5::jsonb)`,
      [clientId, authorId, rating, text, JSON.stringify(meta)]
    );

    return res.json({ success: true });
  } catch (e) {
    console.error("addClientReview error:", e);
    return res.status(500).json({ error: "review_create_failed" });
  }
};

/* ========= READ: списки/агрегаты ========= */

async function listByTarget(targetType, targetId, limit, offset) {
  // агрегаты
  const agg = await db.query(
    `SELECT
        COUNT(*)::int AS count,
        COALESCE(ROUND(AVG(rating)::numeric, 1), 0)::float AS avg
     FROM reviews
     WHERE target_type = $1 AND target_id = $2`,
    [targetType, targetId]
  );

  // список (автор = client/provider/admin)
  const list = await db.query(
    `SELECT
        r.id, r.rating, r.text, r.created_at,
        r.author_role,
        json_build_object(
          'id', r.author_id,
          'name', COALESCE(c.name, p.name, '—')
        ) AS author
     FROM reviews r
     LEFT JOIN clients   c ON r.author_role = 'client'   AND c.id = r.author_id
     LEFT JOIN providers p ON r.author_role = 'provider' AND p.id = r.author_id
     WHERE r.target_type = $1 AND r.target_id = $2
     ORDER BY r.created_at DESC
     LIMIT $3 OFFSET $4`,
    [targetType, targetId, limit, offset]
  );

  const { count = 0, avg = 0 } = agg.rows[0] || {};
  return { count: Number(count || 0), avg: Number(avg || 0), items: list.rows };
}

exports.getServiceReviews = async (req, res) => {
  try {
    const { limit, offset } = parsePager(req);
    const serviceId = toInt(req.params?.serviceId);
    if (!serviceId) return res.status(400).json({ error: "bad_service_id" });
    const data = await listByTarget("service", serviceId, limit, offset);
    return res.json(data);
  } catch (e) {
    console.error("getServiceReviews error:", e);
    return res.status(500).json({ error: "reviews_load_failed" });
  }
};

exports.getProviderReviews = async (req, res) => {
  try {
    const { limit, offset } = parsePager(req);
    const providerId = toInt(req.params?.providerId);
    if (!providerId) return res.status(400).json({ error: "bad_provider_id" });
    const data = await listByTarget("provider", providerId, limit, offset);
    return res.json(data);
  } catch (e) {
    console.error("getProviderReviews error:", e);
    return res.status(500).json({ error: "reviews_load_failed" });
  }
};

exports.getClientReviews = async (req, res) => {
  try {
    const { limit, offset } = parsePager(req);
    const clientId = toInt(req.params?.clientId);
    if (!clientId) return res.status(400).json({ error: "bad_client_id" });
    const data = await listByTarget("client", clientId, limit, offset);
    return res.json(data);
  } catch (e) {
    console.error("getClientReviews error:", e);
    return res.status(500).json({ error: "reviews_load_failed" });
  }
};
