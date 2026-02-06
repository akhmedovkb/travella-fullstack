// backend/routes/adminDonasShareTokenRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const ctrl = require("../controllers/donasShareTokenController");

const router = express.Router();

// base prefix in index.js: /api/admin/donas
router.post("/share-token", authenticateToken, requireAdmin, ctrl.createShareToken);

module.exports = router;
