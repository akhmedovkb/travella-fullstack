// backend/routes/marketplaceRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/marketplaceController");

router.get("/services/:id", ctrl.getById);
router.post("/search", ctrl.search);
router.get("/search", ctrl.search);
router.get("/suggest", ctrl.suggest);

module.exports = router;
