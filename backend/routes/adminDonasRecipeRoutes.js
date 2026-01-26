//backend/routes/adminDonasRecipeRoutes.js

const router = require("express").Router();
const {
  upsertNorm,
  listNorms
} = require("../controllers/donasRecipeController");

router.post("/recipe-norms", upsertNorm);
router.get("/recipe-norms", listNorms);

module.exports = router;
