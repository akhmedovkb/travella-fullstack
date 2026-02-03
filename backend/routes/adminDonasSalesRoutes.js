// backend/routes/adminDonasSalesRoutes.js

const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/donasSalesController");

router.get("/sales", ctrl.getSales);
router.post("/sales", ctrl.addSale);
router.put("/sales/:id", ctrl.updateSale);
router.delete("/sales/:id", ctrl.deleteSale);

module.exports = router;
