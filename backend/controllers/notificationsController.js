// backend/controllers/notificationsController.js
const pool = require("../db");

/**
 * GET /api/notifications/counts
 * Для роли client — считает мои requests/bookings
 * Для роли provider — считает по моим услугам
 */
exports.getCounts = async (req, res) => {
  try {
    const role = req.user?.role;
    const id = req.user?.id;
    if (!role || !id) return res.status(401).json({ message: "Unauthorized" });

    if (role === "client") {
      const q1 = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status='open')        AS requests_open,
           COUNT(*) FILTER (WHERE status='proposed')    AS requests_proposed
         FROM change_requests
         WHERE client_id=$1`,
        [id]
      );

      const q2 = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status='pending')     AS bookings_pending,
           COUNT(*) FILTER (WHERE status='confirmed')   AS bookings_confirmed
         FROM bookings
         WHERE client_id=$1`,
        [id]
      );

      const row1 = q1.rows[0] || {};
      const row2 = q2.rows[0] || {};
      const counts = {
        requests_open: Number(row1.requests_open || 0),
        requests_proposed: Number(row1.requests_proposed || 0),
        bookings_pending: Number(row2.bookings_pending || 0),
        bookings_confirmed: Number(row2.bookings_confirmed || 0),
      };
      counts.total =
        counts.requests_open +
        counts.requests_proposed +
        counts.bookings_pending;

      return res.json({ role: "client", counts });
    }

    if (role === "provider") {
      const q1 = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status='open')      AS requests_open,
           COUNT(*) FILTER (WHERE status='accepted')  AS requests_accepted
         FROM change_requests
         WHERE provider_id=$1`,
        [id]
      );

      const q2 = await pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status='pending')   AS bookings_pending,
           COUNT(*) FILTER (WHERE status='canceled')  AS bookings_canceled
         FROM bookings
         WHERE provider_id=$1`,
        [id]
      );

      const row1 = q1.rows[0] || {};
      const row2 = q2.rows[0] || {};
      const counts = {
        requests_open: Number(row1.requests_open || 0),
        requests_accepted: Number(row1.requests_accepted || 0),
        bookings_pending: Number(row2.bookings_pending || 0),
        bookings_canceled: Number(row2.bookings_canceled || 0),
      };
      counts.total =
        counts.requests_open +
        counts.requests_accepted +
        counts.bookings_pending;

      return res.json({ role: "provider", counts });
    }

    return res.status(403).json({ message: "Unsupported role" });
  } catch (err) {
    console.error("notifications.getCounts error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
