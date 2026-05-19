//backend/routes/hotelInspectionRoutes.js

const router = require("express").Router();
const authenticateToken = require("../middleware/authenticateToken");
const { likeInspection } = require("../controllers/hotelsController");

function tryAuth(req, res, next) {
  const hdr = req.headers?.authorization || "";
  if (!hdr) return next();
  authenticateToken(req, res, () => next());
}

// Лайк конкретной инспекции. Поддерживает старый путь frontend: /api/hotel-inspections/:inspectionId/like
router.post("/:inspectionId/like", tryAuth, (req, res, next) => {
  req.params.id = req.params.inspectionId;
  return likeInspection(req, res, next);
});

module.exports = router;
