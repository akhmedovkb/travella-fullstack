const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const {
  createTourPackage,
  listTourPackages,
  getTourPackage,
  updateTourPackage,
} = require("../controllers/tourPackageController");

const router = express.Router();

router.use(authenticateToken);
router.get("/", listTourPackages);
router.post("/", createTourPackage);
router.get("/:id", getTourPackage);
router.patch("/:id", updateTourPackage);

module.exports = router;

