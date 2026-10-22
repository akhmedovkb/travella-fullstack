const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const {
  createTourPackage,
  listTourPackages,
  getTourPackage,
  updateTourPackage,
  shareTourPackage,
  revokeTourPackageShare,
  getPublicTourProposal,
} = require("../controllers/tourPackageController");

const router = express.Router();

router.get("/public/:token", getPublicTourProposal);
router.use(authenticateToken);
router.get("/", listTourPackages);
router.post("/", createTourPackage);
router.post("/:id/share", shareTourPackage);
router.delete("/:id/share", revokeTourPackageShare);
router.get("/:id", getTourPackage);
router.patch("/:id", updateTourPackage);

module.exports = router;

