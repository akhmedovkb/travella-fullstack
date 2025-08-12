const pool = require("../db");

exports.getMyBookings = async (req, res) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    if (!userId || role !== "client") {
      return res.status(403).json({ message: "Only client can view own bookings" });
    }

    const q = await pool.query(
      `SELECT b.*, s.title AS service_title, s.category
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       WHERE b.client_id = $1
       ORDER BY b.created_at DESC`,
      [userId]
    );
    res.json(q.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "getMyBookings error" });
  }
};

exports.getProviderBookings = async (req, res) => {
  try {
    const providerId = req.user?.id;
    const role = req.user?.role;
    if (!providerId || role !== "provider") {
      return res.status(403).json({ message: "Only provider can view provider bookings" });
    }

    const q = await pool.query(
      `SELECT b.*, s.title AS service_title, s.category
       FROM bookings b
       JOIN services s ON s.id = b.service_id
       WHERE b.provider_id = $1
       ORDER BY b.created_at DESC`,
      [providerId]
    );
    res.json(q.rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "getProviderBookings error" });
  }
};
