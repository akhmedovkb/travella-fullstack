//backend/routes/adminClientsRoutes.js

const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");
const ctrl = require("../controllers/adminClientsController");

const router = express.Router();

router.use(authenticateToken, requireAdmin);

router.get("/", ctrl.listClients);
router.get("/dashboard", ctrl.getClientsDashboard);
router.post("/reset-new", ctrl.resetNewClients);

router.get("/:id/summary", ctrl.getClientSummary);
router.get("/:id/ledger", ctrl.getClientLedger);
router.get("/:id/unlocks", ctrl.getClientUnlocks);
router.get("/:id/access-matrix", ctrl.getClientAccessMatrix);
router.get("/dashboard", ctrl.getClientsDashboard);

router.post("/:id/unlocks", ctrl.grantClientUnlock);
router.delete("/:id/unlocks/:serviceId", ctrl.revokeClientUnlock);

router.post("/:id/balance-adjust", ctrl.adjustClientBalance);

module.exports = router;
