// backend/routes/heygenWebhookRoutes.js

const express = require("express");
const router = express.Router();

const { handleHeygenWebhook } = require("../ai/videoOperator/videoOperator.runtime");

function readSecret(req) {
  const auth = String(req.get("authorization") || "");
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  return (
    String(req.get("x-travella-webhook-secret") || "").trim() ||
    String(req.get("x-heygen-webhook-secret") || "").trim() ||
    String(req.query?.secret || "").trim() ||
    bearer
  );
}

function isAuthorized(req) {
  const expected = String(process.env.HEYGEN_WEBHOOK_SECRET || "").trim();
  if (!expected) return true;
  return readSecret(req) === expected;
}

router.get("/heygen/webhook", (_req, res) => {
  res.json({ success: true, service: "travella-heygen-webhook" });
});

router.post("/heygen/webhook", async (req, res) => {
  if (!isAuthorized(req)) {
    return res.status(401).json({ success: false, message: "Invalid webhook secret" });
  }

  try {
    const result = await handleHeygenWebhook({ payload: req.body || {}, headers: req.headers || {} });
    if (!result.success && result.error?.code === "HEYGEN_VIDEO_ID_REQUIRED") {
      return res.status(400).json(result);
    }
    if (!result.success && result.accepted) {
      return res.status(202).json(result);
    }
    return res.json(result);
  } catch (err) {
    console.error("[heygen-webhook] error:", err?.stack || err);
    return res.status(500).json({ success: false, message: err?.message || "HeyGen webhook failed" });
  }
});

module.exports = router;
