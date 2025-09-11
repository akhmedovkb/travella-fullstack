// backend/routes/marketplaceRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/marketplaceController");

// оба варианта — POST (основной) и GET (fallback с querystring)
router.post("/search", ctrl.search);
router.get("/search", ctrl.search);

module.exports = router;
