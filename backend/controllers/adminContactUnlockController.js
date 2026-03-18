//backend/controllers/adminContactUnlockController.js

const pool = require("../db");
const {
  DEFAULT_CONTACT_UNLOCK_PRICE,
  getContactUnlockSettings,
  setContactUnlockSettings,
} = require("../utils/contactUnlockSettings");

async function adminGetContactUnlockSettings(req, res) {
  try {
    const settings = await getContactUnlockSettings(pool);

    return res.json({
      ok: true,
      ...settings,
      default_price: DEFAULT_CONTACT_UNLOCK_PRICE,
    });
  } catch (e) {
    console.error("adminGetContactUnlockSettings error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

async function adminSetContactUnlockSettings(req, res) {
  const body = req.body || {};
  const hasIsPaid = Object.prototype.hasOwnProperty.call(body, "is_paid");
  const hasPrice = Object.prototype.hasOwnProperty.call(body, "price");

  if (!hasIsPaid && !hasPrice) {
    return res.status(400).json({ ok: false, message: "Nothing to update" });
  }

  try {
    const current = await getContactUnlockSettings(pool);

    const saved = await setContactUnlockSettings(pool, {
      isPaid: hasIsPaid ? !!body.is_paid : current.is_paid,
      price: hasPrice ? body.price : current.price,
    });

    return res.json({
      ok: true,
      ...saved,
      default_price: DEFAULT_CONTACT_UNLOCK_PRICE,
    });
  } catch (e) {
    console.error("adminSetContactUnlockSettings error:", e);
    return res.status(500).json({ ok: false, message: "Internal error" });
  }
}

module.exports = {
  adminGetContactUnlockSettings,
  adminSetContactUnlockSettings,
};
