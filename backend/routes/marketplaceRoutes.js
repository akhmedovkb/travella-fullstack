// backend/routes/marketplaceRoutes.js
const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/marketplaceController");

router.post("/search", ctrl.search);
router.get("/search", ctrl.search);
router.get("/suggest", ctrl.suggest);
router.get("/facets", ctrl.facets);

module.exports = router;
