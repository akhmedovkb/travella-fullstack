// backend/controllers/telegramProviderController.js
const pool = require("../db");
const { tgSend } = require("../utils/telegram");

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
      return res.status(404).json({ error: "Booking not found for this provider" });
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
      return res.status(404).json({ error: "Booking not found for this provider" });
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
 */
async function getProviderServices(req, res) {
  try {
    const { chatId } = req.params;

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

    const servicesRes = await pool.query(
      `SELECT
         s.id,
         s.category,
         s.status,
         s.title,
         s.details,
         s.created_at
       FROM services s
      WHERE s.provider_id = $1
        AND s.category IN (
          'refused_tour',
          'refused_hotel',
          'refused_flight',
          'refused_event'
        )
      ORDER BY s.created_at DESC
      LIMIT 50`,
      [providerId]
    );

    return res.json({
      success: true,
      services: servicesRes.rows,
    });
  } catch (err) {
    console.error("getProviderServices error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}

module.exports = {
  getProviderBookings,
  confirmBooking,
  rejectBooking,
  getProviderServices,
};
