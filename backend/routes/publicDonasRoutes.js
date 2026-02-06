// backend/routes/publicDonasRoutes.js

const express = require("express");
const ctrl = require("../controllers/donasShareTokenController");

const router = express.Router();

// base prefix in index.js: /api/public/donas
router.get("/summary-range-token", ctrl.getPublicSummaryByToken);

module.exports = router;
