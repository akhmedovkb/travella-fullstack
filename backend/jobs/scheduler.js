//backend/jobs/scheduler.js

const cron = require("node-cron");
const { askActualReminder } = require("./askActualReminder");
const { cleanupExpiredServicesJob } = require("./cleanupExpiredServicesJob");
const { runUnlockNudge } = require("./unlockNudgeJob");

const TZ = "Asia/Tashkent";
const ASK_HOURS = new Set([10, 14, 18]);
const ASK_WINDOW_MINUTES = 25;

// Храним уже обработанные слоты в памяти процесса:
// ключ формата YYYY-MM-DD-HH
const executedAskSlots = new Set();

function pad2(n) {
  return String(n).padStart(2, "0");
}

function getTashkentNowParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  const parts = fmt.formatToParts(date);
  const map = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
    ymd: `${map.year}-${map.month}-${map.day}`,
  };
}

function makeAskSlotKey(parts) {
  return `${parts.ymd}-${pad2(parts.hour)}`;
}

function pruneExecutedAskSlots(nowParts) {
  // Держим только сегодня/вчера, чтобы set не рос бесконечно
  const keepPrefixes = new Set([nowParts.ymd]);

  const yesterday = new Date(
    Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day)
  );
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);

  const yy = yesterday.getUTCFullYear();
  const mm = pad2(yesterday.getUTCMonth() + 1);
  const dd = pad2(yesterday.getUTCDate());
  keepPrefixes.add(`${yy}-${mm}-${dd}`);

  for (const key of executedAskSlots) {
    const prefix = key.slice(0, 10);
    if (!keepPrefixes.has(prefix)) {
      executedAskSlots.delete(key);
    }
  }
}

async function maybeRunAskActualReminder() {
  const nowParts = getTashkentNowParts();
  pruneExecutedAskSlots(nowParts);

  const { hour, minute } = nowParts;

  if (!ASK_HOURS.has(hour)) {
    return;
  }

  if (minute > ASK_WINDOW_MINUTES) {
    return;
  }

  const slotKey = makeAskSlotKey(nowParts);

  if (executedAskSlots.has(slotKey)) {
    return;
  }

  console.log(
    `[scheduler] askActualReminder slot started: ${slotKey} (${TZ}), minute=${minute}`
  );

  try {
    const result = await askActualReminder({
      dryRun: false,
      windowMinutes: ASK_WINDOW_MINUTES,
    });

    executedAskSlots.add(slotKey);

    console.log(
      `[scheduler] askActualReminder slot finished: ${slotKey}`,
      result || {}
    );
  } catch (err) {
    console.error(
      `[scheduler] askActualReminder slot failed: ${slotKey}`,
      err
    );
  }
}

async function runCleanupExpiredServicesJob() {
  console.log(`[scheduler] cleanupExpiredServicesJob started (${TZ})`);

  try {
    const result = await cleanupExpiredServicesJob();
    console.log(
      `[scheduler] cleanupExpiredServicesJob finished`,
      result || {}
    );
  } catch (err) {
    console.error(`[scheduler] cleanupExpiredServicesJob failed`, err);
  }
}

function startJobsScheduler() {
  if (
    String(process.env.DISABLE_REMINDER_SCHEDULER || "").trim() === "1" ||
    String(process.env.DISABLE_REMINDER_SCHEDULER || "")
      .trim()
      .toLowerCase() === "true"
  ) {
    console.log("[scheduler] disabled by DISABLE_REMINDER_SCHEDULER");
    return;
  }

  if (process.env.NODE_ENV === "test") {
    console.log("[scheduler] skipped in test mode");
    return;
  }

  console.log(
    `[scheduler] started. TZ=${TZ}, askHours=${Array.from(ASK_HOURS).join(
      ","
    )}, askWindowMinutes=${ASK_WINDOW_MINUTES}`
  );

  // Частый тик для окна 10/14/18 с защитой от дублей по slotKey
  cron.schedule(
    "*/1 * * * *",
    async () => {
      await maybeRunAskActualReminder();
    },
    { timezone: TZ }
  );

  // Ночной cleanup expired refused -> archived
  cron.schedule(
    "0 3 * * *",
    async () => {
      await runCleanupExpiredServicesJob();
    },
    { timezone: TZ }
  );

  // Unlock nudge каждые 10 минут
  cron.schedule(
    "*/10 * * * *",
    async () => {
      await runUnlockNudge();
    },
    { timezone: TZ }
  );
}

module.exports = {
  startJobsScheduler,
};
