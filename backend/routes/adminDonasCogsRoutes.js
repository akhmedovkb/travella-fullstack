//backend/routes/adminDonasCogsRoutes.js

const router = require("express").Router();
const { checkCogs } = require("../controllers/donasCogsCheckController");

router.get("/cogs-check", checkCogs);

module.exports = router;
