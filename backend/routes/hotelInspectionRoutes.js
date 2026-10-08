// backend/routes/hotelInspectionRoutes.js
// Legacy compatibility layer. New frontend uses /api/hotels/:id/inspections.
// These routes delegate to hotelsController so all reviews stay in one inspections table.

const router = require("express").Router();
const { tryAuth, allowRoles } = require("../middleware/hotelInspectionAccess");
const inspectionUpload = require("../middleware/hotelInspectionUpload");
const {
  createHotelInspection,
  listHotelInspections,
  likeInspection,
  listInspectionComments,
  createInspectionComment,
} = require("../controllers/hotelsController");

const reviewerOnly = allowRoles("provider", "tour_agent", "agency", "supplier", "hotel", "client", "user");
const canLike = allowRoles("provider", "tour_agent", "agency", "supplier", "client", "user");

router.get("/hotel/:hotelId", tryAuth, (req, res, next) => {
  req.params.id = req.params.hotelId;
  return listHotelInspections(req, res, next);
});

router.post("/hotel/:hotelId", reviewerOnly, inspectionUpload, (req, res, next) => {
  req.params.id = req.params.hotelId;
  return createHotelInspection(req, res, next);
});

router.post("/:inspectionId/like", canLike, (req, res, next) => {
  req.params.id = req.params.inspectionId;
  return likeInspection(req, res, next);
});

router.get("/:inspectionId/comments", tryAuth, (req, res, next) => {
  req.params.id = req.params.inspectionId;
  return listInspectionComments(req, res, next);
});

router.post("/:inspectionId/comments", reviewerOnly, (req, res, next) => {
  req.params.id = req.params.inspectionId;
  return createInspectionComment(req, res, next);
});

module.exports = router;
