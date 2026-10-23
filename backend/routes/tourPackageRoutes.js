const express = require("express");
const authenticateToken = require("../middleware/authenticateToken");
const {
  createTourPackage,
  listTourPackages,
  listSupplierPerformance,
  getTourPackage,
  updateTourPackage,
  updateTourPackageManager,
  recordTourPackageClientFollowup,
  shareTourPackage,
  revokeTourPackageShare,
  getPublicTourProposal,
  respondToTourProposal,
  confirmTourPackageSale,
  updateTourPackagePayment,
  replaceTourPackageTravelers,
  updateTourPackageComponentOperations,
  markTourPackageComponentMessagesRead,
  downloadTourPackageComponentAttachment,
  updateTourPackageComponentAttachment,
  reviewTourPackageComponentAttachment,
  sendTourPackageServiceOrder,
  remindTourPackageServiceOrder,
  requestTourPackageSupplierDocuments,
  cancelTourPackageServiceOrder,
  messageTourPackageServiceOrder,
  createTourPackageTask,
  updateTourPackageTask,
  deleteTourPackageTask,
  createTourPackageIncident,
  updateTourPackageIncident,
} = require("../controllers/tourPackageController");

const router = express.Router();

router.get("/public/:token", getPublicTourProposal);
router.post("/public/:token/respond", respondToTourProposal);
router.use(authenticateToken);
router.get("/", listTourPackages);
router.get("/supplier-performance", listSupplierPerformance);
router.post("/", createTourPackage);
router.post("/:id/share", shareTourPackage);
router.delete("/:id/share", revokeTourPackageShare);
router.post("/:id/confirm-sale", confirmTourPackageSale);
router.patch("/:id/payment", updateTourPackagePayment);
router.patch("/:id/manager", updateTourPackageManager);
router.post("/:id/client-followup", recordTourPackageClientFollowup);
router.put("/:id/travelers", replaceTourPackageTravelers);
router.patch("/:id/components/:bookingId", updateTourPackageComponentOperations);
router.post("/:id/components/:bookingId/read-messages", markTourPackageComponentMessagesRead);
router.get("/:id/components/:bookingId/events/:eventId/attachment", downloadTourPackageComponentAttachment);
router.patch("/:id/components/:bookingId/events/:eventId/attachment", updateTourPackageComponentAttachment);
router.post("/:id/components/:bookingId/events/:eventId/review", reviewTourPackageComponentAttachment);
router.post("/:id/components/:bookingId/send-service-order", sendTourPackageServiceOrder);
router.post("/:id/components/:bookingId/remind-service-order", remindTourPackageServiceOrder);
router.post("/:id/components/:bookingId/request-documents", requestTourPackageSupplierDocuments);
router.post("/:id/components/:bookingId/cancel-service-order", cancelTourPackageServiceOrder);
router.post("/:id/components/:bookingId/message-service-order", messageTourPackageServiceOrder);
router.post("/:id/tasks", createTourPackageTask);
router.patch("/:id/tasks/:taskId", updateTourPackageTask);
router.delete("/:id/tasks/:taskId", deleteTourPackageTask);
router.post("/:id/incidents", createTourPackageIncident);
router.patch("/:id/incidents/:incidentId", updateTourPackageIncident);
router.get("/:id", getTourPackage);
router.patch("/:id", updateTourPackage);

module.exports = router;

