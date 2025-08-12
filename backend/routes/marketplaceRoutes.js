// /app/routes/marketplaceRoutes.js
const express = require("express");
const router = express.Router();

const { search } = require("../controllers/marketplaceController");

if (typeof search !== "function") {
  throw new Error("marketplaceController.search is not a function — проверь экспорт/путь");
}

router.post("/search", search);

module.exports = router;
