// backend/routes/hotelInspectionRoutes.js
// Legacy compatibility layer. New frontend uses /api/hotels/:id/inspections.
// These routes delegate to hotelsController so all reviews stay in one inspections table.

const router = require("express").Router();
const multer = require("multer");
const authenticateToken = require("../middleware/authenticateToken");
const {
  createHotelInspection,
  listHotelInspections,
  likeInspection,
  listInspectionComments,
  createInspectionComment,
} = require("../controllers/hotelsController");

function tryAuth(req, res, next) {
  const hdr = req.headers?.authorization || "";
  if (!hdr) return next();
  authenticateToken(req, res, () => next());
}

const inspectionUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 13,
    fileSize: 100 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const mimetype = String(file.mimetype || "").toLowerCase();
    if (mimetype.startsWith("image/") || mimetype.startsWith("video/")) return cb(null, true);
    return cb(new Error("unsupported_media_type"));
  },
});

router.get("/hotel/:hotelId", tryAuth, (req, res, next) => {
  req.params.id = req.params.hotelId;
  return listHotelInspections(req, res, next);
});

router.post("/hotel/:hotelId", tryAuth, inspectionUpload.array("files", 13), (req, res, next) => {
  req.params.id = req.params.hotelId;
  return createHotelInspection(req, res, next);
});

router.post("/:inspectionId/like", tryAuth, (req, res, next) => {
  req.params.id = req.params.inspectionId;
  return likeInspection(req, res, next);
});

router.get("/:inspectionId/comments", tryAuth, (req, res, next) => {
  req.params.id = req.params.inspectionId;
  return listInspectionComments(req, res, next);
});

router.post("/:inspectionId/comments", tryAuth, (req, res, next) => {
  req.params.id = req.params.inspectionId;
  return createInspectionComment(req, res, next);
});

module.exports = router;
