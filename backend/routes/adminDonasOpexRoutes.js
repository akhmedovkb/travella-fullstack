// backend/routes/adminDonasOpexRoutes.js
const router = require("express").Router();
const c = require("../controllers/donasOpexController");

router.get("/", c.list);
router.post("/", c.create);
router.put("/:id", c.update);
router.delete("/:id", c.remove);
router.get("/summary", c.summary);

module.exports = router;
