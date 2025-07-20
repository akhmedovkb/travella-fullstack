const express = require("express");
const router = express.Router();
const { registerProvider } = require("../controllers/providerController");

router.post("/register", registerProvider);

module.exports = router;
