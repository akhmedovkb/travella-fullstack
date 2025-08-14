// backend/routes/clientRoutes.js
const express = require("express");
const router = express.Router();

const {
  register,
  login,
  getProfile,     // = getMe
  updateProfile,  // = updateMe
  getStats,
  changePassword,
} = require("../controllers/clientController");

const authenticateToken = require("../middleware/authenticateToken");
const wishlist = require("../controllers/wishlistController");

// Public
router.post("/register", register);
router.post("/login", login);

// Private profile (совместимость: /profile и /me)
router.get("/profile", authenticateToken, getProfile);
router.put("/profile", authenticateToken, updateProfile);

router.get("/me", authenticateToken, getProfile);
router.put("/me", authenticateToken, updateProfile);

// Stats
router.get("/stats", authenticateToken, getStats);

// Change password
router.post("/change-password", authenticateToken, changePassword);

// Wishlist
router.get("/api/wishlist", authenticateToken, wishlist.listWishlist);
router.post("/api/wishlist/toggle", authenticateToken, wishlist.toggleWishlist);

module.exports = router;
