//backend/routes/leadRoutes.js

const express = require("express");
const router = express.Router();
const authenticateToken = require("../middleware/authenticateToken");

const {
  createLead,
  listLeads,
  updateLeadStatus,
  listLeadPages,
  decideLead,
} = require("../controllers/leadController");

router.post("/", createLead);
router.get("/", authenticateToken, listLeads);
router.get("/pages", authenticateToken, listLeadPages);
router.patch("/:id", authenticateToken, updateLeadStatus);
router.patch("/:id/decision", authenticateToken, decideLead);

module.exports = router;
