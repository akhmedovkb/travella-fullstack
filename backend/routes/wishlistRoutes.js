// routes/wishlistRoutes.js
const express = require("express");
const router = express.Router();

// --- auth: поддержим оба способа экспорта ---
const authMod = require("../middleware/authenticateToken");
const authenticateToken = authMod?.authenticateToken || authMod;

// --- controller: поддержим exports.* и module.exports = { ... } ---
const wl = require("../controllers/wishlistController");
const listWishlist = wl?.listWishlist || wl?.getWishlist || wl?.list;
const toggleWishlist = wl?.toggleWishlist || wl?.toggle;

// Защитные проверки — упадём с внятной ошибкой при неверном импорте
if (typeof authenticateToken !== "function") {
  throw new Error(
    "authenticateToken is not a function. " +
      "Убедись, что в middleware/authenticateToken.js экспортируется функция " +
      "либо как module.exports = authenticateToken, либо module.exports = { authenticateToken }."
  );
}
if (typeof listWishlist !== "function" || typeof toggleWishlist !== "function") {
  throw new Error(
    "wishlistController exports mismatch. " +
      "Ожидались функции listWishlist и toggleWishlist в controllers/wishlistController.js"
  );
}

router.get("/api/wishlist", authenticateToken, listWishlist);
router.post("/api/wishlist/toggle", authenticateToken, toggleWishlist);

module.exports = router;
