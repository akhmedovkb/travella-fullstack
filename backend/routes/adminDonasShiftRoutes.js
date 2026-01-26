//backend/routes/adminDonasShiftRoutes.js

const router = require("express").Router();
const {
  createShift,
  listShifts
} = require("../controllers/donasShiftController");

router.post("/shifts", createShift);
router.get("/shifts", listShifts);

module.exports = router;
