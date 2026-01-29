//backend/routes/adminDonasCogsRoutes.js

const router = require("express").Router();

const { checkCogs } = require("../controllers/donasCogsCheckController");
const {
  listCogsSnapshots,
  createCogsSnapshot,
  getCogsSnapshotsForItem,
} = require("../controllers/donasCogsController");

// старое
router.get("/cogs-check", checkCogs);

// новое: история/снимки COGS
router.get("/cogs", listCogsSnapshots); // ?menu_item_id=5&limit=30
router.post("/cogs", createCogsSnapshot); // сохраняем снимок из DonasCogs.jsx
router.get("/cogs/:menuItemId", getCogsSnapshotsForItem); // /cogs/5?limit=30

module.exports = router;
