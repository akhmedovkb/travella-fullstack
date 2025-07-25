const express = require("express");
const router = express.Router();
const { searchListings } = require("../controllers/marketplaceController");

router.post("/search", searchListings); // POST-запрос на фильтрацию

module.exports = router;
