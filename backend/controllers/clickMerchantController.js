// backend/controllers/clickMerchantController.js
const pool = require("../db");
const { handleClickCallback } = require("../utils/clickMerchant");

async function handleClickMerchant(req, res) {
  try {
    const payload = req.method === "GET" ? req.query : req.body;
    const result = await handleClickCallback(pool, payload || {});
    return res.json(result);
  } catch (e) {
    console.error("[click] callback error:", e?.message || e);
    return res.json({
      click_trans_id: Number(req.body?.click_trans_id || req.query?.click_trans_id || 0),
      merchant_trans_id: String(req.body?.merchant_trans_id || req.query?.merchant_trans_id || ""),
      error: -7,
      error_note: "Failed to update user",
    });
  }
}

module.exports = { handleClickMerchant };
