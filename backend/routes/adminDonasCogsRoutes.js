// backend/routes/adminDonasCogsRoutes.js

const router = require("express").Router();

const { checkCogs } = require("../controllers/donasCogsCheckController");
const {
  createCogsSnapshot,
  listCogsSnapshots,
  getLatestCogsSnapshot,
} = require("../controllers/donasCogsSnapshotsController");

// Было и остаётся (проверка “идеал vs факт” по месяцу)
router.get("/cogs-check", checkCogs);

// ✅ То, чего не хватало под фронт DonasCogs.jsx:
// сохранить snapshot себестоимости блюда (итог + breakdown)
router.post("/cogs", createCogsSnapshot);

// список snapshot’ов (можно фильтровать по menu_item_id)
router.get("/cogs", listCogsSnapshots);

// последний snapshot (опционально: по menu_item_id)
router.get("/cogs/latest", getLatestCogsSnapshot);

module.exports = router;
