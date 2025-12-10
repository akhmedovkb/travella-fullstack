// backend/controllers/telegramProviderController.js
const pool = require("../db");
const { tgSend } = require("../utils/telegram");

/**
 * GET /api/telegram/provider/:chatId/bookings?status=pending
 * Заявки конкретного поставщика по его telegram_chat_id
 */
async function getProviderBookings(req, res) {
  try {
    const { chatId } = req.params;
    const status = req.query.status || "pending"; // pending / confirmed / rejected / canceled

    // ищем поставщика по chatId
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
         c.full_name    AS client_name,
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
 * GET /api/telegram/provider/:chatId/services?category=refused_tour
 * Все marketplace-услуги (отказные туры / отели / авиабилеты / билеты)
 * конкретного поставщика.
 */
async function getProviderServices(req, res) {
  try {
    const { chatId } = req.params;
    const category = req.query.category || null;
    const status = req.query.status || null;

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

    const allowedCategories = [
      "refused_tour",
      "refused_hotel",
      "refused_flight",
      "refused_event_ticket",
    ];

    const where = ["s.provider_id = $1"];
    const params = [providerId];

    if (category && allowedCategories.includes(category)) {
      params.push(category);
      where.push(`s.category = $${params.length}`);
    } else {
      params.push(allowedCategories);
      where.push(`s.category = ANY($${params.length})`);
    }

    if (status) {
      params.push(status);
      where.push(`s.status = $${params.length}`);
    }

    const sql = `
      SELECT
        s.id,
        s.title,
        s.category,
        s.status,
        s.created_at,
        s.expiration_at,
        s.details
      FROM services s
      WHERE ${where.join(" AND ")}
      ORDER BY s.created_at DESC
      LIMIT 50
    `;

    const servicesRes = await pool.query(sql, params);

    return res.json({
      success: true,
      items: servicesRes.rows,
    });
  } catch (err) {
    console.error("getProviderServices error:", err);
    res.status(500).json({ error: "Internal error" });
  }
}

module.exports = {
  getProviderBookings,
  confirmBooking,
  rejectBooking,
  getProviderServices,
};
