// backend/routes/TBtemplatesRoutes.js
const { Router } = require("express");
const router = Router();

// минимально — отдать список (фронту достаточно GET)
router.get("/", async (_req, res) => {
  // TODO: замените на чтение из БД
  const items = [
    {
      id: "uzb-4n5d",
      title: "UZB:TAS-BHK-SKD-TAS(4N/5D)",
      days: [{ city: "Tashkent" }, { city: "Bukhara" }, { city: "Samarkand" }, { city: "Tashkent" }],
    },
    {
      id: "uzb-3n4d",
      title: "UZB:TAS-SKD-TAS(3N/4D)",
      days: [{ city: "Tashkent" }, { city: "Samarkand" }, { city: "Tashkent" }],
    },
  ];
  res.json({ items });
});

module.exports = router;
