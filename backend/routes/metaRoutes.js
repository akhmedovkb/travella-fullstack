const express = require("express");
const router = express.Router();
const ISO6391 = require("iso-639-1");

// GET /api/meta/languages
// Возвращает [{ code, name_en, name_native }]
router.get("/languages", (_req, res) => {
  try {
    const list = ISO6391.getAllCodes()
      .map((code) => ({
        code,
        name_en: ISO6391.getName(code),
        name_native: ISO6391.getNativeName(code),
      }))
      .filter((x) => x.name_en); // отфильтруем экзотические без имени

    res.json(list);
  } catch (e) {
    console.error("meta/languages error:", e);
    res.status(500).json({ message: "languages meta error" });
  }
});

module.exports = router;
