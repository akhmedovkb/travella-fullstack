// routes/wishlistRoutes.js
const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/authenticateToken");
const wishlist = require("../controllers/wishlistController");

router.get("/api/wishlist", authenticateToken, wishlist.listWishlist);
router.post("/api/wishlist/toggle", authenticateToken, wishlist.toggleWishlist);

module.exports = router;
