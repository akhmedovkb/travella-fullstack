const { askActualReminder } = require("./askActualReminder");
const { cleanupExpiredServicesJob } = require("./cleanupExpiredServicesJob");
const { purgeDeletedServicesJob } = require("./purgeDeletedServicesJob");
const { getTZParts, DEFAULT_TZ } = require("./jobTime");

const TZ = DEFAULT_TZ;

let lastReminderKey = null;
let lastExpiredCleanupKey = null;
let lastDeletedPurgeKey = null;

function startJobsScheduler() {
  console.log("[jobs] scheduler enabled (Asia/Tashkent)");
  console.log("[jobs] askActualReminder => 10:00 / 14:00 / 18:00");
  console.log("[jobs] cleanupExpiredServices => daily 03:00");
  console.log("[jobs] purgeDeletedServices => daily 03:30");

  setInterval(async () => {
    try {
      const { ymd, hour, minute } = getTZParts(new Date(), TZ);

      // 1) Ask Actual Reminder
      if (new Set([10, 14, 18]).has(hour) && minute <= 2) {
        const slotKey = `${ymd}:ask:${hour}`;
        if (lastReminderKey !== slotKey) {
          lastReminderKey = slotKey;
          await askActualReminder();
        }
      }

      // 2) Cleanup expired services
      if (hour === 3 && minute <= 2) {
        const slotKey = `${ymd}:cleanupExpiredServices`;
        if (lastExpiredCleanupKey !== slotKey) {
          lastExpiredCleanupKey = slotKey;
          await cleanupExpiredServicesJob();
        }
      }

      // 3) Purge deleted services
      if (hour === 3 && minute >= 30 && minute <= 32) {
        const slotKey = `${ymd}:purgeDeletedServices`;
        if (lastDeletedPurgeKey !== slotKey) {
          lastDeletedPurgeKey = slotKey;
          await purgeDeletedServicesJob();
        }
      }
    } catch (e) {
      console.error("[jobs] tick error:", e?.message || e);
    }
  }, 30 * 1000);
}

module.exports = {
  startJobsScheduler,
};
