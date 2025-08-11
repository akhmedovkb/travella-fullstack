// backend/routes/wishlistRoutes.js
const express = require("express");
const router = express.Router();
const authenticateToken = require("../middleware/authenticateToken");
const { getWishlist, toggleWishlist } = require("../controllers/wishlistController");

router.get("/", authenticateToken, getWishlist);
router.post("/toggle", authenticateToken, toggleWishlist);

module.exports = router;
