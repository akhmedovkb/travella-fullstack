// backend/controllers/notificationsController.js
const pool = require("../db");

// маленький помощник, чтобы гарантировать числа
function toInt(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/**
 * GET /api/notifications/counts
 * Возвращает { role, counts: {...} } для клиента или провайдера.
 * Используем SUM(CASE WHEN ...) вместо FILTER для совместимости.
 */
exports.getCounts = async (req, res) => {
  try {
    const role = req.user?.role;
    const id = req.user?.id;
    if (!role || !id) return res.status(401).json({ message: "Unauthorized" });

    if (role === "client") {
      const q1 = await pool.query(
        `
        SELECT
          COALESCE(SUM(CASE WHEN status='open'     THEN 1 ELSE 0 END),0) AS requests_open,
          COALESCE(SUM(CASE WHEN status='proposed' THEN 1 ELSE 0 END),0) AS requests_proposed
        FROM change_requests
        WHERE client_id = $1
        `,
        [id]
      );

      const q2 = await pool.query(
        `
        SELECT
          COALESCE(SUM(CASE WHEN status='pending'   THEN 1 ELSE 0 END),0) AS bookings_pending,
          COALESCE(SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END),0) AS bookings_confirmed
        FROM bookings
        WHERE client_id = $1
        `,
        [id]
      );

      const row1 = q1.rows[0] || {};
      const row2 = q2.rows[0] || {};
      const counts = {
        requests_open:     toInt(row1.requests_open),
        requests_proposed: toInt(row1.requests_proposed),
        bookings_pending:  toInt(row2.bookings_pending),
        bookings_confirmed:toInt(row2.bookings_confirmed),
      };
      counts.total = counts.requests_open + counts.requests_proposed + counts.bookings_pending;

      return res.json({ role: "client", counts });
    }

    if (role === "provider") {
      const q1 = await pool.query(
        `
        SELECT
          COALESCE(SUM(CASE WHEN status='open'     THEN 1 ELSE 0 END),0) AS requests_open,
          COALESCE(SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END),0) AS requests_accepted
        FROM change_requests
        WHERE provider_id = $1
        `,
        [id]
      );

      const q2 = await pool.query(
        `
        SELECT
          COALESCE(SUM(CASE WHEN status='pending'  THEN 1 ELSE 0 END),0) AS bookings_pending,
          COALESCE(SUM(CASE WHEN status='canceled' THEN 1 ELSE 0 END),0) AS bookings_canceled
        FROM bookings
        WHERE provider_id = $1
        `,
        [id]
      );

      const row1 = q1.rows[0] || {};
      const row2 = q2.rows[0] || {};
      const counts = {
        requests_open:     toInt(row1.requests_open),
        requests_accepted: toInt(row1.requests_accepted),
        bookings_pending:  toInt(row2.bookings_pending),
        bookings_canceled: toInt(row2.bookings_canceled),
      };
      counts.total = counts.requests_open + counts.requests_accepted + counts.bookings_pending;

      return res.json({ role: "provider", counts });
    }

    return res.status(403).json({ message: "Unsupported role" });
  } catch (err) {
    console.error("notifications.getCounts error:", err);
    // вместо 500 можно мягко вернуть нули, чтобы не ломать UI
    return res.status(500).json({ message: "Failed to load counts" });
  }
};
