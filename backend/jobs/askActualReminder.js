// backend/jobs/askActualReminder.js

const db = require("../db");
const { tgSend } = require("../utils/telegram");
const { isServiceActual } = require("../telegram/helpers/serviceActual");
const { buildSvcActualKeyboard } = require("../telegram/keyboards/serviceActual");

function safeJsonParseMaybe(v) {
  if (!v) return {};
  if (typeof v === "object") return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function getLocalYMD_Tashkent(date, tzOffsetMinutes = 300) {
  const t = new Date(date.getTime() + tzOffsetMinutes * 60 * 1000);
  const yyyy = t.getUTCFullYear();
  const mm = String(t.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(t.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Ключ слота: YYYY-MM-DD_HH (например 2025-12-19_10)
 */
function buildSlotKey(now, slotHour, tzOffsetMinutes = 300) {
  const ymd = getLocalYMD_Tashkent(now, tzOffsetMinutes);
  const hh = String(slotHour).padStart(2, "0");
  return `${ymd}_${hh}`;
}

function pickSlotHourFromNow(now, tzOffsetMinutes = 300) {
  const t = new Date(now.getTime() + tzOffsetMinutes * 60 * 1000);
  const h = t.getUTCHours();
  if (h < 12) return 10;
  if (h < 16) return 14;
  return 18;
}

function cleanupReminderMap(map, keepDays = 14) {
  const out = { ...(map || {}) };
  const now = Date.now();
  const keepMs = keepDays * 24 * 3600 * 1000;

  for (const k of Object.keys(out)) {
    const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})$/.exec(k);
    if (!m) {
      delete out[k];
      continue;
    }
    const [_, Y, M, D, H] = m;
    const dt = Date.UTC(Number(Y), Number(M) - 1, Number(D), Number(H), 0, 0);
    if (!Number.isFinite(dt) || now - dt > keepMs) delete out[k];
  }
  return out;
}

function getMeta(details) {
  const d = details || {};
  const meta =
    d.tg_actual_reminders_meta && typeof d.tg_actual_reminders_meta === "object"
      ? d.tg_actual_reminders_meta
      : {};

  return {
    totalSent: Number(meta.totalSent || 0),
    lastSentAt: meta.lastSentAt || null,
    lastConfirmedAt: meta.lastConfirmedAt || null,
    lastSlotKeySent: meta.lastSlotKeySent || null,
    ignoredDays: Number(meta.ignoredDays || 0),
  };
}

async function setServiceDetails(serviceId, newDetails) {
  await db.query(`UPDATE services SET details = $2 WHERE id = $1`, [
    serviceId,
    JSON.stringify(newDetails),
  ]);
}

async function autoDeactivateIfIgnored({
  serviceId,
  providerChatId,
  details,
  ignoredDays,
  thresholdDays,
  clientBotToken,
}) {
  if (ignoredDays < thresholdDays) return false;

  const next = { ...(details || {}) };
  next.isActive = false;

  const meta = getMeta(next);
  meta.ignoredDays = thresholdDays;
  next.tg_actual_reminders_meta = {
    ...meta,
    autoDeactivatedAt: new Date().toISOString(),
  };

  await setServiceDetails(serviceId, next);

  const text =
    `⚠️ <b>Услуга снята с актуальности</b>\n\n` +
    `Мы не получили подтверждение актуальности несколько дней подряд.\n` +
    `Если услуга всё ещё актуальна — зайдите в кабинет и активируйте её снова.`;

  await tgSend(providerChatId, text, { parse_mode: "HTML" }, clientBotToken || "");
  return true;
}

async function askActualReminder(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();

  const TZ_OFFSET_MIN = 300; // Asia/Tashkent (+05:00)
  const KEEP_DAYS = Number(process.env.ASK_ACTUAL_KEEP_DAYS || 14);
  const IGNORE_DAYS_THRESHOLD = Number(process.env.ASK_ACTUAL_IGNORE_DAYS || 3);

  const forceDay = options.forceDay || process.env.ASK_ACTUAL_FORCE_DAY || "";
  const forceSlot = Number(options.forceSlot || process.env.ASK_ACTUAL_FORCE_SLOT || 0);

  let slotHour = forceSlot;
  if (![10, 14, 18].includes(slotHour)) {
    slotHour = pickSlotHourFromNow(now, TZ_OFFSET_MIN);
  }

  const todayYMD = forceDay && /^\d{4}-\d{2}-\d{2}$/.test(forceDay)
    ? forceDay
    : getLocalYMD_Tashkent(now, TZ_OFFSET_MIN);

  const slotKey = `${todayYMD}_${String(slotHour).padStart(2, "0")}`;
  const CLIENT_BOT_TOKEN = process.env.TELEGRAM_CLIENT_BOT_TOKEN || "";

  const res = await db.query(`
    SELECT
      s.id,
      s.title,
      s.details,
      s.category,
      s.status,
      p.telegram_chat_id
    FROM services s
    JOIN providers p ON p.id = s.provider_id
    WHERE
      s.category LIKE 'refused_%'
      AND s.status IN ('approved','published')
      AND p.telegram_chat_id IS NOT NULL
  `);

  for (const row of res.rows) {
    const serviceId = row.id;
    const title = row.title || "Услуга";
    const providerChatId = row.telegram_chat_id;

    const details = safeJsonParseMaybe(row.details);
    const meta = getMeta(details);

    // ✅ если уже подтвердили сегодня — НЕ спрашиваем больше сегодня (ни 14/18)
    if (meta.lastConfirmedAt) {
      const confirmed = new Date(meta.lastConfirmedAt);
      if (!Number.isNaN(confirmed.getTime())) {
        const confirmedYMD = getLocalYMD_Tashkent(confirmed, TZ_OFFSET_MIN);
        if (confirmedYMD === todayYMD) continue;
      }
    }

    const remindersMap = cleanupReminderMap(details.tg_actual_reminders, KEEP_DAYS);

    // если не актуально — ничего не шлём, только подчистим
    const isActualNow = isServiceActual(details, row);
    if (!isActualNow) {
      const next = { ...details, tg_actual_reminders: remindersMap };
      // сброс ignoredDays, если стало неактуально
      next.tg_actual_reminders_meta = { ...meta, ignoredDays: 0 };
      if (JSON.stringify(next) !== JSON.stringify(details)) {
        await setServiceDetails(serviceId, next);
      }
      continue;
    }

    // антидубль по слоту
    if (remindersMap && remindersMap[slotKey]) {
      const next = { ...details, tg_actual_reminders: remindersMap };
      if (JSON.stringify(next) !== JSON.stringify(details)) {
        await setServiceDetails(serviceId, next);
      }
      continue;
    }

    const text =
      `⏳ <b>Отказ ещё актуален?</b>\n\n` +
      `🧳 <b>${title}</b>\n\n` +
      `Подтвердите, пожалуйста, чтобы услуга не осталась с устаревшим статусом.`;

    const nextDetails = {
      ...details,
      tg_actual_reminders: {
        ...(remindersMap || {}),
        [slotKey]: new Date().toISOString(),
      },
      tg_actual_reminders_meta: {
        ...meta,
        totalSent: meta.totalSent + 1,
        lastSentAt: new Date().toISOString(),
        lastSlotKeySent: slotKey,
      },
    };

    // сохраняем ДО отправки (антидубль для нескольких инстансов)
    await setServiceDetails(serviceId, nextDetails);

    try {
      await tgSend(
        providerChatId,
        text,
        { parse_mode: "HTML", reply_markup: buildSvcActualKeyboard(serviceId, { isActual: true }) },
        CLIENT_BOT_TOKEN || ""
      );

      // ignoredDays считаем 1 раз/день на 18:00, если НЕ подтвердили сегодня
      if (slotHour === 18) {
        const metaAfter = getMeta(nextDetails);
        const confirmedAt = metaAfter.lastConfirmedAt;
        let confirmedToday = false;

        if (confirmedAt) {
          const d = new Date(confirmedAt);
          if (!Number.isNaN(d.getTime())) {
            confirmedToday = getLocalYMD_Tashkent(d, TZ_OFFSET_MIN) === todayYMD;
          }
        }

        if (!confirmedToday) {
          const upd = { ...nextDetails };
          upd.tg_actual_reminders_meta = {
            ...metaAfter,
            ignoredDays: Number(metaAfter.ignoredDays || 0) + 1,
          };
          await setServiceDetails(serviceId, upd);

          await autoDeactivateIfIgnored({
            serviceId,
            providerChatId,
            details: upd,
            ignoredDays: upd.tg_actual_reminders_meta.ignoredDays,
            thresholdDays: IGNORE_DAYS_THRESHOLD,
            clientBotToken: CLIENT_BOT_TOKEN || "",
          });
        } else {
          // если подтвердили — гарантированно держим ignoredDays=0
          if (Number(metaAfter.ignoredDays || 0) !== 0) {
            const upd = { ...nextDetails };
            upd.tg_actual_reminders_meta = { ...metaAfter, ignoredDays: 0 };
            await setServiceDetails(serviceId, upd);
          }
        }
      }
    } catch (e) {
      console.error("[askActualReminder] tgSend failed:", {
        serviceId,
        chatId: providerChatId,
        error: e?.response?.data || e?.message || e,
      });

      // откат отметки слота
      const rollback = { ...details };
      const rbMap = cleanupReminderMap(rollback.tg_actual_reminders, KEEP_DAYS);
      if (rbMap && rbMap[slotKey]) delete rbMap[slotKey];
      rollback.tg_actual_reminders = rbMap;
      await setServiceDetails(serviceId, rollback);
    }
  }
}

module.exports = { askActualReminder };
