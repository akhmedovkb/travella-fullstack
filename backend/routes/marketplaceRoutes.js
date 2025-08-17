const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/marketplaceController");

// поддерживаем оба метода
router.get("/search", ctrl.search);
router.post("/search", ctrl.search);

module.exports = router;
