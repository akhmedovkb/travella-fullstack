// backend/controllers/bookingController.js
const pool = require("../db");

async function getServiceProvider(serviceId) {
  const q = await pool.query("SELECT provider_id FROM services WHERE id=$1", [serviceId]);
  return q.rows[0]?.provider_id || null;
}

/**
 * POST /api/bookings
 * Body: { serviceId, requestId?, details? }
 * Роль: client
 * Создаёт бронирование (pending). Если указан requestId c accepted/proposed, зашиваем proposal в details.
 */
exports.createBooking = async (req, res) => {
  try {
    if (req.user?.role !== "client") {
      return res.status(403).json({ message: "Only clients can create bookings" });
    }
    const clientId = req.user.id;
    const { serviceId, requestId, details } = req.body;
    if (!serviceId) return res.status(400).json({ message: "serviceId required" });

    const providerId = await getServiceProvider(serviceId);
    if (!providerId) return res.status(404).json({ message: "Service not found" });

    let finalDetails = details || null;

    if (requestId) {
      const rq = await pool.query(
        `SELECT status, proposal FROM change_requests WHERE id=$1 AND client_id=$2 AND service_id=$3`,
        [requestId, clientId, serviceId]
      );
      if (rq.rows.length === 0) {
        return res.status(400).json({ message: "Invalid requestId for this client/service" });
      }
      // Если есть предложение — кладём в details
      if (rq.rows[0].proposal) {
        finalDetails = { ...(finalDetails || {}), proposal: rq.rows[0].proposal, requestId };
      }
    }

    const ins = await pool.query(
      `INSERT INTO bookings (service_id, client_id, provider_id, status, details)
       VALUES ($1, $2, $3, 'pending', $4)
       RETURNING *`,
      [serviceId, clientId, providerId, finalDetails]
    );

    return res.status(201).json(ins.rows[0]);
  } catch (err) {
    console.error("createBooking error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/bookings/my
 * Роль: client — мои бронирования
 */
exports.listMyBookings = async (req, res) => {
  try {
    if (req.user?.role !== "client") {
      return res.status(403).json({ message: "Only client" });
    }
    const clientId = req.user.id;
    const q = await pool.query(
      `SELECT * FROM bookings WHERE client_id=$1 ORDER BY id DESC`,
      [clientId]
    );
    return res.json(q.rows);
  } catch (err) {
    console.error("listMyBookings error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * GET /api/bookings/provider
 * Роль: provider — бронирования по его услугам
 */
exports.listProviderBookings = async (req, res) => {
  try {
    if (req.user?.role !== "provider") {
      return res.status(403).json({ message: "Only provider" });
    }
    const providerId = req.user.id;
    const q = await pool.query(
      `SELECT * FROM bookings WHERE provider_id=$1 ORDER BY id DESC`,
      [providerId]
    );
    return res.json(q.rows);
  } catch (err) {
    console.error("listProviderBookings error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * POST /api/bookings/:id/confirm
 * Роль: provider — подтверждает
 */
exports.confirm = async (req, res) => {
  try {
    if (req.user?.role !== "provider") {
      return res.status(403).json({ message: "Only provider" });
    }
    const providerId = req.user.id;
    const id = req.params.id;

    const up = await pool.query(
      `UPDATE bookings SET status='confirmed', updated_at=NOW()
       WHERE id=$1 AND provider_id=$2
       RETURNING *`,
      [id, providerId]
    );
    if (up.rows.length === 0) return res.status(404).json({ message: "Booking not found" });
    return res.json(up.rows[0]);
  } catch (err) {
    console.error("confirm error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * POST /api/bookings/:id/reject
 * Роль: provider — отклоняет
 */
exports.reject = async (req, res) => {
  try {
    if (req.user?.role !== "provider") {
      return res.status(403).json({ message: "Only provider" });
    }
    const providerId = req.user.id;
    const id = req.params.id;

    const up = await pool.query(
      `UPDATE bookings SET status='rejected', updated_at=NOW()
       WHERE id=$1 AND provider_id=$2
       RETURNING *`,
      [id, providerId]
    );
    if (up.rows.length === 0) return res.status(404).json({ message: "Booking not found" });
    return res.json(up.rows[0]);
  } catch (err) {
    console.error("reject error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};

/**
 * POST /api/bookings/:id/cancel
 * Роль: client или provider — отменяет
 * Body: { reason? }
 */
exports.cancel = async (req, res) => {
  try {
    const role = req.user?.role;
    const userId = req.user?.id;
    const id = req.params.id;
    const { reason } = req.body || {};

    // Проверяем владельца
    const b = await pool.query(`SELECT client_id, provider_id, details FROM bookings WHERE id=$1`, [id]);
    if (b.rows.length === 0) return res.status(404).json({ message: "Booking not found" });

    const row = b.rows[0];
    if (!((role === "client" && row.client_id === userId) || (role === "provider" && row.provider_id === userId))) {
      return res.status(403).json({ message: "Not permitted" });
    }

    const details = row.details || {};
    if (reason) details.cancelReason = reason;

    const up = await pool.query(
      `UPDATE bookings SET status='canceled', details=$1, updated_at=NOW()
       WHERE id=$2 RETURNING *`,
      [details, id]
    );
    return res.json(up.rows[0]);
  } catch (err) {
    console.error("cancel error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
