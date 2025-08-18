// backend/routes/marketplaceRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/marketplaceController");

router.post("/search", ctrl.search);

module.exports = router;
