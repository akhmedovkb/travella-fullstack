const pool = require("../db");

function toInt(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

exports.getCounts = async (req, res) => {
  try {
    const role = req.user?.role;
    const id = req.user?.id;
    if (!role || !id) return res.status(401).json({ message: "Unauthorized" });

    if (role === "provider") {
      // change_requests: статусы есть
      const r1 = await pool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN status='open'     THEN 1 ELSE 0 END),0) AS requests_open,
           COALESCE(SUM(CASE WHEN status='accepted' THEN 1 ELSE 0 END),0) AS requests_accepted
         FROM change_requests
         WHERE provider_id = $1`,
        [id]
      );

      // bookings: статусов НЕТ → считаем всего по провайдеру
      const r2 = await pool.query(
        `SELECT COUNT(*)::int AS bookings_total
           FROM bookings
          WHERE provider_id = $1`,
        [id]
      );

      const a = r1.rows[0] || {};
      const b = r2.rows[0] || {};
      const counts = {
        requests_open:     toInt(a.requests_open),
        requests_accepted: toInt(a.requests_accepted),
        bookings_total:    toInt(b.bookings_total),
      };
      counts.total = counts.requests_open + counts.requests_accepted + counts.bookings_total;
      return res.json({ role: "provider", counts });
    }

    if (role === "client") {
      const r1 = await pool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN status='open'     THEN 1 ELSE 0 END),0) AS requests_open,
           COALESCE(SUM(CASE WHEN status='proposed' THEN 1 ELSE 0 END),0) AS requests_proposed
         FROM change_requests
         WHERE client_id = $1`,
        [id]
      );

      // bookings: статусов НЕТ → считаем всего по клиенту
      const r2 = await pool.query(
        `SELECT COUNT(*)::int AS bookings_total
           FROM bookings
          WHERE client_id = $1`,
        [id]
      );

      const a = r1.rows[0] || {};
      const b = r2.rows[0] || {};
      const counts = {
        requests_open:     toInt(a.requests_open),
        requests_proposed: toInt(a.requests_proposed),
        bookings_total:    toInt(b.bookings_total),
      };
      counts.total = counts.requests_open + counts.requests_proposed + counts.bookings_total;
      return res.json({ role: "client", counts });
    }

    return res.status(403).json({ message: "Unsupported role" });
  } catch (err) {
    console.error("notifications.getCounts error:", err);
    return res.status(500).json({ message: "Failed to load counts" });
  }
};
