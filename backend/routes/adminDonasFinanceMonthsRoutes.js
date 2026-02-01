//backend/routes/adminDonasFinanceMonthsRoutes.js

const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/donasFinanceMonthsController");

router.get("/months/:month", ctrl.getMonth);
router.post("/months/:month/lock", ctrl.lockMonth);
router.post("/months/:month/unlock", ctrl.unlockMonth);

module.exports = router;
