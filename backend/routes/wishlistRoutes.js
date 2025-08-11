const express = require("express");
const router = express.Router();
const authenticateToken = require("../middleware/authenticateToken");
const {
  listWishlist,
  toggleWishlist,
} = require("../controllers/wishlistController");

// все эндпоинты — только для клиента
router.get("/", authenticateToken, listWishlist);
router.post("/toggle", authenticateToken, toggleWishlist);

module.exports = router;
