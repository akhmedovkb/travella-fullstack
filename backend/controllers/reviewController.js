// controllers/reviewController.js
const pool = require("../db");

/**
 * Таблица reviews (см. SQL ниже):
 * - type: 'service' | 'client'
 * - service_id, provider_id  — для отзыва на услугу/провайдера
 * - client_id                — для отзыва о клиенте
 * - reviewer_id              — автор отзыва (клиент или провайдер)
 * - rating (1..5), text
 * - booking_id (опц.) — чтобы не оставляли по 10 раз за одну бронь
 */

// ----- helpers -----
async function getServiceOwner(serviceId) {
  const q = await pool.query("SELECT provider_id FROM services WHERE id = $1", [serviceId]);
  return q.rows[0]?.provider_id || null;
}

// ----- create reviews -----
const addServiceReview = async (req, res) => {
  try {
    const reviewerId = req.user.id;                 // клиент
    const serviceId  = Number(req.params.serviceId);
    const { rating, text = "", bookingId = null } = req.body;

    if (!serviceId || !rating) {
      return res.status(400).json({ message: "serviceId и rating обязательны" });
    }
    if (Number(rating) < 1 || Number(rating) > 5) {
      return res.status(400).json({ message: "rating должен быть 1..5" });
    }

    const providerId = await getServiceOwner(serviceId);
    if (!providerId) return res.status(404).json({ message: "Услуга не найдена" });

    // Один отзыв от одного пользователя на одну услугу (upsert)
    const sql = `
      INSERT INTO reviews (type, service_id, provider_id, reviewer_id, rating, text, booking_id)
      VALUES ('service', $1, $2, $3, $4, $5, $6)
      ON CONFLICT ON CONSTRAINT ux_reviews_service_reviewer
      DO UPDATE SET rating = EXCLUDED.rating, text = EXCLUDED.text, updated_at = NOW()
      RETURNING *;
    `;
    const r = await pool.query(sql, [serviceId, providerId, reviewerId, Number(rating), String(text).trim(), bookingId]);
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error("addServiceReview:", e);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const addClientReview = async (req, res) => {
  try {
    const reviewerId = req.user.id; // провайдер
    const clientId   = Number(req.params.clientId);
    const { rating, text = "", bookingId = null } = req.body;

    if (!clientId || !rating) return res.status(400).json({ message: "clientId и rating обязательны" });
    if (Number(rating) < 1 || Number(rating) > 5) {
      return res.status(400).json({ message: "rating должен быть 1..5" });
    }

    // Один отзыв от провайдера конкретному клиенту по одной брони
    const sql = `
      INSERT INTO reviews (type, client_id, reviewer_id, rating, text, booking_id)
      VALUES ('client', $1, $2, $3, $4, $5)
      ON CONFLICT ON CONSTRAINT ux_reviews_client_reviewer_booking
      DO UPDATE SET rating = EXCLUDED.rating, text = EXCLUDED.text, updated_at = NOW()
      RETURNING *;
    `;
    const r = await pool.query(sql, [clientId, reviewerId, Number(rating), String(text).trim(), bookingId]);
    res.status(201).json(r.rows[0]);
  } catch (e) {
    console.error("addClientReview:", e);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// ----- lists / summary -----
const getServiceReviews = async (req, res) => {
  try {
    const serviceId = Number(req.params.serviceId);
    const limit     = Math.min(Number(req.query.limit) || 20, 100);
    const list = await pool.query(
      `SELECT id, rating, text, reviewer_id, created_at
         FROM reviews
        WHERE type='service' AND service_id=$1
        ORDER BY created_at DESC
        LIMIT $2`,
      [serviceId, limit]
    );
    const agg = await pool.query(
      `SELECT COALESCE(AVG(rating),0)::float AS avg, COUNT(*)::int AS count
         FROM reviews WHERE type='service' AND service_id=$1`,
      [serviceId]
    );
    res.json({ avg: agg.rows[0].avg, count: agg.rows[0].count, items: list.rows });
  } catch (e) {
    console.error("getServiceReviews:", e);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const getProviderReviews = async (req, res) => {
  try {
    const providerId = Number(req.params.providerId);
    const limit      = Math.min(Number(req.query.limit) || 20, 100);

    const list = await pool.query(
      `SELECT id, rating, text, reviewer_id, created_at
         FROM reviews
        WHERE type='service' AND provider_id=$1
        ORDER BY created_at DESC
        LIMIT $2`,
      [providerId, limit]
    );
    const agg = await pool.query(
      `SELECT COALESCE(AVG(rating),0)::float AS avg, COUNT(*)::int AS count
         FROM reviews WHERE type='service' AND provider_id=$1`,
      [providerId]
    );
    res.json({ avg: agg.rows[0].avg, count: agg.rows[0].count, items: list.rows });
  } catch (e) {
    console.error("getProviderReviews:", e);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const getClientReviews = async (req, res) => {
  try {
    const clientId = Number(req.params.clientId);
    const limit    = Math.min(Number(req.query.limit) || 20, 100);

    const list = await pool.query(
      `SELECT id, rating, text, reviewer_id, created_at
         FROM reviews
        WHERE type='client' AND client_id=$1
        ORDER BY created_at DESC
        LIMIT $2`,
      [clientId, limit]
    );
    const agg = await pool.query(
      `SELECT COALESCE(AVG(rating),0)::float AS avg, COUNT(*)::int AS count
         FROM reviews WHERE type='client' AND client_id=$1`,
      [clientId]
    );
    res.json({ avg: agg.rows[0].avg, count: agg.rows[0].count, items: list.rows });
  } catch (e) {
    console.error("getClientReviews:", e);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

module.exports = {
  addServiceReview,
  addClientReview,
  getServiceReviews,
  getProviderReviews,
  getClientReviews,
};
