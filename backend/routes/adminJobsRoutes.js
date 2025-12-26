// backend/routes/adminJobsRoutes.js

const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authenticateToken");
const requireAdmin = require("../middleware/requireAdmin");

const { askActualReminder } = require("../jobs/askActualReminder");

function normalizeSlot(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (![10, 14, 18].includes(n)) return null;
  return n;
}

function normalizeDay(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return s;
}

// POST /api/admin/jobs/ask-actual-now
// Body (совместимость):
//   { forceSlot: 10 }  или { slotHour: 10 }  (исторически по-разному называли)
//   { forceDay: "YYYY-MM-DD" } или { day: "YYYY-MM-DD" }
router.post(
  "/jobs/ask-actual-now",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const rawForceSlot = req.body?.forceSlot ?? req.body?.slotHour ?? req.body?.slot ?? null;
      const rawForceDay = req.body?.forceDay ?? req.body?.day ?? null;

      const forceSlot = normalizeSlot(rawForceSlot);
      const forceDay = normalizeDay(rawForceDay);

      const result = await askActualReminder({
        forceSlot: forceSlot || undefined,
        forceDay: forceDay || undefined,
      });

      // Чтобы Postman показывал, что реально использовано
      res.json({
        ok: true,
        used: {
          forceSlot: forceSlot || null,
          forceDay: forceDay || null,
        },
        result, // тут будет used+stats из askActualReminder
      });
    } catch (e) {
      res.status(500).json({
        ok: false,
        message: e?.message || "ask-actual-now failed",
      });
    }
  }
);

module.exports = router;
