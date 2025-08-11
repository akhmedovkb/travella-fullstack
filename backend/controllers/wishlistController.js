const db = require("../db"); // замени при необходимости

// GET /api/wishlist?expand=service
exports.listWishlist = async (req, res) => {
  try {
    if (req.user?.role !== "client") {
      return res.status(403).json({ message: "Only client" });
    }
    const clientId = req.user.id;
    const expand = (req.query.expand || "").split(",").map(s => s.trim());

    const { rows } = await db.query(
      `SELECT w.service_id AS id,
              s.title, s.name, s.location, s.net_price, s.currency, s.images
         FROM wishlist w
         JOIN services s ON s.id = w.service_id
        WHERE w.client_id = $1
        ORDER BY w.created_at DESC`,
      [clientId]
    );

    if (expand.includes("service")) {
      // уже вернули сервис-данные
      return res.json(rows);
    }
    // если не надо expand=service — вернём просто id
    return res.json(rows.map(r => ({ id: r.id })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Failed to load wishlist" });
  }
};

// POST /api/wishlist/toggle { itemId }  // itemId = service_id
exports.toggleWishlist = async (req, res) => {
  try {
    if (req.user?.role !== "client") {
      return res.status(403).json({ message: "Only client" });
    }
    const clientId = req.user.id;
    const serviceId = Number(req.body.itemId || req.body.service_id);
    if (!serviceId) return res.status(400).json({ message: "service_id required" });

    const { rows } = await db.query(
      "SELECT 1 FROM wishlist WHERE client_id = $1 AND service_id = $2",
      [clientId, serviceId]
    );

    if (rows.length) {
      await db.query(
        "DELETE FROM wishlist WHERE client_id = $1 AND service_id = $2",
        [clientId, serviceId]
      );
      return res.json({ toggled: "removed" });
    } else {
      await db.query(
        "INSERT INTO wishlist (client_id, service_id, created_at) VALUES ($1, $2, NOW())",
        [clientId, serviceId]
      );
      return res.json({ toggled: "added" });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Toggle wishlist failed" });
  }
};
