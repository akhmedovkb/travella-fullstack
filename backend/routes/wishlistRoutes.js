const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const { listWishlist, toggleWishlist } = require("../controllers/wishlistController");

if (typeof authenticateToken !== "function") {
  throw new Error("authenticateToken is not a function");
}
if (typeof listWishlist !== "function" || typeof toggleWishlist !== "function") {
  throw new Error("wishlistController must export { listWishlist, toggleWishlist }");
}

// ВАЖНО: пути без /api/wishlist — базовый префикс задаётся в index.js
router.get("/", authenticateToken, listWishlist);
router.post("/toggle", authenticateToken, toggleWishlist);

module.exports = router;
