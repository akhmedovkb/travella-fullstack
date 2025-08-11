// backend/controllers/wishlistController.js
const pool = require("../db");

// GET /api/wishlist?expand=service
exports.getWishlist = async (req, res) => {
  try {
    const clientId = req.user?.id;
    if (!clientId) return res.status(401).json({ message: "Unauthorized" });

    const expand = (req.query.expand || "").toString().toLowerCase() === "service";
    if (expand) {
      const q = `
        SELECT f.item_id AS id, f.created_at,
               s.*
        FROM favorites f
        JOIN services s ON s.id = f.item_id
        WHERE f.client_id = $1 AND f.item_type='service'
        ORDER BY f.created_at DESC
      `;
      const { rows } = await pool.query(q, [clientId]);
      return res.json(rows);
    } else {
      const q = `SELECT item_id AS id FROM favorites WHERE client_id=$1 AND item_type='service'`;
      const { rows } = await pool.query(q, [clientId]);
      return res.json({ ids: rows.map(r => r.id) });
    }
  } catch (e) {
    console.error("getWishlist error:", e);
    return res.status(500).json({ message: "Failed to load wishlist" });
  }
};

// POST /api/wishlist/toggle { item_type: "service", item_id }
exports.toggleWishlist = async (req, res) => {
  try {
    const clientId = req.user?.id;
    if (!clientId) return res.status(401).json({ message: "Unauthorized" });

    const { item_type = "service", item_id } = req.body || {};
    if (!item_id) return res.status(400).json({ message: "item_id required" });

    const sel = await pool.query(
      `SELECT id FROM favorites WHERE client_id=$1 AND item_type=$2 AND item_id=$3`,
      [clientId, item_type, item_id]
    );

    if (sel.rows.length) {
      await pool.query(`DELETE FROM favorites WHERE id=$1`, [sel.rows[0].id]);
      return res.json({ saved: false });
    } else {
      await pool.query(
        `INSERT INTO favorites(client_id, item_type, item_id, created_at)
         VALUES($1,$2,$3, now())`,
        [clientId, item_type, item_id]
      );
      return res.json({ saved: true });
    }
  } catch (e) {
    console.error("toggleWishlist error:", e);
    return res.status(500).json({ message: "Failed to toggle wishlist" });
  }
};
