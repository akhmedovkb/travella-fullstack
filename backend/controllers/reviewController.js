// backend/controllers/reviewController.js
const db = require("../db");

/* ───────── helpers ───────── */
function toInt(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function pagin(req) {
  const limit  = Math.min(100, Math.max(1, toInt(req.query.limit)  ?? 20));
  const offset = Math.max(0, toInt(req.query.offset) ?? 0);
  return { limit, offset };
}
function rowsToPublic(list) {
  return list.map(r => ({
    id: r.id,
    rating: r.rating,
    text: r.text,
    created_at: r.created_at,
    author: {
      id: r.author_id,
      role: r.author_role,
      name: r.author_name || null,
      avatar_url: r.author_avatar || null,
    },
  }));
}

/* ───────── CREATE ───────── */
// клиент → услуге
exports.addServiceReview = async (req, res) => {
  try {
    const serviceId = toInt(req.params.serviceId);
    if (!serviceId) return res.status(400).json({ error: "bad_service_id" });

    const { rating, text, booking_id } = req.body || {};
    const r = Math.max(1, Math.min(5, Number(rating || 0)));
    if (!Number.isFinite(r)) return res.status(400).json({ error: "bad_rating" });

    const authorId = req.user?.id;
    if (!authorId) return res.status(401).json({ error: "unauthorized" });

    const q = await db.query(
      `INSERT INTO reviews (target_type, target_id, author_role, author_id, booking_id, rating, text)
       VALUES ('service', $1, 'client', $2, $3, $4, $5)
       RETURNING id, target_id, rating, text, created_at`,
      [serviceId, authorId, toInt(booking_id), r, text || null]
    );
    res.status(201).json(q.rows[0]);
  } catch (e) {
    if (e?.code === "23505") return res.status(409).json({ error: "review_already_exists" });
    console.error("addServiceReview:", e);
    res.status(500).json({ error: "review_create_failed" });
  }
};

// провайдер → клиенту
exports.addClientReview = async (req, res) => {
  try {
    const clientId = toInt(req.params.clientId);
    if (!clientId) return res.status(400).json({ error: "bad_client_id" });

    const { rating, text, booking_id } = req.body || {};
    const r = Math.max(1, Math.min(5, Number(rating || 0)));
    if (!Number.isFinite(r)) return res.status(400).json({ error: "bad_rating" });

    const authorId = req.user?.id;
    if (!authorId) return res.status(401).json({ error: "unauthorized" });

    const q = await db.query(
      `INSERT INTO reviews (target_type, target_id, author_role, author_id, booking_id, rating, text)
       VALUES ('client', $1, 'provider', $2, $3, $4, $5)
       RETURNING id, target_id, rating, text, created_at`,
      [clientId, authorId, toInt(booking_id), r, text || null]
    );
    res.status(201).json(q.rows[0]);
  } catch (e) {
    if (e?.code === "23505") return res.status(409).json({ error: "review_already_exists" });
    console.error("addClientReview:", e);
    res.status(500).json({ error: "review_create_failed" });
  }
};

// клиент ИЛИ провайдер → о ПРОВАЙДЕРЕ
exports.addProviderReview = async (req, res) => {
  try {
    const providerId = toInt(req.params.providerId);
    if (!providerId) return res.status(400).json({ error: "bad_provider_id" });

    const { rating, text, booking_id } = req.body || {};
    const r = Math.max(1, Math.min(5, Number(rating || 0)));
    if (!Number.isFinite(r)) return res.status(400).json({ error: "bad_rating" });

    const authorId = req.user?.id;
    if (!authorId) return res.status(401).json({ error: "unauthorized" });

    const authorRole =
      (req.user?.role === "provider" || req.user?.providerId) ? "provider" : "client";

    if (authorRole === "provider" && Number(authorId) === providerId) {
      return res.status(400).json({ error: "self_review_forbidden" });
    }

    const q = await db.query(
      `INSERT INTO reviews (target_type, target_id, author_role, author_id, booking_id, rating, text)
       VALUES ('provider', $1, $2, $3, $4, $5, $6)
       RETURNING id, target_id, rating, text, created_at`,
      [providerId, authorRole, authorId, toInt(booking_id), r, text || null]
    );
    res.status(201).json(q.rows[0]);
  } catch (e) {
    if (e?.code === "23505") return res.status(409).json({ error: "review_already_exists" });
    console.error("addProviderReview:", e);
    res.status(500).json({ error: "review_create_failed" });
  }
};

/* ───────── READ (list + agg) ───────── */
async function listWithAgg(targetType, targetId, req, res) {
  try {
    if (!targetId) return res.status(400).json({ error: "bad_target_id" });
    const { limit, offset } = pagin(req);

    const agg = await db.query(
      `SELECT COUNT(*)::int AS count, COALESCE(AVG(rating),0)::float AS avg
         FROM reviews
        WHERE target_type = $1 AND target_id = $2`,
      [targetType, targetId]
    );

    // Критично: используем только гарантированно существующие поля
    // clients:   avatar_url
    // providers: photo
    const list = await db.query(
      `SELECT r.id, r.rating, r.text, r.created_at, r.author_role, r.author_id,
              CASE r.author_role
                WHEN 'client'   THEN c.name
                WHEN 'provider' THEN p.name
                ELSE NULL
              END AS author_name,
              CASE r.author_role
                WHEN 'client'   THEN c.avatar_url
                WHEN 'provider' THEN p.photo
                ELSE NULL
              END AS author_avatar
         FROM reviews r
         LEFT JOIN clients   c ON c.id = r.author_id AND r.author_role = 'client'
         LEFT JOIN providers p ON p.id = r.author_id AND r.author_role = 'provider'
        WHERE r.target_type = $1 AND r.target_id = $2
        ORDER BY r.created_at DESC
        LIMIT $3 OFFSET $4`,
      [targetType, targetId, limit, offset]
    );

    return res.json({
      stats: { count: agg.rows[0].count, avg: Number(agg.rows[0].avg) },
      items: rowsToPublic(list.rows),
    });
  } catch (e) {
    console.error(`listWithAgg(${targetType}, ${targetId}) failed:`, e);
    return res.status(500).json({ error: "reviews_read_failed" });
  }
}

exports.getServiceReviews  = (req, res) => listWithAgg("service",  toInt(req.params.serviceId),  req, res);
exports.getProviderReviews = (req, res) => listWithAgg("provider", toInt(req.params.providerId), req, res);
exports.getClientReviews   = (req, res) => listWithAgg("client",   toInt(req.params.clientId),   req, res);
