// backend/controllers/telegramProviderController.js
const pool = require("../db");
const { tgSend } = require("../utils/telegram");

const REFUSED_CATEGORIES = [
  "refused_tour",
  "refused_hotel",
  "refused_flight",
  "refused_ticket",
];

/**
 * Получить заявки поставщика по его Telegram chatId
 * GET /api/telegram/provider/:chatId/bookings?status=pending
 */
async function getProviderBookings(req, res) {
  try {
    const { chatId } = req.params;
    const status = req.query.status || "pending";

    const providerRes = await pool.query(
      `SELECT id, name
         FROM providers
        WHERE telegram_chat_id = $1
        LIMIT 1`,
      [chatId]
    );

    if (providerRes.rowCount === 0) {
      return res.status(404).json({ error: "Provider not found" });
    }

    const providerId = providerRes.rows[0].id;

    const bookingsRes = await pool.query(
      `SELECT
         b.id,
         b.status,
         b.date,
         b.client_message,
         b.created_at,
         b.currency,
         b.tb_meta,
         s.title        AS service_title,
         c.name         AS client_name,
         c.telegram_chat_id AS client_chat_id,
         COALESCE(b.tb_meta->>'startDate', b.date::text) AS start_date,
         (b.tb_meta->>'endDate') AS end_date,
         (b.tb_meta->>'adults')::int    AS persons_adults,
         (b.tb_meta->>'children')::int  AS persons_children,
         (b.tb_meta->>'infants')::int   AS persons_infants
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       JOIN clients  c ON c.id = b.client_id
      WHERE b.provider_id = $1
        AND b.status = $2
      ORDER BY b.created_at DESC
      LIMIT 20`,
      [providerId, status]
    );

    return res.json({
      success: true,
      bookings: bookingsRes.rows,
    });
  } catch (err) {
    console.error("getProviderBookings error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}

/**
 * POST /api/telegram/provider/:chatId/bookings/:bookingId/confirm
 */
async function confirmBooking(req, res) {
  try {
    const { chatId, bookingId } = req.params;

    const bookingRes = await pool.query(
      `SELECT
         b.id,
         b.status,
         b.date,
         b.tb_meta,
         s.title AS service_title,
         c.telegram_chat_id AS client_chat_id
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       JOIN providers p ON p.id = b.provider_id
       JOIN clients  c ON c.id = b.client_id
      WHERE b.id = $1
        AND p.telegram_chat_id = $2
      LIMIT 1`,
      [bookingId, chatId]
    );

    if (bookingRes.rowCount === 0) {
      return res
        .status(404)
        .json({ error: "Booking not found for this provider" });
    }

    const row = bookingRes.rows[0];

    if (row.status !== "pending") {
      return res.status(400).json({ error: "Booking is not pending" });
    }

    await pool.query(
      `UPDATE bookings
          SET status = 'confirmed', updated_at = NOW()
        WHERE id = $1`,
      [bookingId]
    );

    // уведомляем клиента
    if (row.client_chat_id) {
      const text =
        `✅ <b>Ваша бронь подтверждена!</b>\n\n` +
        `Тур: <b>${row.service_title}</b>\n` +
        `Дата: ${row.date}\n`;

      tgSend(row.client_chat_id, text);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("confirmBooking error:", err);
    res.status(500).json({ error: "Internal error" });
  }
}

/**
 * POST /api/telegram/provider/:chatId/bookings/:bookingId/reject
 */
async function rejectBooking(req, res) {
  try {
    const { chatId, bookingId } = req.params;

    const bookingRes = await pool.query(
      `SELECT
         b.id,
         b.status,
         s.title AS service_title,
         c.telegram_chat_id AS client_chat_id
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       JOIN providers p ON p.id = b.provider_id
       JOIN clients  c ON c.id = b.client_id
      WHERE b.id = $1
        AND p.telegram_chat_id = $2
      LIMIT 1`,
      [bookingId, chatId]
    );

    if (bookingRes.rowCount === 0) {
      return res
        .status(404)
        .json({ error: "Booking not found for this provider" });
    }

    const row = bookingRes.rows[0];

    if (row.status !== "pending") {
      return res.status(400).json({ error: "Booking is not pending" });
    }

    await pool.query(
      `UPDATE bookings
          SET status = 'rejected', updated_at = NOW()
        WHERE id = $1`,
      [bookingId]
    );

    // уведомляем клиента
    if (row.client_chat_id) {
      const text =
        `❌ <b>Ваша бронь отклонена.</b>\n\n` +
        `Тур: <b>${row.service_title}</b>\n`;

      tgSend(row.client_chat_id, text);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("rejectBooking error:", err);
    res.status(500).json({ error: "Internal error" });
  }
}

/**
 * Список услуг поставщика (отказные туры/отели/авиабилеты/билеты)
 * GET /api/telegram/provider/:chatId/services
 *
 * Используется bot.js в команде "🧳 Мои услуги"
 */
async function getProviderServices(req, res) {
  try {
    const { chatId } = req.params;

    // 1) Находим поставщика по telegram_chat_id
    const providerRes = await pool.query(
      `SELECT id, name
         FROM providers
        WHERE telegram_chat_id = $1
        LIMIT 1`,
      [chatId]
    );

    if (providerRes.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, error: "PROVIDER_NOT_FOUND" });
    }

    const providerId = providerRes.rows[0].id;

    // 2) Берём его услуги из services
    const categories = REFUSED_CATEGORIES;

    const servicesRes = await pool.query(
      `
        SELECT
          s.id,
          s.category,
          s.status,
          s.title,
          s.price,
          s.details,
          s.images,
          s.expiration_at AS expiration,
          s.created_at,
          p.name   AS provider_name,
          p.social AS provider_telegram
        FROM services s
        LEFT JOIN providers p ON p.id = s.provider_id
       WHERE s.provider_id = $1
         AND s.category = ANY($2::text[])
       ORDER BY s.created_at DESC
       LIMIT 100
      `,
      [providerId, categories]
    );

    return res.json({
      success: true,
      items: servicesRes.rows,
    });
  } catch (err) {
    console.error("[telegram] getProviderServices error:", err);
    return res.status(500).json({
      success: false,
      error: "SERVER_ERROR",
    });
  }
}

/**
 * Общий helper для действий по услуге от бота:
 * action: "unpublish" | "extend7" | "archive"
 */
async function serviceActionFromBot(req, res, action) {
  try {
    const { chatId, serviceId } = req.params;
    const svcId = Number(serviceId);

    if (!Number.isFinite(svcId) || svcId <= 0) {
      return res
        .status(400)
        .json({ success: false, error: "BAD_SERVICE_ID" });
    }

    // Находим поставщика
    const providerRes = await pool.query(
      `SELECT id FROM providers WHERE telegram_chat_id = $1 LIMIT 1`,
      [chatId]
    );
    if (providerRes.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, error: "PROVIDER_NOT_FOUND" });
    }
    const providerId = providerRes.rows[0].id;

    // Проверяем, что услуга принадлежит ему
    const svcRes = await pool.query(
      `SELECT id, status, details, expiration_at
         FROM services
        WHERE id = $1 AND provider_id = $2
        LIMIT 1`,
      [svcId, providerId]
    );
    if (svcRes.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, error: "SERVICE_NOT_FOUND" });
    }

    let updated;

    if (action === "unpublish") {
      // Снять с продажи: ставим isActive=false и expiration в прошлое
      const updRes = await pool.query(
        `
          UPDATE services
             SET
               details = jsonb_set(
                 jsonb_set(COALESCE(details::jsonb, '{}'::jsonb),
                           '{isActive}', 'false'::jsonb, true),
                 '{expiration}',
                 to_jsonb(NOW()::timestamp)::jsonb,
                 true
               ),
               expiration_at = NOW()
           WHERE id = $1
             AND provider_id = $2
           RETURNING id, status, details, expiration_at
        `,
        [svcId, providerId]
      );
      updated = updRes.rows[0];
    } else if (action === "extend7") {
      // Продлить на 7 дней: expiration_at и details.expiration
      const updRes = await pool.query(
        `
          UPDATE services
             SET
               expiration_at = COALESCE(expiration_at, NOW()) + interval '7 days',
               details = jsonb_set(
                 COALESCE(details::jsonb, '{}'::jsonb),
                 '{expiration}',
                 to_jsonb(
                   (COALESCE(expiration_at, NOW()) + interval '7 days')::timestamp
                 )::jsonb,
                 true
               )
           WHERE id = $1
             AND provider_id = $2
           RETURNING id, status, details, expiration_at
        `,
        [svcId, providerId]
      );
      updated = updRes.rows[0];
    } else if (action === "archive") {
      // Архив: статус archived + isActive=false
      const updRes = await pool.query(
        `
          UPDATE services
             SET
               status = 'archived',
               expiration_at = COALESCE(expiration_at, NOW()),
               details = jsonb_set(
                 COALESCE(details::jsonb, '{}'::jsonb),
                 '{isActive}',
                 'false'::jsonb,
                 true
               )
           WHERE id = $1
             AND provider_id = $2
           RETURNING id, status, details, expiration_at
        `,
        [svcId, providerId]
      );
      updated = updRes.rows[0];
    } else {
      return res
        .status(400)
        .json({ success: false, error: "UNKNOWN_ACTION" });
    }

    return res.json({ success: true, service: updated });
  } catch (err) {
    console.error("[telegram] serviceActionFromBot error:", err);
    return res
      .status(500)
      .json({ success: false, error: "SERVER_ERROR" });
  }
}

async function unpublishServiceFromBot(req, res) {
  return serviceActionFromBot(req, res, "unpublish");
}

async function extendService7FromBot(req, res) {
  return serviceActionFromBot(req, res, "extend7");
}

async function archiveServiceFromBot(req, res) {
  return serviceActionFromBot(req, res, "archive");
}

/**
 * Создание услуги из Telegram-бота (шаговый мастер)
 * POST /api/telegram/provider/:chatId/services
 *
 * body: { category, title, price, details, images }
 */
async function createServiceFromBot(req, res) {
  try {
    const { chatId } = req.params;
    const { category, title, price, details, images } = req.body || {};

    if (!category || !REFUSED_CATEGORIES.includes(category)) {
      return res
        .status(400)
        .json({ success: false, error: "BAD_CATEGORY" });
    }

    if (!title || typeof title !== "string") {
      return res
        .status(400)
        .json({ success: false, error: "TITLE_REQUIRED" });
    }

    // Находим поставщика
    const providerRes = await pool.query(
      `SELECT id FROM providers WHERE telegram_chat_id = $1 LIMIT 1`,
      [chatId]
    );
    if (providerRes.rowCount === 0) {
      return res
        .status(404)
        .json({ success: false, error: "PROVIDER_NOT_FOUND" });
    }
    const providerId = providerRes.rows[0].id;

    // Парсим цену
    let priceNum = null;
    if (price !== undefined && price !== null && price !== "") {
      const n = Number(price);
      if (!Number.isNaN(n)) {
        priceNum = n;
      }
    }

    const safeDetails =
      details && typeof details === "object" ? details : {};
    const safeImages = Array.isArray(images) ? images : [];

    // выставляем статусы модерации: отправлено на модерацию
    const insertRes = await pool.query(
      `
        INSERT INTO services (
          provider_id,
          title,
          category,
          price,
          details,
          images,
          status,
          moderation_status,
          submitted_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5::jsonb,
          $6::jsonb,
          'submitted',
          'pending',
          NOW()
        )
        RETURNING id, title, category, status, moderation_status, details, images
      `,
      [providerId, title, category, priceNum, safeDetails, safeImages]
    );

    return res.json({
      success: true,
      service: insertRes.rows[0],
    });
  } catch (err) {
    console.error("[telegram] createServiceFromBot error:", err);
    return res
      .status(500)
      .json({ success: false, error: "SERVER_ERROR" });
  }
}

module.exports = {
  getProviderBookings,
  confirmBooking,
  rejectBooking,
  getProviderServices,
  unpublishServiceFromBot,
  extendService7FromBot,
  archiveServiceFromBot,
  createServiceFromBot,
};
