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
  respondToTourProposal,
  confirmTourPackageSale,
  updateTourPackagePayment,
  replaceTourPackageTravelers,
} = require("../controllers/tourPackageController");

const router = express.Router();

router.get("/public/:token", getPublicTourProposal);
router.post("/public/:token/respond", respondToTourProposal);
router.use(authenticateToken);
router.get("/", listTourPackages);
router.post("/", createTourPackage);
router.post("/:id/share", shareTourPackage);
router.delete("/:id/share", revokeTourPackageShare);
router.post("/:id/confirm-sale", confirmTourPackageSale);
router.patch("/:id/payment", updateTourPackagePayment);
router.put("/:id/travelers", replaceTourPackageTravelers);
router.get("/:id", getTourPackage);
router.patch("/:id", updateTourPackage);

module.exports = router;

