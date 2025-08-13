const express = require("express");
const router = express.Router();
const pool = require("../db");
const authenticateToken = require("../middleware/authenticateToken");

// Унифицированный способ получить client_id из токена
function getClientId(req) {
  return req.user?.clientId ?? (req.user?.role === "client" ? req.user?.id : null);
}

/**
 * POST /api/wishlist/toggle
 * body: { serviceId }   // допускаем также itemId как синоним
 * return: { added: boolean }
 */
router.post("/toggle", authenticateToken, async (req, res) => {
  try {
    const clientId = getClientId(req);
    if (!clientId) return res.status(403).json({ message: "client_required" });

    const serviceId = Number(req.body?.serviceId ?? req.body?.itemId);
    if (!serviceId) return res.status(400).json({ message: "service_id_required" });

    // Пробуем вставить, при конфликте считаем что запись уже есть → переключаем на удаление
    const ins = await pool.query(
      `INSERT INTO wishlist (client_id, service_id)
       VALUES ($1, $2)
       ON CONFLICT (client_id, service_id) DO NOTHING
       RETURNING id`,
      [clientId, serviceId]
    );

    if (ins.rowCount > 0) {
      return res.json({ added: true });
    } else {
      await pool.query(
        `DELETE FROM wishlist WHERE client_id = $1 AND service_id = $2`,
        [clientId, serviceId]
      );
      return res.json({ added: false });
    }
  } catch (e) {
    console.error("wishlist/toggle error:", e);
    res.status(500).json({ message: "server_error" });
  }
});

/**
 * GET /api/wishlist/ids -> массив ID услуг в избранном пользователя
 */
router.get("/ids", authenticateToken, async (req, res) => {
  try {
    const clientId = getClientId(req);
    if (!clientId) return res.status(403).json({ message: "client_required" });

    const r = await pool.query(
      `SELECT service_id FROM wishlist WHERE client_id = $1 ORDER BY created_at DESC`,
      [clientId]
    );
    res.json(r.rows.map((x) => x.service_id));
  } catch (e) {
    console.error("wishlist/ids error:", e);
    res.status(500).json({ message: "server_error" });
  }
});

/**
 * GET /api/wishlist -> детальный список карточек избранного
 */
router.get("/", authenticateToken, async (req, res) => {
  try {
    const clientId = getClientId(req);
    if (!clientId) return res.status(403).json({ message: "client_required" });

    const r = await pool.query(
      `SELECT w.service_id, w.created_at, s.*
         FROM wishlist w
         JOIN services s ON s.id = w.service_id
        WHERE w.client_id = $1
        ORDER BY w.created_at DESC`,
      [clientId]
    );
    res.json(r.rows);
  } catch (e) {
    console.error("wishlist/list error:", e);
    res.status(500).json({ message: "server_error" });
  }
});

module.exports = router;
