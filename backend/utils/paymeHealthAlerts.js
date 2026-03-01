const { tgSendToAdmins } = require("./telegram");

async function notifyPaymeHealthIssues(summary) {
  try {
    if (!summary) return;

    const lost = Number(summary.lost_payment || 0);
    const bad = Number(summary.bad_amount || 0);
    const refund = Number(summary.refund_mismatch || 0);

    const total = lost + bad + refund;
    if (total === 0) return;

    const text =
      "🚨 PAYME HEALTH ALERT\n\n" +
      `❌ LOST_PAYMENT: ${lost}\n` +
      `⚠️ BAD_AMOUNT: ${bad}\n` +
      `⚠️ REFUND_MISMATCH: ${refund}\n`;

    await tgSendToAdmins(text);
  } catch (e) {
    console.error("[payme-health-alert]", e?.message || e);
  }
}

module.exports = { notifyPaymeHealthIssues };
