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
  updateTourPackageComponentOperations,
  sendTourPackageServiceOrder,
  remindTourPackageServiceOrder,
  cancelTourPackageServiceOrder,
  messageTourPackageServiceOrder,
  createTourPackageTask,
  updateTourPackageTask,
  deleteTourPackageTask,
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
router.patch("/:id/components/:bookingId", updateTourPackageComponentOperations);
router.post("/:id/components/:bookingId/send-service-order", sendTourPackageServiceOrder);
router.post("/:id/components/:bookingId/remind-service-order", remindTourPackageServiceOrder);
router.post("/:id/components/:bookingId/cancel-service-order", cancelTourPackageServiceOrder);
router.post("/:id/components/:bookingId/message-service-order", messageTourPackageServiceOrder);
router.post("/:id/tasks", createTourPackageTask);
router.patch("/:id/tasks/:taskId", updateTourPackageTask);
router.delete("/:id/tasks/:taskId", deleteTourPackageTask);
router.get("/:id", getTourPackage);
router.patch("/:id", updateTourPackage);

module.exports = router;

