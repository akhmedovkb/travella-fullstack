//backend/routes/hotelInspectionRoutes.js

const router = require("express").Router();
const { likeInspection } = require("../controllers/hotelInspectionController");

// Лайк конкретной инспекции
router.post("/:inspectionId/like", likeInspection);

module.exports = router;
